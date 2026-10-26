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
