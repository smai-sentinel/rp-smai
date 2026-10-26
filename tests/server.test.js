import test from 'node:test';
import assert from 'node:assert/strict';
import { io } from 'socket.io-client';
import { createGameServer } from '../server/index.js';

const once = (socket, event, timeout = 2000) => new Promise((resolve, reject) => { const timer = setTimeout(() => { socket.off(event, fn); reject(new Error(`timeout: ${event}`)); }, timeout); const fn = data => { clearTimeout(timer); resolve(data); }; socket.once(event, fn); });
const stateWhere = (socket, predicate) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { socket.off('state', listener); reject(new Error('state predicate timed out')); }, 2000);
  const listener = data => { if (predicate(data)) { clearTimeout(timer); socket.off('state', listener); resolve(data); } };
  socket.on('state', listener);
});
test('GitHub Pages origin can join over polling and WebSocket while other origins are rejected', async t => {
  const origin = 'https://smai-sentinel.github.io';
  const server = await createGameServer({ publicOrigins: [origin] });
  await new Promise(resolve => server.http.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.http.address().port}`, clients = [];
  t.after(async () => { clients.forEach(s => s.disconnect()); await server.close(); });
  for (const transport of ['polling', 'websocket']) {
    const socket = io(url, { transports: [transport], extraHeaders: { Origin: origin }, reconnection: false }); clients.push(socket);
    await once(socket, 'connect');
    const joined = await new Promise(resolve => socket.emit('join', { name: 'Public player', room: 'WORLD' }, resolve));
    assert.ok(joined.id);
  }
  const response = await fetch(`${url}/api/health`, { headers: { Origin: origin } });
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.equal((await response.json()).players, 2);
  const rejected = io(url, { transports: ['websocket'], extraHeaders: { Origin: 'https://unrelated.example' }, reconnection: false }); clients.push(rejected);
  await once(rejected, 'connect_error'); assert.equal(rejected.connected, false);
});
test('real sockets join rooms, receive shared movement/chat, isolate voice and reject bad passwords', async t => {
  const server = await createGameServer({ password: 'test-invite' }); await new Promise(resolve => server.http.listen(0, '127.0.0.1', resolve));
  const port = server.http.address().port, clients = [];
  t.after(async () => { clients.forEach(s => s.disconnect()); await server.close(); });
  async function connect(room, password = 'test-invite') {
    const socket = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true }); clients.push(socket); await once(socket, 'connect');
    const data = await new Promise(resolve => socket.emit('join', { name: 'Tester', room, password }, resolve)); return { socket, data };
  }
  const denied = await connect('ROOM', 'wrong'); assert.match(denied.data.error, /סיסמ/);
  const a = await connect('ROOM'), b = await connect('ROOM'), c = await connect('OTHER');
  assert.ok(a.data.id); assert.equal(b.data.state.players.length, 2); assert.equal(c.data.state.players.length, 1);
  const movement = stateWhere(b.socket, s => s.players.some(p => p.id === a.data.id && p.x > 24));
  a.socket.emit('input', { up: true, yaw: Math.PI / 2, cash: 9999999 });
  const snapshot = await movement; const moved = snapshot.players.find(p => p.id === a.data.id); assert.ok(moved.x > 24); assert.equal(moved.cash, 2500);
  const chat = once(b.socket, 'chat'); let crossChat = false; c.socket.on('chat', () => { crossChat = true; }); a.socket.emit('chat', 'hello city');
  assert.equal((await chat).text, 'hello city');
  const peerA = once(a.socket, 'voice:peers'); a.socket.emit('voice:ready', true); assert.deepEqual(await peerA, []);
  const peerB = once(b.socket, 'voice:peers'); b.socket.emit('voice:ready', true); assert.ok((await peerB).includes(a.data.id));
  const peerC = once(c.socket, 'voice:peers'); c.socket.emit('voice:ready', true); assert.deepEqual(await peerC, []);
  let crossVoice = false; c.socket.on('voice:signal', () => { crossVoice = true; });
  const signal = once(b.socket, 'voice:signal');
  a.socket.emit('voice:signal', { to: c.data.id, description: { type: 'offer', sdp: 'room-isolation-test' } });
  a.socket.emit('voice:signal', { to: b.data.id, description: { type: 'offer', sdp: 'same-room-test' } });
  assert.equal((await signal).description.sdp, 'same-room-test'); assert.equal(crossVoice, false); assert.equal(crossChat, false);
  a.socket.emit('action', '__proto__'); a.socket.emit('action', 'constructor'); a.socket.emit('input', { yaw: NaN, up: 1 });
  const health = await fetch(`http://127.0.0.1:${port}/api/health`).then(r => r.json()); assert.equal(health.ok, true); assert.equal(health.players, 3);
});

