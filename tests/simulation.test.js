import test from 'node:test';
import assert from 'node:assert/strict';
import { Simulation, sanitizeInput, BANK_DURATION, JAIL_DURATION, CUFF_DURATION } from '../shared/simulation.js';
import { LANDMARKS, WORLD, obstacles, blocked, distance, rng } from '../shared/world.js';
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

test('spatial collision index agrees with all obstacles at boundaries and seeded points', () => {
  const reference = (x, z, radius) => x < WORLD.min + radius || x > WORLD.max - radius || z < WORLD.min + radius || z > WORLD.max - radius ||
    obstacles.some(b => Math.abs(x - b.x) < b.w / 2 + radius && Math.abs(z - b.z) < b.d / 2 + radius);
  const random = rng(9141), radii = [0, .05, .3, .5, 1.4, 5, 25, 90];
  for (let i = 0; i < 12000; i++) {
    const x = random() * 1000 - 500, z = random() * 1000 - 500, radius = radii[i % radii.length];
    assert.equal(blocked(x, z, radius), reference(x, z, radius));
  }
  for (const obstacle of obstacles) for (const radius of radii) for (const offset of [-.0001, 0, .0001]) {
    const x = obstacle.x + obstacle.w / 2 + radius + offset;
    assert.equal(blocked(x, obstacle.z, radius), reference(x, obstacle.z, radius));
  }
});

test('public snapshots quantize positions, exclude private state and detach from future ticks', () => {
  const sim = new Simulation(), p = sim.addPlayer('one', 'Player');
  Object.assign(p, { x: 1.23456, z: -2.34567, yaw: .123456, health: 99.345, lastInput: 0 });
  sim.setInput(p.id, { aim: true, pitch: .123456 }); p.aiming = true;
  const snapshot = sim.snapshot(), publicPlayer = snapshot.players[0];
  assert.equal(publicPlayer.x, 1.23); assert.equal(publicPlayer.z, -2.35); assert.equal(publicPlayer.yaw, .123); assert.equal(publicPlayer.pitch, .123);
  assert.equal(publicPlayer.health, 99.3);
  for (const key of ['input', 'lastInput', 'actionAt', 'shotAt', 'alertAt', 'invulnerable', 'cuffAt', 'vehicleHitAt']) assert.equal(publicPlayer[key], undefined);
  assert.equal(snapshot.vehicles[0].steer, 0); assert.equal(snapshot.vehicles[0].health, 100);
  p.x = 50; sim.vehicles[0].x = 100; assert.equal(publicPlayer.x, 1.23); assert.equal(snapshot.vehicles[0].x, 26);
  publicPlayer.cash = 0; snapshot.vehicles[0].health = 1; assert.equal(p.cash, 2500); assert.equal(sim.vehicles[0].health, 100);
});

test('driver pose and speed agree with final car collision response in the same tick', () => {
  const sim = new Simulation(), p = sim.addPlayer('one', 'Player'); sim.interact(p.id);
  const car = sim.vehicles.find(c => c.id === p.vehicle), other = sim.vehicles[1];
  sim.vehicles = [car, other]; Object.assign(car, { x: 0, z: 0, yaw: Math.PI / 2, speed: 12 }); Object.assign(other, { x: 3.2, z: 0 });
  sim.setInput(p.id, { up: true }); sim.tick(1 / 30);
  assert.ok(car.health < 100); assert.equal(p.x, car.x); assert.equal(p.z, car.z); assert.equal(p.speed, car.speed); assert.equal(p.yaw, car.yaw);
});

