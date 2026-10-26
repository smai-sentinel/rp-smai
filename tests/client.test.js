import test from 'node:test';
import assert from 'node:assert/strict';
import { gameServerURL, roomInvite } from '../src/network.js';
import { stickInput } from '../src/touch.js';

test('public invitation preserves the Pages path and contains only a normalized room', () => {
  const url = roomInvite({ href: 'https://smai-sentinel.github.io/rp-smai/?controls=touch&password=ignored#map' }, 'friends-42');
  assert.equal(url, 'https://smai-sentinel.github.io/rp-smai/?room=FRIENDS-42');
  assert.equal(gameServerURL('https://game.example.com/', new URL(url)), 'https://game.example.com');
  assert.equal(gameServerURL('', new URL(url)), null);
  assert.equal(gameServerURL('', new URL('http://localhost:3000/')), 'http://localhost:3000');
  assert.throws(() => gameServerURL('http://game.example.com', new URL(url)), /HTTPS/);
});

test('touch stick has a dead zone, bounded diagonal movement and sprint only forward', () => {
  const neutral = stickInput(2, -3, 50); assert.equal(neutral.up, false); assert.equal(neutral.left, false);
  const forward = stickInput(100, -100, 50); assert.equal(forward.up, true); assert.equal(forward.right, true); assert.equal(forward.sprint, true);
  assert.ok(Math.hypot(forward.x, forward.y) <= 1.000001);
  const reverse = stickInput(0, 100, 50); assert.equal(reverse.down, true); assert.equal(reverse.sprint, false);
});
