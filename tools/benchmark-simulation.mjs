import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const modulePath = resolve(process.argv[2] || 'shared/simulation.js');
const { Simulation } = await import(pathToFileURL(modulePath));
function run() {
  const sim = new Simulation(42);
  for (let i = 0; i < 16; i++) {
    const p = sim.addPlayer(`bench-${i}`, `Player ${i}`);
    if (i < 8) {
      const car = sim.vehicles[i];
      car.driver = p.id; car.ai = null; p.vehicle = car.id;
      p.x = car.x; p.z = car.z;
    } else { p.x = 0; p.z = (i - 8) * 8; }
  }
  let bytes = 0, snapshots = 0;
  const start = performance.now();
  for (let tick = 0; tick < 1000; tick++) {
    for (let i = 0; i < 16; i++) sim.setInput(`bench-${i}`, {
      up: true, left: i < 8 && tick % 180 > 130, yaw: i % 2 ? 0 : Math.PI / 2,
      sprint: i >= 8 && tick % 120 < 60,
    });
    sim.tick(1 / 30);
    if (tick % 2 === 0) { bytes += Buffer.byteLength(JSON.stringify(sim.snapshot())); snapshots++; }
  }
  return { milliseconds: +(performance.now() - start).toFixed(2), meanSnapshotBytes: Math.round(bytes / snapshots) };
}
run();
const runs = Array.from({ length: 9 }, run).sort((a, b) => a.milliseconds - b.milliseconds);
console.log(JSON.stringify({ modulePath, seed: 42, players: 16, ticks: 1000, snapshots: 500, median: runs[4], runs }, null, 2));