function trafficImpact({ speed = 12, police = false, wanted = 0, protectedSpawn = false } = {}) {
  const sim = new Simulation(), driver = sim.addPlayer('driver', 'Driver', police ? 'police' : 'civilian'), victim = sim.addPlayer('victim', 'Victim');
  const vehicle = sim.vehicles[0]; sim.vehicles = [vehicle]; sim.pedestrians = [];
  Object.assign(vehicle, { x: 0, z: 0, yaw: 0, speed, driver: driver.id }); Object.assign(driver, { vehicle: vehicle.id, x: 0, z: 0 });
  Object.assign(victim, { x: 0, z: 2.5, wanted, invulnerable: protectedSpawn ? 5 : 0 });
  return { sim, driver, victim, vehicle };
}
test('vehicle impacts damage people once per cooldown, skip slow cars, driver and protected spawns', () => {
  const { sim, driver, victim, vehicle } = trafficImpact(); sim.tick(.1);
  assert.ok(victim.health < 100 && victim.health > 35); assert.equal(driver.health, 100);
  const health = victim.health; victim.x = vehicle.x; victim.z = vehicle.z + 1; sim.tick(.1); assert.equal(victim.health, health);
  const slow = trafficImpact({ speed: 2 }); slow.sim.tick(.1); assert.equal(slow.victim.health, 100);
  const protectedSpawn = trafficImpact({ protectedSpawn: true }); protectedSpawn.sim.tick(.1); assert.equal(protectedSpawn.victim.health, 100);
});

test('fast cars sweep across victims, NPC cars deal damage and fatal impacts lead to hospital', () => {
  const setup = trafficImpact({ speed: 58 }); setup.victim.z = 3; setup.sim.tick(.1); assert.ok(setup.victim.health < 100);
  const npc = trafficImpact(); npc.vehicle.driver = null; npc.driver.vehicle = null; npc.driver.x = 20;
  Object.assign(npc.vehicle, { ai: 'traffic', route: [{ x: 0, z: 100 }], waypoint: 0 }); npc.victim.health = 5;
  npc.sim.tick(.1); assert.equal(npc.victim.health, 100); assert.equal(npc.victim.x, -180); assert.equal(npc.victim.cash, 2200); assert.ok(npc.victim.invulnerable > 0);
});

test('police injuring an innocent by car or gun are demoted and jailed; wanted targets remain lawful', () => {
  const impact = trafficImpact({ police: true }); impact.sim.tick(.1);
  assert.ok(impact.driver.jail > 0); assert.equal(impact.driver.role, 'civilian'); assert.equal(impact.driver.vehicle, null);
  const pursuit = trafficImpact({ police: true, wanted: 2 }); pursuit.sim.tick(.1); assert.equal(pursuit.driver.jail, 0); assert.equal(pursuit.driver.role, 'police');
  const sim = new Simulation(), officer = sim.addPlayer('officer', 'Officer', 'police'), innocent = sim.addPlayer('innocent', 'Innocent'); sim.vehicles = []; sim.pedestrians = [];
  Object.assign(officer, { x: 0, z: 0 }); Object.assign(innocent, { x: 0, z: 8, invulnerable: 0 });
  sim.setInput(officer.id, { aim: true }); sim.shoot(officer.id);
  assert.equal(innocent.health, 75); assert.equal(officer.role, 'civilian'); assert.equal(officer.jail, JAIL_DURATION);
  assert.deepEqual(sim.events.find(e => e.type === 'shot').from, { x: 0, y: 1.5, z: 0 });
  advance(sim, JAIL_DURATION + 1); assert.equal(officer.role, 'civilian'); assert.equal(officer.jail, 0);
});

test('cuffs require a nearby police officer and wanted suspect; they freeze actions and expire', () => {
  const sim = new Simulation(), officer = sim.addPlayer('officer', 'Officer', 'police'), suspect = sim.addPlayer('suspect', 'Suspect');
  sim.vehicles = []; sim.pedestrians = []; Object.assign(officer, { x: 0, z: 0 }); Object.assign(suspect, { x: 0, z: 3 });
  sim.cuff(officer.id); assert.equal(suspect.cuffed, 0);
  suspect.wanted = 2; officer.x = 20; sim.cuff(officer.id); assert.equal(suspect.cuffed, 0);
  officer.x = 0; sim.cuff(suspect.id); assert.equal(officer.cuffed, 0);
  sim.cuff(officer.id); assert.equal(suspect.cuffed, CUFF_DURATION); assert.equal(suspect.cuffedBy, officer.id);
  const position = { x: suspect.x, z: suspect.z };
  for (let tick = 0; tick < 30; tick++) { sim.setInput(suspect.id, { up: true, aim: true }); sim.shoot(suspect.id); sim.tick(1 / 30); }
  sim.interact(suspect.id); sim.delivery(suspect.id); assert.equal(suspect.ammo, 12); assert.equal(suspect.delivery, false); assert.equal(suspect.x, position.x); assert.equal(suspect.z, position.z);
  advance(sim, CUFF_DURATION); assert.equal(suspect.cuffed, 0); assert.equal(suspect.cuffedBy, null);
  sim.cuff(officer.id); assert.ok(suspect.cuffed > 0); sim.removePlayer(officer.id); assert.equal(suspect.cuffed, 0);
});

