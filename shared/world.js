export const WORLD = { min: -415, max: 415, roadWidth: 24, grid: 120, population: 32, maxPlayers: 16 };
export const ROADS = [-360, -240, -120, 0, 120, 240, 360];
export const LANDMARKS = {
  bank: { x: 60, z: 66, label: 'בנק סנטינל', en: 'SENTINEL BANK', color: '#e7cc87' },
  police: { x: -60, z: -27, label: 'תחנת משטרה', en: 'SMAI POLICE', color: '#80bcff' },
  jail: { x: -60, z: -75, label: 'בית כלא', en: 'COUNTY JAIL', color: '#b0bfcc' },
  garage: { x: 180, z: 20, label: 'מוסך ורכבים', en: 'COAST CUSTOMS', color: '#ddfca0' },
  hideout: { x: -300, z: 319, label: 'נקודת מילוט', en: 'THE HIDEOUT', color: '#d2a1ef' },
  delivery: { x: 300, z: 392, label: 'משלוח לטיילת', en: 'OCEAN PIER', color: '#79dfd7' },
  hospital: { x: -180, z: 21, label: 'בית חולים', en: 'SMAI MEDICAL', color: '#f69c96' },
};
export function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export const rand = rng(8741);
export const buildings = [];
export const parks = [];
const reserved = new Set(['60,60', '-60,-60', '180,60', '-180,60', '-300,300']);
for (let x = -300; x <= 300; x += 120) for (let z = -300; z <= 300; z += 120) {
  if (reserved.has(`${x},${z}`)) continue;
  if ((x === -60 && z === 180) || (x === 180 && z === -180) || (x === 300 && z === 300)) { parks.push({ x, z }); continue; }
  for (const dx of [-23, 23]) for (const dz of [-23, 23]) {
    const downtown = Math.abs(x) < 210 && z < 150;
    buildings.push({ x: x + dx, z: z + dz, w: 29 + rand() * 8, d: 28 + rand() * 8,
      h: downtown ? 24 + rand() * 70 : 9 + rand() * 28, style: Math.floor(rand() * 4), seed: Math.floor(rand() * 10000) });
  }
}
export const obstacles = buildings.map(b => ({ x: b.x, z: b.z, w: b.w, d: b.d }));
// The bank has a real walkable lobby, an open entrance and a vault.
obstacles.push(
  { x: 26, z: 61, w: 2, d: 56 }, { x: 94, z: 61, w: 2, d: 56 },
  { x: 60, z: 89, w: 70, d: 2 }, { x: 39, z: 33, w: 28, d: 2 }, { x: 81, z: 33, w: 28, d: 2 },
  { x: -60, z: -67, w: 76, d: 64 }, { x: 180, z: 65, w: 76, d: 50 },
  { x: -180, z: 64, w: 72, d: 60 }, { x: -300, z: 279, w: 70, d: 46 },
);
// The city geometry is static. Index its AABBs once so movement/camera queries
// inspect nearby walls instead of scanning every building on every substep.
const COLLISION_CELL = 48;
const minCell = Math.floor(WORLD.min / COLLISION_CELL);
const cellCount = Math.floor(WORLD.max / COLLISION_CELL) - minCell + 1;
const collisionCells = Array.from({ length: cellCount * cellCount }, () => []);
for (const obstacle of obstacles) {
  const x0 = Math.floor((obstacle.x - obstacle.w / 2) / COLLISION_CELL);
  const x1 = Math.floor((obstacle.x + obstacle.w / 2) / COLLISION_CELL);
  const z0 = Math.floor((obstacle.z - obstacle.d / 2) / COLLISION_CELL);
  const z1 = Math.floor((obstacle.z + obstacle.d / 2) / COLLISION_CELL);
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    collisionCells[(x - minCell) * cellCount + z - minCell].push(obstacle);
  }
}
export function blocked(x, z, radius = 0.5) {
  if (x < WORLD.min + radius || x > WORLD.max - radius || z < WORLD.min + radius || z > WORLD.max - radius) return true;
  const x0 = Math.floor((x - radius) / COLLISION_CELL), x1 = Math.floor((x + radius) / COLLISION_CELL);
  const z0 = Math.floor((z - radius) / COLLISION_CELL), z1 = Math.floor((z + radius) / COLLISION_CELL);
  for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
    const nearby = collisionCells[(cx - minCell) * cellCount + cz - minCell];
    for (const b of nearby || []) if (Math.abs(x - b.x) < b.w / 2 + radius && Math.abs(z - b.z) < b.d / 2 + radius) return true;
  }
  return false;
}
export function moveBody(body, dx, dz, radius) {
  let hit = false;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.7));
  for (let i = 0; i < steps; i++) {
    if (!blocked(body.x + dx / steps, body.z, radius)) body.x += dx / steps; else hit = true;
    if (!blocked(body.x, body.z + dz / steps, radius)) body.z += dz / steps; else hit = true;
  }
  return hit;
}
export function distance(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
export function district(x, z) { return z > 285 ? 'OCEAN DRIVE' : x < -220 ? 'WESTSIDE' : z < -200 ? 'NORTH HEIGHTS' : x > 140 ? 'PALM DISTRICT' : 'SENTINEL DOWNTOWN'; }
