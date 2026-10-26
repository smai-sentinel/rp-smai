const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const approach = (value, target, amount) => value + clamp(target - value, -amount, amount);
const specifications = [
  { topSpeed: 58, power: 8.5 },
  { topSpeed: 46, power: 6.5 },
  { topSpeed: 51, power: 7.3 },
];
export const WHEELBASE = 2.7;
export const MAX_LATERAL_ACCELERATION = 9.5;

// Lightweight bicycle handling in metres, seconds and radians. This is shared
// by the authoritative server and solo mode; rendering never decides motion.
export function driveCar(car, input, dt) {
  const spec = specifications[car.model] || specifications[1];
  const direction = Number(input.up === true) - Number(input.down === true);
  const opposite = direction !== 0 && car.speed * direction < 0;
  car.braking = !!input.brake || (!!input.up && !!input.down) || opposite;
  if (car.braking) {
    // Crossing zero consumes this tick: pressing reverse first brakes to a stop.
    car.speed = approach(car.speed, 0, (input.brake ? 14 : 11) * dt);
  } else {
    if (direction) {
      const limit = direction > 0 ? spec.topSpeed : 11;
      const power = direction > 0 ? spec.power : 4.5;
      const torque = power * (1 - .7 * Math.min(1, (car.speed / limit) ** 2));
      car.speed += direction * torque * dt;
    }
    const drag = .24 + .00065 * car.speed ** 2;
    car.speed = approach(car.speed, 0, drag * dt);
    car.speed = clamp(car.speed, -11, spec.topSpeed);
  }
  const speed = Math.abs(car.speed);
  // Reduce wheel lock at speed and return smoothly to centre when released.
  const wheelLock = .56 / (1 + (speed / 19) ** 1.35);
  const steering = Number(input.left === true) - Number(input.right === true);
  car.steer = approach(car.steer || 0, steering * wheelLock, (steering ? 1.7 : 2.4) * dt);
  const desiredYawRate = car.speed / WHEELBASE * Math.tan(car.steer);
  const gripLimit = MAX_LATERAL_ACCELERATION / Math.max(3, speed);
  const yawRate = clamp(desiredYawRate, -gripLimit, gripLimit);
  car.yaw = Math.atan2(Math.sin(car.yaw + yawRate * dt), Math.cos(car.yaw + yawRate * dt));
}