test('cuffing extracts a stopped suspect safely; arrest clears cuffs and fast vehicles cannot be cuffed', () => {
  const sim = new Simulation(), officer = sim.addPlayer('officer', 'Officer', 'police'), suspect = sim.addPlayer('suspect', 'Suspect');
  const car = sim.vehicles[0]; sim.vehicles = [car]; sim.pedestrians = [];
  Object.assign(car, { x: 0, z: 0, driver: suspect.id }); Object.assign(officer, { x: 0, z: 4 }); Object.assign(suspect, { x: 0, z: 0, vehicle: car.id, wanted: 2, speed: 10 });
  sim.cuff(officer.id); assert.equal(suspect.cuffed, 0);
  suspect.speed = 0; sim.cuff(officer.id); assert.equal(suspect.vehicle, null); assert.equal(car.driver, null); assert.ok(suspect.cuffed > 0); assert.equal(blocked(suspect.x, suspect.z), false);
  sim.interact(officer.id); assert.ok(suspect.jail > 0); assert.equal(suspect.cuffed, 0); assert.equal(suspect.cuffedBy, null);
});

test('bank walls block handcuffs and police arrests despite close distance', () => {
  const sim = new Simulation(), officer = sim.addPlayer('officer', 'Officer', 'police'), suspect = sim.addPlayer('suspect', 'Suspect');
  sim.vehicles = []; sim.pedestrians = [];
  Object.assign(officer, { x: 24, z: 60 }); Object.assign(suspect, { x: 28, z: 60, wanted: 2 });
  sim.cuff(officer.id); sim.interact(officer.id); assert.equal(suspect.cuffed, 0); assert.equal(suspect.jail, 0);
});

test('roleplay fields and actions are integrated into live simulation and snapshots', () => {
  const sim = new Simulation(), p = sim.addPlayer('one', 'Player'); sim.vehicles = [];
  assert.equal(p.bankTools, 1); Object.assign(p, LANDMARKS.bank); sim.interact(p.id);
  assert.equal(p.bankTools, 0); advance(sim, 1); const progress = p.heist; sim.interact(p.id); assert.equal(p.heist, progress);
  Object.assign(p, LANDMARKS.garage); sim.tick(.1); sim.buyBankTools(p.id); assert.equal(p.bankTools, 1); assert.equal(p.cash, 1900);
  Object.assign(p, { x: 0, z: 0, yaw: 0 }); const npc = sim.pedestrians[0]; sim.pedestrians = [npc]; Object.assign(npc, { x: 0, z: -1.4 });
  sim.setInput(p.id, { aim: true }); sim.hostage(p.id); assert.equal(npc.hostageBy, p.id); sim.tick(.1);
  assert.equal(npc.x, 0); assert.equal(npc.z, -1.4, 'normal pedestrian route must not override hostage follow');
  const snapshot = sim.snapshot(); assert.equal(snapshot.players[0].bankTools, 1); assert.equal(snapshot.players[0].hostageId, npc.id); assert.ok(snapshot.players[0].hostageTime > 0); assert.equal(snapshot.pedestrians[0].hostageBy, p.id);
  sim.removePlayer(p.id); sim.tick(.1); assert.equal(npc.hostageBy, null);
});
