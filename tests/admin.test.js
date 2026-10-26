import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminHandlers } from '../server/admin.js';
import { Simulation } from '../shared/simulation.js';
import { blocked, distance } from '../shared/world.js';

const TOKEN = 'test-fixture-token-not-a-production-secret';

function fixture(token = TOKEN) {
  const rooms = new Map([['CITY', { sim: new Simulation() }], ['OTHER', { sim: new Simulation() }]]);
  const io = { sockets: { sockets: new Map() } }, logs = [];
  let time = 1_000_000;
  const attach = createAdminHandlers({ io, adminToken: token, now: () => time, audit: record => logs.push(record) });
  function connect(id, name, code = 'CITY', address = '203.0.113.10', guestToken) {
    const listeners = new Map(), room = rooms.get(code);
    const socket = { id, data: { room: code }, handshake: { address }, disconnected: false, outgoing: [],
      on(event, handler) { const handlers = listeners.get(event) || []; handlers.push(handler); listeners.set(event, handlers); },
      emit(event, data) { this.outgoing.push({ event, data }); },
      disconnect() { this.disconnected = true; room.sim.removePlayer(id); io.sockets.sockets.delete(id); for (const fn of listeners.get('disconnect') || []) fn(); },
      call(event, data) { return new Promise(resolve => { for (const fn of listeners.get(event) || []) fn(data, resolve); }); },
    };
    const identity = attach.identify(socket, guestToken), banned = attach.checkBan(socket);
    const player = banned ? null : room.sim.addPlayer(id, name); io.sockets.sockets.set(id, socket);
    attach(socket, () => room);
    return { socket, player, room, guestToken: identity.guestToken, banned,
      login: value => socket.call('admin:login', { token: value ?? TOKEN }),
      command: command => socket.call('admin:command', { command }),
    };
  }
  return { connect, rooms, logs, io, attach, advance: ms => { time += ms; } };
}

test('admin commands require a configured token and server-side authentication, not a name or police role', async () => {
  const env = fixture(), admin = env.connect('a', 'admin'); admin.player.role = 'police';
  assert.ok((await admin.command('/cash admin 1000')).error); assert.equal(admin.player.cash, 2500);
  assert.ok((await admin.login('wrong')).error); assert.equal(admin.socket.data.admin, false);
  assert.ok((await admin.login('')).error);
  assert.equal((await admin.login()).ok, true); assert.equal(admin.socket.data.admin, true);
  assert.equal((await admin.command('/cash admin 1000')).ok, true); assert.equal(admin.player.cash, 3500);
  const disabled = fixture('').connect('b', 'Owner');
  assert.match((await disabled.login()).error, /ADMIN_TOKEN/); assert.ok((await disabled.command('/heal')).error);
});

test('login attempts are bounded across reconnects by transport IP, and expire after five minutes', async () => {
  const env = fixture(); let connection;
  for (let i = 0; i < 5; i++) {
    connection = env.connect(`attempt-${i}`, 'Guest');
    assert.match((await connection.login('wrong')).error, /אינו נכון/); connection.socket.disconnect();
  }
  connection = env.connect('fresh', 'Guest');
  assert.match((await connection.login()).error, /5 ניסיונות/); assert.equal(connection.socket.data.admin, false);
  env.advance(5 * 60 * 1000 + 1);
  assert.equal((await connection.login()).ok, true);
  connection.socket.disconnect(); assert.equal(connection.socket.data.admin, false);
});

test('targets are limited to the joined room and ambiguous names require an exact ID', async () => {
  const env = fixture(), admin = env.connect('admin-id', 'Admin');
  const first = env.connect('first', 'Same Name'), second = env.connect('second', 'Same Name'), other = env.connect('elsewhere', 'Outsider', 'OTHER');
  await admin.login();
  assert.ok((await admin.command('/cash Outsider 1000')).error);
  assert.ok((await admin.command('/cash elsewhere 1000')).error); assert.equal(other.player.cash, 2500);
  assert.match((await admin.command('/cash "Same Name" 1000')).error, /כמה שחקנים/);
  assert.equal((await admin.command('/cash first 1000')).ok, true); assert.equal(first.player.cash, 3500); assert.equal(second.player.cash, 2500);
  second.player.name = 'Other Name';
  assert.equal((await admin.command('/cash "Other Name" -500')).ok, true); assert.equal(second.player.cash, 2000);
});

