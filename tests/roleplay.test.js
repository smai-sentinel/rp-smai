import test from 'node:test';
import assert from 'node:assert/strict';
import { LANDMARKS, blocked, distance } from '../shared/world.js';
import {
  initializeRoleplayPlayer, buyBankTools, beginBankHeist,
  takeOrReleaseHostage, updateRoleplay, HOSTAGE_DURATION,
} from '../shared/roleplay.js';

function fixture() {
  const player = initializeRoleplayPlayer({ id: 'a', role: 'civilian', x: 0, z: 0, yaw: 0, health: 100,
    cash: 2500, wanted: 0, alertAt: 0, heist: 0, jail: 0, cuffed: 0, vehicle: null, input: { aim: true } });
  const npc = { id: 'ped-0', x: 0, z: 2, yaw: 0, speed: 1.3, health: 100, route: [{ x: 0, z: 12 }] };
  const sim = { players: new Map([[player.id, player]]), pedestrians: [npc], events: [], time: 5,
    notice(to, text, kind = 'info') { this.events.push({ to, text, kind }); },
    jailPlayer(p) { p.jail = 30; p.wanted = 0; p.cash -= 500; p.x = -60; p.z = -75; },
  };
  return { sim, player, npc };
}

test('new players receive one kit and no hostage; kits cost $600 and cap at three', () => {
  const { sim, player } = fixture();
  assert.equal(player.bankTools, 1); assert.equal(player.hostageId, null); assert.equal(player.hostageTime, 0);
  Object.assign(player, LANDMARKS.garage);
  assert.equal(buyBankTools(sim, player.id), true); assert.equal(player.cash, 1900); assert.equal(player.bankTools, 2);
  assert.equal(buyBankTools(sim, player.id), true); assert.equal(player.cash, 1300); assert.equal(player.bankTools, 3);
  assert.equal(buyBankTools(sim, player.id), false); assert.equal(player.cash, 1300); assert.equal(player.bankTools, 3);
});

test('kit purchase checks location, funds, jail and cuffs before charging', () => {
  const { sim, player } = fixture();
  assert.equal(buyBankTools(sim, player.id), false);
  Object.assign(player, LANDMARKS.garage, { cash: 599 });
  assert.equal(buyBankTools(sim, player.id), false); assert.equal(player.cash, 599);
  player.cash = 2500; player.jail = 1;
  assert.equal(buyBankTools(sim, player.id), false);
  player.jail = 0; player.cuffed = 10;
  assert.equal(buyBankTools(sim, player.id), false); assert.equal(player.cash, 2500); assert.equal(player.bankTools, 1);
});

test('a heist consumes one kit exactly once and repeated interaction never resets progress', () => {
  const { sim, player } = fixture();
  Object.assign(player, LANDMARKS.bank);
  assert.equal(beginBankHeist(sim, player), true); assert.equal(player.bankTools, 0);
  assert.equal(player.heist, .01); assert.equal(player.wanted, 3); assert.equal(player.alertAt, sim.time);
  player.heist = 8;
  assert.equal(beginBankHeist(sim, player), false); assert.equal(player.heist, 8); assert.equal(player.bankTools, 0);
  player.heist = 0;
  assert.equal(beginBankHeist(sim, player), false); assert.equal(player.heist, 0);
  player.bankTools = 1; player.cuffed = 4;
  assert.equal(beginBankHeist(sim, player), false); assert.equal(player.bankTools, 1);
});

test('hostages require aiming and an available healthy nearby NPC, then raise wanted level', () => {
  const { sim, player, npc } = fixture();
  player.input.aim = false;
  assert.equal(takeOrReleaseHostage(sim, player.id), false);
  player.input.aim = true; npc.down = 1;
  assert.equal(takeOrReleaseHostage(sim, player.id), false);
  npc.down = 0; npc.health = 0;
  assert.equal(takeOrReleaseHostage(sim, player.id), false);
  npc.health = 100; npc.z = 3.3;
  assert.equal(takeOrReleaseHostage(sim, player.id), false);
  npc.z = 2;
  assert.equal(takeOrReleaseHostage(sim, player.id), true);
  assert.equal(npc.hostageBy, player.id); assert.equal(player.hostageId, npc.id);
  assert.equal(player.hostageTime, HOSTAGE_DURATION); assert.equal(player.wanted, 3); assert.equal(player.alertAt, sim.time);
});

