import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, sanitizeInput, BANK_DURATION, JAIL_DURATION } from '../shared/simulation.js';
import { LANDMARKS, blocked, distance } from '../shared/world.js';
const advance = (sim, seconds) => { for (let i = 0; i < Math.ceil(seconds * 30); i++) sim.tick(1 / 30); };

test('input validation rejects non-finite rotations and truthy non-booleans', () => {
  const input = sanitizeInput({ up: 'yes', left: 1, sprint: true, yaw: Infinity, pitch: NaN, cash: 999999 });
  assert.equal(input.up, false); assert.equal(input.left, false); assert.equal(input.sprint, true); assert.equal(input.yaw, 0); assert.equal(input.pitch, 0); assert.equal(input.cash, undefined);
});
test('bank has a walkable entrance, solid side walls and accessible vault', () => {
  assert.equal(blocked(60, 33), false); assert.equal(blocked(26, 60), true); assert.equal(blocked(LANDMARKS.bank.x, LANDMARKS.bank.z), false);
});
test('movement stops against walls and stale input stops a player', () => {
  const sim = new Simulation(), p = sim.addPlayer('one', 'test'); Object.assign(p, { x: 23, z: 60 });
  for (let i = 0; i < 120; i++) { sim.setInput('one', { up: true, yaw: Math.PI / 2 }); sim.tick(1 / 30); }
  assert.ok(p.x < 24.6); assert.equal(blocked(p.x, p.z), false);
  Object.assign(p, { x: 0, z: 0 }); sim.setInput('one', { up: true }); advance(sim, 1); const after = p.z; advance(sim, 1); assert.equal(p.z, after);
});
test('players can enter the first car; only one driver can own it; disconnect releases it', () => {
  const sim = new Simulation(), a = sim.addPlayer('a', 'A'), b = sim.addPlayer('b', 'B');
  sim.interact('a'); assert.equal(a.vehicle, 'park-0'); sim.interact('b'); assert.notEqual(b.vehicle, 'park-0');
  sim.removePlayer('a'); assert.equal(sim.vehicles.find(c => c.id === 'park-0').driver, null);
});
test('heist requires proximity and completes once, cashes out only at hideout', () => {
  const sim = new Simulation(), p = sim.addPlayer('one', 'test'); sim.vehicles = sim.vehicles.filter(c => !c.police);
  sim.interact('one'); assert.equal(p.heist, 0); // At spawn this enters a car.
  if (p.vehicle) { sim.vehicles.find(c => c.id === p.vehicle).driver = null; p.vehicle = null; }
  Object.assign(p, LANDMARKS.bank); advance(sim, 1); sim.interact('one'); assert.ok(p.heist > 0); assert.equal(p.wanted, 3);
  advance(sim, BANK_DURATION + 1); assert.equal(p.loot, 12500); assert.equal(p.cash, 2500); assert.equal(p.heist, 0); assert.ok(sim.bankCooldown > 0);
  Object.assign(p, LANDMARKS.hideout); sim.interact('one'); assert.equal(p.cash, 15000); assert.equal(p.loot, 0); assert.equal(p.wanted, 0);
  advance(sim, 1); sim.interact('one'); assert.equal(p.cash, 15000);
});
test('moving away cancels a heist and police cannot rob', () => {
  const sim = new Simulation(), p = sim.addPlayer('one', 'test'), cop = sim.addPlayer('cop', 'Officer', 'police');
  Object.assign(cop, LANDMARKS.bank); sim.interact('cop'); assert.equal(cop.heist, 0);
  Object.assign(p, LANDMARKS.bank); sim.interact('one'); assert.ok(p.heist); p.z = 21; sim.tick(.03); assert.equal(p.heist, 0); assert.equal(p.loot, 0);
});
test('jail confiscates loot, fines player and releases to a valid location', () => {
  const sim = new Simulation(), p = sim.addPlayer('one', 'test'); p.loot = 1000; p.wanted = 3; sim.jailPlayer(p);
  assert.equal(p.jail, JAIL_DURATION); assert.equal(p.cash, 2000); assert.equal(p.loot, 0);
  sim.interact('one'); assert.equal(p.vehicle, null); advance(sim, JAIL_DURATION + 1); assert.equal(p.jail, 0); assert.equal(blocked(p.x, p.z), false);
});
test('delivery and garage pay/reduce balances exactly once per authorized action', () => {
  const sim = new Simulation(), p = sim.addPlayer('one', 'test'); sim.delivery('one'); Object.assign(p, LANDMARKS.delivery); sim.interact('one');
  assert.equal(p.cash, 3400); assert.equal(p.delivery, false); advance(sim, 1); sim.interact('one'); assert.equal(p.cash, 3400);
  Object.assign(p, LANDMARKS.garage); const car = sim.vehicles.find(c => c.id === 'park-4'); car.health = 40; sim.garage('one'); assert.equal(p.cash, 3200); assert.equal(car.health, 100);
});
test('shooting is server checked: aim, cooldown, ammo, hits, reload and wall occlusion', () => {
  const sim = new Simulation(), a = sim.addPlayer('a', 'A'), b = sim.addPlayer('b', 'B');
  Object.assign(a, { x: 0, z: 0 }); Object.assign(b, { x: 0, z: 10, invulnerable: 0 });
  sim.shoot('a'); assert.equal(a.ammo, 12);
  sim.setInput('a', { aim: true, yaw: 0 }); sim.shoot('a'); assert.equal(a.ammo, 11); assert.equal(b.health, 75); assert.equal(a.wanted, 2);
  sim.shoot('a'); assert.equal(a.ammo, 11); sim.reload('a'); advance(sim, 2); assert.equal(a.ammo, 12); assert.equal(a.reserve, 119);
  Object.assign(a, { x: 23, z: 60 }); Object.assign(b, { x: 30, z: 60 }); sim.setInput('a', { aim: true, yaw: Math.PI / 2 }); sim.shoot('a'); assert.equal(b.health, 75);
});
test('NPCs stay within world and snapshot excludes internal movement/route state', () => {
  const sim = new Simulation(); sim.addPlayer('a', 'A'); advance(sim, 20); const s = sim.snapshot();
  assert.equal(s.players[0].input, undefined); assert.equal(s.vehicles[0].path, undefined); assert.equal(s.pedestrians[0].route, undefined);
  assert.equal(s.pedestrians.length, 32); assert.ok(s.vehicles.length >= 30);
  for (const c of s.vehicles) assert.ok(Number.isFinite(c.x) && Number.isFinite(c.z));
});
test('driving collides with another car instead of passing through it', () => {
  const sim = new Simulation(), p = sim.addPlayer('a', 'A'); sim.interact('a');
  const car = sim.vehicles.find(c => c.id === p.vehicle), parked = sim.vehicles.find(c => c.id === 'park-1');
  for (let i = 0; i < 100; i++) { sim.setInput('a', { up: true }); sim.tick(1 / 30); }
  assert.ok(car.health < 100); assert.ok(car.x < parked.x); assert.ok(distance(car, parked) >= 3.05);
});
test('nearby NPC police arrest a stationary wanted player', () => {
  const sim = new Simulation(), p = sim.addPlayer('a', 'A'); Object.assign(p, { x: 0, z: 0, wanted: 2 });
  const cop = sim.vehicles.find(c => c.police); Object.assign(cop, { x: 0, z: 5 }); advance(sim, 4.5);
  assert.ok(p.jail > 0); assert.equal(p.wanted, 0);
});