test('cash and jail values reject NaN, overflow, fractional values and invalid ranges without mutation', async () => {
  const env = fixture(), admin = env.connect('admin-id', 'Admin'), target = env.connect('target', 'Target'); await admin.login();
  for (const value of ['NaN', 'Infinity', '1.2', '100001', '-100001', '-9999']) {
    assert.ok((await admin.command(`/cash Target ${value}`)).error); assert.equal(target.player.cash, 2500);
  }
  for (const value of ['0', '601', '-1', '1.5']) {
    assert.ok((await admin.command(`/jail Target ${value}`)).error); assert.equal(target.player.jail, 0);
  }
  env.advance(10001);
  target.player.cash = 1_000_000_000;
  assert.ok((await admin.command('/cash Target 1')).error); assert.equal(target.player.cash, 1_000_000_000);
  assert.equal((await admin.command('/cash Target -100000')).ok, true); assert.equal(target.player.cash, 999_900_000);
});

test('jail clears occupied cars and hostages; release restores a valid free position', async () => {
  const env = fixture(), admin = env.connect('admin-id', 'Admin'), target = env.connect('target', 'Target'); await admin.login();
  const sim = target.room.sim, car = sim.vehicles[0], npc = sim.pedestrians[0];
  car.driver = target.player.id; target.player.vehicle = car.id; target.player.hostageId = npc.id; target.player.hostageTime = 40; npc.hostageBy = target.player.id;
  assert.equal((await admin.command('/jail Target 120')).ok, true);
  assert.equal(target.player.jail, 120); assert.equal(target.player.vehicle, null); assert.equal(car.driver, null); assert.equal(car.speed, 0);
  assert.equal(npc.hostageBy, null); assert.equal(target.player.hostageId, null);
  assert.ok((await admin.command('/tp Target')).error); assert.ok((await admin.command('/bring Target')).error);
  assert.equal((await admin.command('/release Target')).ok, true);
  assert.equal(target.player.jail, 0); assert.equal(target.player.cuffed, 0); assert.equal(target.player.health, 100);
  assert.equal(blocked(target.player.x, target.player.z), false);
});

test('teleports choose open nearby ground and detach vehicles; changing role releases held cuffs', async () => {
  const env = fixture(), admin = env.connect('admin-id', 'Admin'), target = env.connect('target', 'Target'), suspect = env.connect('suspect', 'Suspect'); await admin.login();
  const sim = admin.room.sim, car = sim.vehicles[0];
  Object.assign(target.player, { x: 60, z: 60, role: 'police' }); Object.assign(admin.player, { x: 0, z: 0, vehicle: car.id }); car.driver = admin.player.id;
  assert.equal((await admin.command('/tp Target')).ok, true);
  assert.equal(admin.player.vehicle, null); assert.equal(car.driver, null); assert.equal(blocked(admin.player.x, admin.player.z), false);
  assert.ok(distance(admin.player, target.player) < 10);
  suspect.player.cuffed = 20; suspect.player.cuffedBy = target.player.id;
  assert.equal((await admin.command('/setrole Target civilian')).ok, true); assert.equal(target.player.role, 'civilian'); assert.equal(suspect.player.cuffed, 0);
  assert.ok((await admin.command('/setrole Target admin')).error); assert.equal(target.player.role, 'civilian');
  admin.player.cuffed = 10;
  assert.ok((await admin.command('/tp Target')).error);
});

test('heal and repair default to self, kicks disconnect only the selected room member', async () => {
  const env = fixture(), admin = env.connect('admin-id', 'Admin'), target = env.connect('target', 'Target'), other = env.connect('other', 'Other', 'OTHER'); await admin.login();
  const sim = admin.room.sim, car = sim.vehicles[0]; admin.player.health = 12; car.health = 18;
  assert.equal((await admin.command('/heal')).ok, true); assert.equal(admin.player.health, 100);
  assert.equal((await admin.command('/repair')).ok, true); assert.equal(car.health, 100);
  assert.ok((await admin.command('/kick other')).error); assert.equal(other.socket.disconnected, false);
  assert.equal((await admin.command('/kick Target')).ok, true);
  await Promise.resolve(); assert.equal(target.socket.disconnected, true); assert.equal(sim.players.has(target.player.id), false);
});