test('one NPC cannot have two owners; repeating the action releases without damage', () => {
  const { sim, player, npc } = fixture();
  const second = initializeRoleplayPlayer({ ...player, id: 'b' }); sim.players.set(second.id, second);
  assert.equal(takeOrReleaseHostage(sim, player.id), true);
  assert.equal(takeOrReleaseHostage(sim, second.id), false);
  assert.equal(npc.hostageBy, player.id);
  assert.equal(takeOrReleaseHostage(sim, player.id), true);
  assert.equal(npc.hostageBy, null); assert.equal(player.hostageId, null); assert.equal(player.hostageTime, 0); assert.equal(npc.health, 100);
  assert.equal(takeOrReleaseHostage(sim, second.id), true);
});

test('taking hostages while in the police role removes the role and jails the officer', () => {
  const { sim, player, npc } = fixture(); player.role = 'police';
  assert.equal(takeOrReleaseHostage(sim, player.id), false);
  assert.equal(player.role, 'civilian'); assert.equal(player.jail, 30); assert.equal(player.cash, 2000);
  assert.equal(player.hostageId, null); assert.equal(npc.hostageBy, undefined);
  assert.match(sim.events.at(-1).text, /הודחת/);
});

test('hostage follows behind the owner and automatically releases after 45 seconds', () => {
  const { sim, player, npc } = fixture(); const route = npc.route;
  takeOrReleaseHostage(sim, player.id);
  for (let step = 0; step < 40; step++) updateRoleplay(sim, .1);
  assert.ok(Math.abs(distance(player, npc) - 1.4) < .04); assert.ok(npc.z < player.z);
  for (let step = 0; step < 411; step++) updateRoleplay(sim, .1);
  assert.equal(player.hostageId, null); assert.equal(player.hostageTime, 0); assert.equal(npc.hostageBy, null);
  assert.equal(npc.route, route); assert.equal(npc.health, 100);
});

test('hostages release on jail, cuffs, vehicle entry, death, downing or excessive separation', () => {
  const cases = [
    ({ player }) => { player.jail = 2; },
    ({ player }) => { player.cuffed = 3; },
    ({ player }) => { player.vehicle = 'park-0'; },
    ({ player }) => { player.health = 0; },
    ({ npc }) => { npc.down = 2; },
    ({ npc }) => { npc.health = 0; },
    ({ player }) => { player.x = 10; },
  ];
  for (const change of cases) {
    const context = fixture(); takeOrReleaseHostage(context.sim, context.player.id); change(context);
    updateRoleplay(context.sim, .1);
    assert.equal(context.player.hostageId, null); assert.equal(context.npc.hostageBy, null);
  }
});

test('disconnect and stale ownership links release NPCs for normal AI', () => {
  const { sim, player, npc } = fixture();
  takeOrReleaseHostage(sim, player.id); sim.players.delete(player.id); updateRoleplay(sim, .1);
  assert.equal(npc.hostageBy, null);
  sim.players.set(player.id, player); player.hostageId = null; npc.hostageBy = player.id;
  updateRoleplay(sim, .1); assert.equal(npc.hostageBy, null);
});

test('hostages cannot be acquired or dragged through bank walls', () => {
  const { sim, player, npc } = fixture();
  Object.assign(player, { x: 24.5, z: 60 }); Object.assign(npc, { x: 27.5, z: 60 });
  assert.equal(takeOrReleaseHostage(sim, player.id), false);
  Object.assign(player, { x: 28, z: 60 }); Object.assign(npc, { x: 28, z: 62 });
  assert.equal(takeOrReleaseHostage(sim, player.id), true);
  Object.assign(player, { x: 24, z: 60, yaw: Math.PI / 2 });
  for (let step = 0; step < 40; step++) updateRoleplay(sim, .1);
  assert.ok(npc.x >= 27.3); assert.equal(blocked(npc.x, npc.z, .3), false);
});