test('reports are acknowledged privately, validated within the room, bounded per sender and stored for operators', async t => {
  const server = await createGameServer(); await new Promise(resolve => server.http.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.http.address().port}`, clients = [];
  t.after(async () => { clients.forEach(s => s.disconnect()); await server.close(); });
  async function connect(name, room) {
    const socket = io(url, { transports: ['websocket'], forceNew: true }); clients.push(socket); await once(socket, 'connect');
    const data = await new Promise(resolve => socket.emit('join', { name, room }, resolve)); return { socket, id: data.id };
  }
  const a = await connect('Reporter', 'REPORTS'), b = await connect('Target', 'REPORTS'), c = await connect('Other', 'OTHER');
  let broadcast = false; b.socket.on('report', () => { broadcast = true; }); c.socket.on('report', () => { broadcast = true; });
  const report = data => new Promise(resolve => a.socket.emit('report', data, resolve));
  assert.ok((await report({ targetId: c.id, reason: 'cheating' })).error);
  assert.ok((await report({ targetId: a.id, reason: 'other' })).error);
  assert.ok((await report({ targetId: b.id, reason: 'invalid' })).error);
  const result = await report({ targetId: b.id, reason: 'harassment', details: `  text\u0000\u202e${'x'.repeat(600)}  ` });
  assert.equal(result.ok, true); assert.match(result.id, /^RPT-/); assert.equal(server.reports.length, 1);
  const record = server.reports[0]; assert.equal(record.id, result.id); assert.equal(record.room, 'REPORTS'); assert.equal(record.reporterName, 'Reporter'); assert.equal(record.targetName, 'Target');
  assert.equal(record.details.length, 500); assert.equal(record.details.includes('\u0000'), false); assert.equal(record.details.includes('\u202e'), false);
  assert.ok(Number.isFinite(Date.parse(record.createdAt)));
  await report({ targetId: b.id, reason: 'voice' }); await report({ targetId: b.id, reason: 'other' });
  assert.ok((await report({ targetId: b.id, reason: 'cheating' })).error); assert.equal(server.reports.length, 3);
  const state = await once(b.socket, 'state'); assert.equal(state.reports, undefined); assert.equal(broadcast, false);
});

test('police handcuff action is applied by the server and reaches both room members', async t => {
  const server = await createGameServer(); await new Promise(resolve => server.http.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.http.address().port}`, clients = [];
  t.after(async () => { clients.forEach(s => s.disconnect()); await server.close(); });
  async function connect(role) {
    const socket = io(url, { transports: ['websocket'], forceNew: true }); clients.push(socket); await once(socket, 'connect');
    const joined = await new Promise(resolve => socket.emit('join', { name: role, room: 'CUFFS', role }, resolve)); return { socket, id: joined.id };
  }
  const officer = await connect('police'), suspect = await connect('civilian'), sim = server.rooms.get('CUFFS').sim;
  sim.vehicles = []; sim.pedestrians = []; Object.assign(sim.players.get(officer.id), { x: 0, z: 0 }); Object.assign(sim.players.get(suspect.id), { x: 0, z: 3, wanted: 2 });
  const states = [stateWhere(officer.socket, s => s.players.some(p => p.id === suspect.id && p.cuffed > 0)), stateWhere(suspect.socket, s => s.players.some(p => p.id === suspect.id && p.cuffed > 0))];
  officer.socket.emit('action', 'cuff');
  for (const state of await Promise.all(states)) assert.equal(state.players.find(p => p.id === suspect.id).cuffedBy, officer.id);
});