test('command parsing and rate limits reject oversized, malformed and excessive commands', async () => {
  const env = fixture(), admin = env.connect('admin-id', 'Admin'); await admin.login();
  assert.ok((await admin.command(`/help ${'x'.repeat(301)}`)).error);
  assert.ok((await admin.command('/heal "unfinished')).error);
  assert.ok((await admin.command('/heal\nAdmin')).error);
  assert.ok((await admin.command('/constructor')).error);
  for (let i = 0; i < 6; i++) assert.equal((await admin.command('/help')).ok, true);
  assert.match((await admin.command('/help')).error, /10 פקודות/);
  env.advance(10001); assert.equal((await admin.command('/help')).ok, true);
});

test('audits never contain the token or raw command strings, and admin authority never enters snapshots', async () => {
  const env = fixture(), admin = env.connect('admin-id', 'Admin');
  await admin.login(); await admin.command('/cash Admin 100'); await admin.command(`/notacommand ${TOKEN}`);
  assert.equal(JSON.stringify(env.logs).includes(TOKEN), false);
  assert.equal(env.logs[0].type, 'admin-auth'); assert.equal(env.logs[1].action, 'cash'); assert.equal(env.logs[1].value, 100);
  assert.equal(env.logs.length, 2); assert.equal(admin.room.sim.snapshot().players[0].admin, undefined);
  admin.socket.data.room = null;
  assert.ok((await admin.command('/cash Admin 100')).error); assert.equal(admin.player.cash, 2600);
});

test('guest bans disconnect existing sessions and reject the same signed guest on reconnect in every room', async () => {
  const env = fixture(), admin = env.connect('admin-id', 'Admin'), target = env.connect('target', 'Target'); await admin.login();
  const sibling = env.connect('sibling', 'Other Tab', 'OTHER', '203.0.113.10', target.guestToken);
  const result = await admin.command('/ban Target 15'); assert.equal(result.ok, true); assert.match(result.message, /BAN-[A-F0-9]{8}/);
  await Promise.resolve();
  assert.equal(target.socket.disconnected, true); assert.equal(sibling.socket.disconnected, true);
  assert.equal(target.socket.outgoing.at(-1).data.reason, 'ban');
  const reconnect = env.connect('reconnected', 'New Name', 'OTHER', '203.0.113.99', target.guestToken);
  assert.match(reconnect.banned, /נחסמה/); assert.equal(reconnect.player, null);
  const sameWifi = env.connect('friend', 'Friend'); assert.equal(sameWifi.banned, null); assert.ok(sameWifi.player);
  const listing = await admin.command('/bans'); assert.match(listing.message, /Target/);
  assert.equal(listing.message.includes('203.0.113'), false); assert.equal(listing.message.includes(target.socket.data.guestId), false);
  assert.equal(JSON.stringify(env.logs).includes(target.guestToken), false);
});

test('unban removes the precise ban ID; ban durations are bounded and automatically expire', async () => {
  const env = fixture(), admin = env.connect('admin-id', 'Admin'), target = env.connect('target', 'Target'); await admin.login();
  assert.ok((await admin.command('/ban Target 0')).error); assert.ok((await admin.command('/ban Target 1441')).error);
  assert.ok((await admin.command('/ban Target Infinity')).error); assert.equal(target.socket.disconnected, false);
  const result = await admin.command('/ban Target 1'), id = result.message.match(/BAN-[A-F0-9]{8}/)[0]; await Promise.resolve();
  assert.ok((await admin.command('/unban BAN-NOTFOUND')).error);
  assert.equal((await admin.command(`/unban ${id}`)).ok, true);
  const returned = env.connect('returned', 'Target', 'CITY', '203.0.113.10', target.guestToken); assert.equal(returned.banned, null);
  assert.equal((await admin.command('/ban Target 1')).ok, true); await Promise.resolve();
  env.advance(60001);
  const expired = env.connect('expired', 'Target', 'CITY', '203.0.113.10', target.guestToken); assert.equal(expired.banned, null);
});

test('guest IDs are HMAC-authenticated and bans are deliberately scoped to this server process', async () => {
  const env = fixture(), admin = env.connect('admin-id', 'Admin'), target = env.connect('target', 'Target'); await admin.login();
  const tampered = target.guestToken.slice(0, -6) + 'AAAAAA';
  const altered = env.connect('altered', 'Guest', 'OTHER', '203.0.113.10', tampered);
  assert.notEqual(altered.socket.data.guestId, target.socket.data.guestId);
  await admin.command('/ban Target'); await Promise.resolve();
  const restarted = fixture().connect('restart', 'Target', 'CITY', '203.0.113.10', target.guestToken);
  assert.equal(restarted.socket.data.guestId, target.socket.data.guestId); assert.equal(restarted.banned, null);
});
