import test from 'node:test';
import assert from 'node:assert/strict';
import { driveCar, MAX_LATERAL_ACCELERATION } from '../shared/driving.js';

const car = speed => ({ model: 0, speed, yaw: 0, steer: 0 });
test('accelerator builds speed progressively, handbrake stops without reverse, reverse first brakes', () => {
  const vehicle = car(0);
  for (let tick = 0; tick < 30; tick++) driveCar(vehicle, { up: true }, 1 / 30);
  assert.ok(vehicle.speed > 6 && vehicle.speed < 10, 'sports car takes several seconds to reach road speed');
  let crossedZero = false;
  for (let tick = 0; tick < 90; tick++) {
    const before = vehicle.speed;
    driveCar(vehicle, { down: true }, 1 / 30);
    if (before > 0) assert.ok(vehicle.speed >= 0, 'braking cannot jump directly to reverse');
    if (before === 0) crossedZero = true;
  }
  assert.ok(crossedZero); assert.ok(vehicle.speed < -1);
  for (let tick = 0; tick < 60; tick++) driveCar(vehicle, { brake: true }, 1 / 30);
  assert.equal(vehicle.speed, 0); assert.equal(vehicle.braking, true);
});

test('steering ramps and returns, cannot turn in place and respects grip at highway speed', () => {
  const stopped = car(0);
  driveCar(stopped, { left: true }, 1 / 30);
  assert.ok(stopped.steer > 0 && stopped.steer < .1); assert.equal(stopped.yaw, 0);
  for (let tick = 0; tick < 30; tick++) driveCar(stopped, { left: true }, 1 / 30);
  const fullLock = stopped.steer;
  driveCar(stopped, {}, 1 / 30); assert.ok(stopped.steer > 0 && stopped.steer < fullLock);
  for (let tick = 0; tick < 30; tick++) driveCar(stopped, {}, 1 / 30);
  assert.equal(stopped.steer, 0);
  const fast = car(50);
  for (let tick = 0; tick < 60; tick++) {
    const yaw = fast.yaw;
    driveCar(fast, { up: true, left: true }, 1 / 30);
    const yawRate = Math.atan2(Math.sin(fast.yaw - yaw), Math.cos(fast.yaw - yaw)) * 30;
    assert.ok(Math.abs(yawRate * fast.speed) <= MAX_LATERAL_ACCELERATION + 1e-8);
  }
  assert.ok(fast.steer < fullLock / 2);
  const backwards = car(-5); driveCar(backwards, { left: true }, 1 / 30);
  assert.ok(backwards.yaw < 0, 'reverse steering changes the body heading in the opposite direction');
});

test('driving is stable across supported simulation tick sizes', () => {
  const regular = car(0), fine = car(0);
  for (let tick = 0; tick < 120; tick++) driveCar(regular, { up: true, left: true }, 1 / 30);
  for (let tick = 0; tick < 240; tick++) driveCar(fine, { up: true, left: true }, 1 / 60);
  assert.ok(Math.abs(regular.speed - fine.speed) < .1);
  assert.ok(Math.abs(regular.yaw - fine.yaw) < .05);
});
