import test from 'node:test';
import assert from 'node:assert/strict';
import { isTypingTarget, gameplayAvailable, movementInput, keyboardLook, FireLimiter, chatDestination } from '../src/controls.js';
import { GameAudio } from '../src/audio.js';

test('arrows move normally, aim rotates the camera, and WASD remains available', () => {
  const keys = new Set(['ArrowUp', 'ArrowLeft', 'KeyD']);
  assert.equal(movementInput(keys).up, true);
  assert.equal(movementInput(keys).left, true);
  const aimed = movementInput(keys, { aiming: true });
  assert.equal(aimed.up, false); assert.equal(aimed.left, false); assert.equal(aimed.right, true);
  const look = keyboardLook(keys, { aiming: true, yaw: 0, pitch: 0 }, 1 / 30);
  assert.ok(look.yaw > 0); assert.ok(look.pitch > 0);
  assert.deepEqual(keyboardLook(keys, { aiming: false, yaw: 2, pitch: .1 }, .03), { yaw: 2, pitch: .1 });
});

test('typing, menus, focus loss, and disconnection disable every movement input', () => {
  for (const target of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { isContentEditable: true }, { closest: () => ({}) }]) {
    assert.equal(isTypingTarget(target), true);
  }
  assert.equal(isTypingTarget({ tagName: 'CANVAS' }), false);
  for (const blocked of [{ modal: true }, { typing: true }, { focused: false }, { hidden: true }, { connected: false }, { started: false }]) {
    assert.equal(gameplayAvailable({ started: true, ...blocked }), false);
  }
  const input = movementInput(new Set(['KeyW', 'KeyA', 'ShiftLeft', 'Space']), { aiming: true, disabled: true, touch: { down: true, brake: true } });
  for (const key of ['up', 'down', 'left', 'right', 'sprint', 'brake', 'aim']) assert.equal(input[key], false);
  assert.deepEqual(keyboardLook(new Set(['ArrowLeft']), { aiming: true, disabled: true, yaw: 1, pitch: 0 }, .03), { yaw: 1, pitch: 0 });
});

test('held fire is paced without bursts after a stalled frame or repeated keydown', () => {
  const limiter = new FireLimiter();
  assert.equal(limiter.take(0), true);
  for (const time of [0, .01, .15, .249]) assert.equal(limiter.take(time), false);
  assert.equal(limiter.take(.25), true);
  assert.equal(limiter.take(4), true);
  assert.equal(limiter.take(4), false);
  assert.equal(limiter.take(NaN), false);
});

test('keyboard aim clamps elevation and gives Shift precise control', () => {
  const keys = new Set(['ArrowUp']);
  assert.equal(keyboardLook(keys, { aiming: true, yaw: 0, pitch: .54 }, 2).pitch, .55);
  const normal = keyboardLook(keys, { aiming: true, yaw: 0, pitch: 0 }, .03).pitch;
  keys.add('ShiftLeft');
  assert.ok(keyboardLook(keys, { aiming: true, yaw: 0, pitch: 0 }, .03).pitch < normal);
});

test('audio startup returns immediately even if browser resume never settles', () => {
  const audio = new GameAudio();
  audio.ctx = { state: 'suspended', resume: () => new Promise(() => {}) };
  assert.equal(audio.start(), true);
});

test('slash commands never reach public chat, including login-like text', () => {
  for (const text of ['/heal', '  /cash "Test Player" 500', '/login private-token']) {
    assert.equal(chatDestination(text, { online: true, admin: false }), 'blocked');
    assert.equal(chatDestination(text, { online: false, admin: true }), 'blocked');
    assert.equal(chatDestination(text, { online: true, admin: true }), 'admin');
  }
  assert.equal(chatDestination('hello / friend', { online: true }), 'chat');
  assert.equal(chatDestination('hello', { online: false }), 'local');
  assert.equal(chatDestination('  ', { online: true, admin: true }), 'empty');
});