test('authenticated administrator commands reach live game state without granting authority in snapshots', async t => {
  const adminToken = 'local-server-integration-test-key';
  const server = await createGameServer({ adminToken }); await new Promise(resolve => server.http.listen(0, '127.0.0.1', resolve));
  const socket = io(`http://127.0.0.1:${server.http.address().port}`, { transports: ['websocket'], forceNew: true });
  t.after(async () => { socket.disconnect(); await server.close(); }); await once(socket, 'connect');
  const joined = await new Promise(resolve => socket.emit('join', { name: 'Owner', room: 'ADMIN', role: 'police' }, resolve));
  const command = command => new Promise(resolve => socket.emit('admin:command', { command }, resolve));
  assert.ok((await command('/cash Owner 100')).error);
  const login = await new Promise(resolve => socket.emit('admin:login', { token: adminToken }, resolve)); assert.equal(login.ok, true);
  const updated = stateWhere(socket, state => state.players.some(p => p.id === joined.id && p.cash === 2600));
  assert.equal((await command('/cash Owner 100')).ok, true);
  const player = (await updated).players.find(p => p.id === joined.id); assert.equal(player.admin, undefined); assert.equal(player.adminToken, undefined);
});

test('temporary guest bans survive real reconnects and room changes without blocking other guests on the same network', async t => {
  const adminToken = 'guest-ban-integration-test-key';
  const server = await createGameServer({ adminToken }); await new Promise(resolve => server.http.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.http.address().port}`, clients = [];
  t.after(async () => { clients.forEach(s => s.disconnect()); await server.close(); });
  async function connect(name, room = 'BAN', guestToken) {
    const socket = io(url, { transports: ['websocket'], forceNew: true, reconnection: false }); clients.push(socket); await once(socket, 'connect');
    const data = await new Promise(resolve => socket.emit('join', { name, room, guestToken }, resolve)); return { socket, data };
  }
  const owner = await connect('Owner'), target = await connect('Target'), linked = await connect('Second tab', 'ANOTHER', target.data.guestToken);
  assert.equal(typeof target.data.guestToken, 'string'); assert.equal(linked.data.guestToken, target.data.guestToken);
  await new Promise(resolve => owner.socket.emit('admin:login', { token: adminToken }, resolve));
  const removed = once(target.socket, 'admin:removed'), disconnected = once(target.socket, 'disconnect'), linkedDisconnected = once(linked.socket, 'disconnect');
  const command = command => new Promise(resolve => owner.socket.emit('admin:command', { command }, resolve));
  const banned = await command('/ban Target 5'); assert.equal(banned.ok, true);
  assert.equal((await removed).reason, 'ban'); await Promise.all([disconnected, linkedDisconnected]);
  const retry = await connect('New Name', 'NEW-ROOM', target.data.guestToken); assert.ok(retry.data.error); assert.equal(server.rooms.has('NEW-ROOM'), false);
  const friend = await connect('Friend'); assert.ok(friend.data.id, 'another browser guest on the same IP must be allowed');
  const banId = banned.message.match(/BAN-[a-z0-9-]+/i)?.[0]; assert.ok(banId);
  assert.equal((await command(`/unban ${banId}`)).ok, true);
  const restored = await connect('Target', 'BAN', target.data.guestToken); assert.ok(restored.data.id); assert.equal(restored.data.guestToken, target.data.guestToken);
  for (const player of restored.data.state.players) { assert.equal(player.guestId, undefined); assert.equal(player.guestToken, undefined); }
});
