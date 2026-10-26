import { LANDMARKS, blocked, distance, moveBody } from './world.js';

export const BANK_TOOL_PRICE = 600;
export const MAX_BANK_TOOLS = 3;
export const HOSTAGE_DURATION = 45;
export const HOSTAGE_REACH = 3.2;

// These fields are owned by the simulation, never copied from action payloads.
export function initializeRoleplayPlayer(player) {
  player.bankTools = 1;
  player.hostageId = null;
  player.hostageTime = 0;
  return player;
}

export function buyBankTools(sim, id) {
  const player = sim.players.get(id);
  if (!player || player.jail > 0 || player.cuffed > 0) return false;
  if (distance(player, LANDMARKS.garage) >= 22) {
    sim.notice(id, 'ערכות לשוד נמכרות במוסך. התקרב לדלפק הציוד.');
    return false;
  }
  if (player.bankTools >= MAX_BANK_TOOLS) {
    sim.notice(id, 'אפשר לשאת עד 3 ערכות לשוד.');
    return false;
  }
  if (player.cash < BANK_TOOL_PRICE) {
    sim.notice(id, 'ערכת שוד עולה $600. אין לך מספיק כסף.');
    return false;
  }
  player.cash -= BANK_TOOL_PRICE;
  player.bankTools++;
  sim.notice(id, `קנית ערכת שוד ב־$600. ברשותך ${player.bankTools} ערכות.`, 'success');
  return true;
}

// Call only after the bank's proximity, role, cooldown and competing-heist checks.
// Keeping the active-heist check here makes repeat interaction harmless.
export function beginBankHeist(sim, player) {
  if (!player || player.heist > 0) return false;
  if (player.role !== 'civilian' || player.jail > 0 || player.cuffed > 0 || player.vehicle) return false;
  if (!(player.bankTools > 0)) {
    sim.notice(player.id, 'כדי להתחיל שוד דרושה ערכת שוד. קנה ערכה במוסך ב־$600.');
    return false;
  }
  player.bankTools--;
  player.heist = .01;
  player.wanted = Math.max(3, player.wanted || 0);
  player.alertAt = sim.time;
  sim.notice(null, 'דיווח משטרתי: אזעקה בבנק סנטינל.', 'danger');
  return true;
}

function visiblePath(from, to) {
  const steps = Math.max(1, Math.ceil(distance(from, to) / .25));
  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    if (blocked(from.x + (to.x - from.x) * t, from.z + (to.z - from.z) * t, .05)) return false;
  }
  return true;
}

function release(sim, player, message) {
  for (const npc of sim.pedestrians) {
    if (npc.hostageBy === player.id) { npc.hostageBy = null; npc.speed = 0; }
  }
  player.hostageId = null;
  player.hostageTime = 0;
  if (message) sim.notice(player.id, message);
}

export function takeOrReleaseHostage(sim, id) {
  const player = sim.players.get(id);
  if (!player) return false;
  if (player.role === 'police') {
    release(sim, player);
    player.role = 'civilian';
    sim.jailPlayer(player);
    sim.notice(id, 'ניסיון לקחת בן ערובה בתפקיד שוטר: הודחת מהמשטרה ונשלחת לכלא.', 'danger');
    return false;
  }
  if (player.hostageId) {
    release(sim, player, 'שחררת את בן הערובה.');
    return true;
  }
  if (player.vehicle || player.jail > 0 || player.cuffed > 0 || player.health <= 0) return false;
  if (!(player.input?.aim || player.aiming)) {
    sim.notice(id, 'כדי לקחת בן ערובה: הפעל כוונת והתקרב לדמות ברחוב.');
    return false;
  }
  const npc = sim.pedestrians
    .filter(n => !n.hostageBy && !(n.down > 0) && (n.health ?? 100) > 0 && distance(player, n) <= HOSTAGE_REACH && visiblePath(player, n))
    .sort((a, b) => distance(player, a) - distance(player, b))[0];
  if (!npc) {
    sim.notice(id, 'אין דמות פנויה בטווח. התקרב לדמות ברחוב.');
    return false;
  }
  npc.hostageBy = player.id;
  npc.speed = 0;
  player.hostageId = npc.id;
  player.hostageTime = HOSTAGE_DURATION;
  player.wanted = Math.max(3, player.wanted || 0);
  player.alertAt = sim.time;
  sim.notice(id, 'בן הערובה הולך אחריך לזמן מוגבל. לחץ שוב על Z לשחרור.', 'danger');
  sim.notice(null, 'דיווח משטרתי: אזרח מוחזק כבן ערובה.', 'danger');
  return true;
}

// Run after player movement, before pedestrian AI. AI must skip hostageBy NPCs.
export function updateRoleplay(sim, dt) {
  const elapsed = Number.isFinite(dt) ? Math.max(0, dt) : 0;
  // Covers disconnects and stale links without retaining departed player data.
  for (const npc of sim.pedestrians) {
    if (!npc.hostageBy) continue;
    const owner = sim.players.get(npc.hostageBy);
    if (!owner || owner.hostageId !== npc.id) { npc.hostageBy = null; npc.speed = 0; }
  }
  for (const player of sim.players.values()) {
    if (!player.hostageId) continue;
    const npc = sim.pedestrians.find(n => n.id === player.hostageId && n.hostageBy === player.id);
    const invalidOwner = player.vehicle || player.jail > 0 || player.cuffed > 0 || player.health <= 0 || player.role !== 'civilian';
    if (!npc || invalidOwner || npc.down > 0 || (npc.health ?? 100) <= 0 || distance(player, npc) > 5) {
      release(sim, player, 'בן הערובה שוחרר.');
      continue;
    }
    player.hostageTime = Math.max(0, player.hostageTime - elapsed);
    if (player.hostageTime <= 0) {
      release(sim, player, 'הזמן הסתיים. בן הערובה השתחרר.');
      continue;
    }
    const target = { x: player.x - Math.sin(player.yaw) * 1.4, z: player.z - Math.cos(player.yaw) * 1.4 };
    const dx = target.x - npc.x, dz = target.z - npc.z, gap = Math.hypot(dx, dz);
    const travel = Math.min(gap, 6 * elapsed);
    const previousX = npc.x, previousZ = npc.z;
    if (gap > .03 && travel > 0) {
      moveBody(npc, dx / gap * travel, dz / gap * travel, .3);
      npc.yaw = Math.atan2(npc.x - previousX, npc.z - previousZ);
    } else npc.yaw = player.yaw;
    npc.speed = elapsed > 0 ? Math.hypot(npc.x - previousX, npc.z - previousZ) / elapsed : 0;
  }
}
