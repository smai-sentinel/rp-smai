import { WORLD, ROADS, LANDMARKS, distance, moveBody, blocked, rng } from './world.js';
export const TICK_RATE = 30;
export const BANK_DURATION = 14;
export const JAIL_DURATION = 30;
export const cleanText = (s, n = 180) => typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, n) : '';
const noopInput = () => ({ up: false, down: false, left: false, right: false, sprint: false, brake: false, aim: false, yaw: 0, pitch: 0 });
export function sanitizeInput(data) {
  const i = noopInput();
  if (!data || typeof data !== 'object') return i;
  for (const k of ['up', 'down', 'left', 'right', 'sprint', 'brake', 'aim']) i[k] = data[k] === true;
  i.yaw = Number.isFinite(data.yaw) ? Math.atan2(Math.sin(data.yaw), Math.cos(data.yaw)) : 0;
  i.pitch = Number.isFinite(data.pitch) ? Math.max(-.65, Math.min(.65, data.pitch)) : 0;
  return i;
}
const colors = ['#b9d8d2', '#c95736', '#e4d7c7', '#253942', '#c3a561', '#66808d', '#771e35', '#d9dfdf'];
export class Simulation {
  constructor(seed = 42) {
    this.players = new Map(); this.time = 0; this.clock = 17.3; this.bankCooldown = 0; this.events = [];
    this.random = rng(seed); this.vehicles = []; this.pedestrians = []; this.nextEvent = 0;
    const spots = [[26, 8], [36, 8], [46, 8], [165, 20], [178, 20], [191, 20], [-27, -8], [-180, 20], [-296, 328], [296, 378]];
    spots.forEach(([x, z], i) => this.vehicles.push(this.car(`park-${i}`, x, z, i === 0 ? '#bade97' : colors[i % colors.length], i % 3)));
    for (let i = 0; i < 18; i++) {
      const x = ROADS[i % 6], z = ROADS[Math.floor(i / 6) * 2];
      const c = this.car(`traffic-${i}`, x + 5, z + 20, colors[i % colors.length], i % 3);
      c.ai = 'traffic'; c.route = [{ x: x + 5, z: z + 115 }, { x: x + 115, z: z + 115 }, { x: x + 115, z: z + 5 }, { x: x + 5, z: z + 5 }]; c.waypoint = 0;
      this.vehicles.push(c);
    }
    for (let i = 0; i < 4; i++) {
      const c = this.car(`police-${i}`, -15 - i * 7, -8, '#dce4e5', 2);
      c.police = true; c.ai = 'police'; c.path = []; c.repath = 0; this.vehicles.push(c);
    }
    for (let i = 0; i < 32; i++) {
      const x = ROADS[i % 6] + 16, z = ROADS[Math.floor(i / 6)] + 16;
      this.pedestrians.push({ id: `ped-${i}`, x, z, yaw: 0, color: colors[i % 8], phase: this.random() * 6, waypoint: 1,
        route: [{ x, z }, { x: x + 88, z }, { x: x + 88, z: z + 88 }, { x, z: z + 88 }] });
    }
  }
  car(id, x, z, color, model) { return { id, x, z, yaw: Math.PI / 2, speed: 0, color, model, driver: null, ai: null, police: false, siren: false, health: 100 }; }
  addPlayer(id, name, role = 'civilian') {
    if (this.players.has(id)) return this.players.get(id);
    if (this.players.size >= WORLD.maxPlayers) return null;
    const offset = this.players.size * 2;
    const p = { id, name: cleanText(name, 20) || 'אורח', role: role === 'police' ? 'police' : 'civilian', x: 24 + offset, z: 4,
      yaw: 0, speed: 0, health: 100, cash: 2500, loot: 0, wanted: 0, vehicle: null, input: noopInput(),
      jail: 0, arrest: 0, heist: 0, delivery: false, earned: 0, actionAt: -10, alertAt: 0, still: 0,
      ammo: 12, reserve: 120, reload: 0, shotAt: -10, aiming: false, invulnerable: 5 };
    this.players.set(id, p); this.notice(id, 'ברוכים הבאים לעיר. הרכב הראשון מחכה לידכם. E כדי להיכנס.'); return p;
  }
  removePlayer(id) {
    const p = this.players.get(id);
    if (p?.vehicle) { const c = this.vehicles.find(c => c.id === p.vehicle); if (c) { c.driver = null; c.speed = 0; } }
    this.players.delete(id);
  }
  setInput(id, data) { const p = this.players.get(id); if (p) { p.input = sanitizeInput(data); p.lastInput = this.time; } }
  notice(to, text, kind = 'info') { this.events.push({ id: ++this.nextEvent, to, text, kind }); if (this.events.length > 80) this.events.shift(); }
  interact(id) {
    const p = this.players.get(id); if (!p || p.jail > 0 || this.time - p.actionAt < 0.5) return;
    p.actionAt = this.time;
    if (p.vehicle) {
      const c = this.vehicles.find(c => c.id === p.vehicle);
      if (Math.abs(c.speed) > 4) { this.notice(id, 'עצור את הרכב לפני היציאה.'); return; }
      const offsets = [Math.PI / 2, -Math.PI / 2, Math.PI, 0];
      const spot = offsets.map(a => ({ x: c.x + Math.sin(c.yaw + a) * 3, z: c.z + Math.cos(c.yaw + a) * 3 })).find(s => !blocked(s.x, s.z, .5));
      if (!spot) { this.notice(id, 'אין מספיק מקום לפתוח את הדלת.'); return; }
      Object.assign(p, spot); p.vehicle = null; c.driver = null; c.speed = 0; return;
    }
    if (p.role === 'police') {
      const target = [...this.players.values()].find(t => t.id !== id && t.wanted && !t.jail && distance(p, t) < 8 && Math.abs(t.speed) < 5);
      if (target) { this.jailPlayer(target); p.cash += 750; this.notice(id, 'החשוד נעצר. בונוס סיור: $750', 'success'); return; }
    }
    if (distance(p, LANDMARKS.bank) < 7) {
      if (p.role === 'police') { this.notice(id, 'אתה בתפקיד שוטר. הגן על הבנק ועצור חשודים.'); return; }
      if (this.bankCooldown > 0) { this.notice(id, `הבנק נעול לעוד ${Math.ceil(this.bankCooldown)} שניות.`); return; }
      if (p.loot > 0) { this.notice(id, 'קח את השלל לנקודת המילוט לפני שוד נוסף.'); return; }
      if ([...this.players.values()].some(t => t.heist > 0 && t.id !== id)) { this.notice(id, 'שוד כבר מתבצע בכספת.'); return; }
      p.heist = .01; p.wanted = 3; p.alertAt = this.time; this.notice(null, 'דיווח משטרתי: אזעקה בבנק סנטינל.', 'danger'); return;
    }
    if (distance(p, LANDMARKS.hideout) < 10 && p.loot > 0) {
      if (this.vehicles.some(c => c.police && c.siren && distance(c, p) < 36)) { this.notice(id, 'המשטרה קרובה מדי. הרחק את המרדף מנקודת המילוט.'); return; }
      p.cash += p.loot; p.earned += p.loot; this.notice(id, `השוד הושלם! $${p.loot.toLocaleString()} הופקדו.`, 'success'); p.loot = 0; p.wanted = 0; return;
    }
    if (distance(p, LANDMARKS.delivery) < 12 && p.delivery) {
      p.cash += 900; p.earned += 900; p.delivery = false; this.notice(id, 'המשלוח הגיע לטיילת. הרווחת $900.', 'success'); return;
    }
    const car = this.vehicles.filter(c => !c.driver && distance(c, p) < 6 && Math.abs(c.speed) < 3).sort((a, b) => distance(a, p) - distance(b, p))[0];
    if (car) {
      if (car.police && p.role !== 'police') { p.wanted = Math.max(2, p.wanted); p.alertAt = this.time; this.notice(id, 'גניבת ניידת! המשטרה מחפשת אותך.', 'danger'); }
      car.driver = id; car.ai = null; p.vehicle = car.id; p.heist = 0; p.x = car.x; p.z = car.z; p.yaw = car.yaw; return;
    }
    if (distance(p, LANDMARKS.garage) < 15) { this.garage(id); return; }
    this.notice(id, 'אין פעולה קרובה. M לפתיחת המפה והיעדים.');
  }
  garage(id) {
    const p = this.players.get(id); if (!p || p.jail || distance(p, LANDMARKS.garage) > 22) return;
    if (p.cash < 200) { this.notice(id, 'תיקון ושינוי צבע עולים $200.'); return; }
    const c = this.vehicles.filter(v => distance(v, p) < 10 && (!v.driver || v.driver === id)).sort((a, b) => distance(a, p) - distance(b, p))[0];
    if (!c) { this.notice(id, 'הבא רכב אל המוסך.'); return; }
    c.health = 100; c.color = colors[Math.floor(this.random() * colors.length)]; p.health = 100; p.cash -= 200; this.notice(id, 'הרכב תוקן ונצבע מחדש. נסיעה טובה!', 'success');
  }
  delivery(id) { const p = this.players.get(id); if (!p || p.jail) return; p.delivery = true; this.notice(id, 'משלוח חדש: סע לטיילת, צא מהרכב ולחץ E ליד הסימון.'); }
  siren(id) { const p = this.players.get(id), c = this.vehicles.find(v => v.id === p?.vehicle); if (c?.police && p.role === 'police') c.siren = !c.siren; }
  reload(id) { const p = this.players.get(id); if (p && !p.jail && !p.reload && p.ammo < 12 && p.reserve > 0) p.reload = 1.8; }
  shoot(id) {
    const p = this.players.get(id);
    if (!p || p.jail || p.vehicle || !p.input.aim || p.reload || this.time - p.shotAt < .24) return;
    if (p.ammo <= 0) { this.reload(id); return; }
    p.ammo--; p.shotAt = this.time; p.yaw = p.input.yaw;
    if (p.role !== 'police') { p.wanted = Math.max(2, p.wanted); p.alertAt = this.time; }
    const dx = Math.sin(p.input.yaw), dz = Math.cos(p.input.yaw); let endpoint = { x: p.x + dx * 90, y: 1.5 + Math.tan(p.input.pitch) * 90, z: p.z + dz * 90 }, hit = false;
    const candidates = [...this.players.values(), ...this.pedestrians];
    for (let d = .8; d < 90; d += .4) {
      const x = p.x + dx * d, z = p.z + dz * d, y = 1.5 + Math.tan(p.input.pitch) * d;
      if (blocked(x, z, .05) || y < .1) { endpoint = { x, y: Math.max(.1, y), z }; break; }
      const target = candidates.find(t => t.id !== id && !t.jail && !t.down && !t.invulnerable && Math.hypot(t.x - x, t.z - z) < .65 && y > .1 && y < 1.9);
      if (target) {
        hit = true; endpoint = { x, y, z }; target.health = (target.health ?? 100) - 25;
        if (target.id.startsWith('ped') && target.health <= 0) { target.down = 12; target.health = 100; }
        if (p.role === 'police' && !target.wanted) { p.cash = Math.max(0, p.cash - 250); this.notice(id, 'ירי באזרח: קנס משמעתי $250.', 'danger'); }
        break;
      }
    }
    this.events.push({ id: ++this.nextEvent, type: 'shot', to: null, shooter: id, from: { x: p.x, y: 1.5, z: p.z }, end: endpoint, hit });
  }
  jailPlayer(p) {
    if (p.vehicle) { const c = this.vehicles.find(c => c.id === p.vehicle); c.driver = null; c.speed = 0; p.vehicle = null; }
    p.x = -60; p.z = -75; p.jail = JAIL_DURATION; p.loot = 0; p.wanted = 0; p.heist = 0; p.arrest = 0; p.cash = Math.max(0, p.cash - 500); p.speed = 0;
    this.notice(p.id, 'נעצרת. השלל הוחרם וקיבלת קנס של $500. שחרור בעוד 30 שניות.', 'danger');
  }
  tick(dt) {
    dt = Math.max(0, Math.min(dt, .1)); this.time += dt; this.clock = (17.3 + this.time / 90) % 24; this.bankCooldown = Math.max(0, this.bankCooldown - dt);
    for (const p of this.players.values()) {
      p.invulnerable = Math.max(0, p.invulnerable - dt);
      if (p.reload > 0) { p.reload = Math.max(0, p.reload - dt); if (!p.reload) { const amount = Math.min(12 - p.ammo, p.reserve); p.ammo += amount; p.reserve -= amount; } }
      p.aiming = p.input.aim && !p.vehicle && !p.jail;
      if (this.time - (p.lastInput ?? 0) > .5) p.input = noopInput();
      if (p.jail > 0) { p.jail = Math.max(0, p.jail - dt); if (p.jail === 0) { p.x = -60; p.z = -24; p.health = 100; this.notice(p.id, 'שוחררת מהכלא. התחלה חדשה.'); } continue; }
      const i = p.input;
      if (p.vehicle) {
        const c = this.vehicles.find(c => c.id === p.vehicle);
        let acceleration = (i.up ? 19 : 0) - (i.down ? 22 : 0);
        c.speed += acceleration * dt;
        if (!i.up && !i.down) c.speed *= Math.exp(-.65 * dt);
        if (i.brake) c.speed *= Math.exp(-5.5 * dt);
        c.speed = Math.max(-14, Math.min(c.model === 0 ? 63 : c.model === 1 ? 47 : 52, c.speed));
        c.yaw += ((i.left ? 1 : 0) - (i.right ? 1 : 0)) * Math.sign(c.speed) * Math.min(Math.abs(c.speed) / 8, 1) * (i.brake ? 2.4 : 1.25) * dt;
        const hit = moveBody(c, Math.sin(c.yaw) * c.speed * dt, Math.cos(c.yaw) * c.speed * dt, 1.4);
        if (hit && Math.abs(c.speed) > 7) { const damage = Math.abs(c.speed) * .32; c.health = Math.max(10, c.health - damage); p.health = Math.max(0, p.health - damage * .45); c.speed *= -.16; }
        p.x = c.x; p.z = c.z; p.yaw = c.yaw; p.speed = c.speed;
      } else {
        let forward = (i.up ? 1 : 0) - (i.down ? 1 : 0), strafe = (i.left ? 1 : 0) - (i.right ? 1 : 0);
        const norm = Math.hypot(forward, strafe) || 1; forward /= norm; strafe /= norm;
        const speed = i.aim ? 2.3 : i.sprint ? 8 : 4.6;
        const dx = (Math.sin(i.yaw) * forward + Math.cos(i.yaw) * strafe) * speed * dt;
        const dz = (Math.cos(i.yaw) * forward - Math.sin(i.yaw) * strafe) * speed * dt;
        if (dx || dz) { moveBody(p, dx, dz, .5); p.yaw = Math.atan2(dx, dz); }
        p.speed = Math.hypot(dx, dz) / Math.max(dt, .001);
        if (p.aiming) p.yaw = i.yaw;
      }
      if (p.heist > 0) {
        if (distance(p, LANDMARKS.bank) > 8 || p.vehicle) { p.heist = 0; this.notice(p.id, 'השוד בוטל: התרחקת מהכספת.'); }
        else { p.heist += dt; if (p.heist >= BANK_DURATION) { p.heist = 0; p.loot = 12500; this.bankCooldown = 95; p.alertAt = this.time; this.notice(p.id, 'הכספת נפתחה! אסוף את השלל בנקודת המילוט הסגולה במפה.', 'success'); } }
      }
      const nearbyCop = this.vehicles.some(c => c.police && c.siren && c.driver !== p.id && distance(c, p) < 11);
      if (p.wanted > 0 && nearbyCop && Math.abs(p.speed) < 6) { p.arrest += dt; if (p.arrest > 3.5) this.jailPlayer(p); }
      else p.arrest = Math.max(0, p.arrest - dt * 1.5);
      if (p.wanted > 0 && !p.loot && !p.heist && this.time - p.alertAt > 65 && !nearbyCop) { p.wanted = 0; this.notice(p.id, 'הצלחת להיעלם. החיפוש הסתיים.'); }
      if (p.health <= 0) {
        if (p.vehicle) { const c = this.vehicles.find(c => c.id === p.vehicle); c.driver = null; c.speed = 0; }
        Object.assign(p, { vehicle: null, x: -180, z: 21, health: 100, wanted: 0, loot: 0, heist: 0, arrest: 0, invulnerable: 5, cash: Math.max(0, p.cash - 300) });
        this.notice(p.id, 'טופלת בבית החולים. עלות טיפול: $300.');
      }
    }
    for (const c of this.vehicles) {
      if (c.driver) continue;
      if (c.ai === 'traffic') this.follow(c, c.route, dt, 9 + c.model * 2);
      if (c.ai === 'police') {
        const target = [...this.players.values()].filter(p => p.wanted > 0 && !p.jail).sort((a, b) => distance(c, a) - distance(c, b))[0];
        c.siren = !!target;
        if (target) {
          if (distance(c, target) < 35) {
            const speed = distance(c, target) < 7 ? 0 : 14; c.yaw = Math.atan2(target.x - c.x, target.z - c.z); c.speed = speed;
            moveBody(c, Math.sin(c.yaw) * speed * dt, Math.cos(c.yaw) * speed * dt, 1.2);
          } else {
            c.repath -= dt;
            if (c.repath <= 0 || !c.path.length) { c.path = this.policeRoute(c, target); c.waypoint = 0; c.repath = 2; }
            this.follow(c, c.path, dt, 27, false);
          }
        } else { c.speed = 0; }
      }
    }
    // Lightweight collision response between occupied cars and traffic/parked cars.
    for (let i = 0; i < this.vehicles.length; i++) for (let j = i + 1; j < this.vehicles.length; j++) {
      const a = this.vehicles[i], b = this.vehicles[j]; if (!a.driver && !b.driver) continue;
      const d = distance(a, b); if (d >= 3.1 || d < .001) continue;
      const nx = (a.x - b.x) / d, nz = (a.z - b.z) / d, impact = Math.abs(a.speed - b.speed);
      moveBody(a, nx * (3.1 - d) * .5, nz * (3.1 - d) * .5, 1.4); moveBody(b, -nx * (3.1 - d) * .5, -nz * (3.1 - d) * .5, 1.4);
      if (impact > 4) { a.speed *= -.12; b.speed *= -.12; a.health = Math.max(10, a.health - impact * .2); b.health = Math.max(10, b.health - impact * .2); }
    }
    for (const p of this.pedestrians) { if (p.down > 0) p.down = Math.max(0, p.down - dt); else this.follow(p, p.route, dt, 1.3); }
  }
  policeRoute(c, target) {
    const snap = a => Math.max(-360, Math.min(360, Math.round(a / 120) * 120));
    const start = { x: snap(c.x), z: snap(c.z) }, end = { x: snap(target.x), z: snap(target.z) };
    const points = Math.abs(c.x - start.x) < Math.abs(c.z - start.z) ? [{ x: start.x, z: c.z }, start] : [{ x: c.x, z: start.z }, start];
    let x = start.x, z = start.z;
    while (x !== end.x) { x += Math.sign(end.x - x) * 120; points.push({ x, z }); }
    while (z !== end.z) { z += Math.sign(end.z - z) * 120; points.push({ x, z }); }
    if (!blocked(target.x, end.z, 1.2)) points.push({ x: target.x, z: end.z });
    points.push({ x: target.x, z: target.z }); return points;
  }
  follow(body, route, dt, speed, loop = true) {
    if (!route?.length) return; const point = route[body.waypoint || 0]; if (!point) return;
    const dist = distance(body, point);
    if (dist < 2) { body.waypoint = loop ? ((body.waypoint || 0) + 1) % route.length : Math.min(route.length - 1, (body.waypoint || 0) + 1); body.speed = 0; return; }
    body.yaw = Math.atan2(point.x - body.x, point.z - body.z); body.speed = speed;
    moveBody(body, Math.sin(body.yaw) * Math.min(dist, speed * dt), Math.cos(body.yaw) * Math.min(dist, speed * dt), body.id.startsWith('ped') ? .3 : 1.2);
  }
  snapshot() {
    return { time: this.time, clock: this.clock, bankCooldown: this.bankCooldown,
      players: [...this.players.values()].map(({ input, actionAt, lastInput, ...p }) => p),
      vehicles: this.vehicles.map(({ route, path, repath, waypoint, ...c }) => c),
      pedestrians: this.pedestrians.map(({ route, waypoint, ...p }) => p) };
  }
}
