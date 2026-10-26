import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { blocked, distance } from '../shared/world.js';

const LOGIN_WINDOW = 5 * 60 * 1000;
const MAX_IP_BUCKETS = 2048;
const HELP = [
  '/help — פקודות ניהול; שמות עם רווחים יש להקיף במרכאות.',
  '/heal [name] · /repair [name] — ברירת המחדל היא השחקן שלך.',
  '/cash name amount — הוסף או הפחת סכום של עד $100,000.',
  '/jail name seconds — כלא ל־1–600 שניות; /release name — שחרור.',
  '/kick name · /tp name · /bring name · /setrole name civilian|police',
  '/ban name [minutes] — חסימת אורח ל־1–1440 דקות (ברירת מחדל 60); /unban BAN-ID; /bans',
  'אפשר להשתמש במזהה שחקן מדויק במקום שם. הפקודות פועלות בחדר הנוכחי בלבד.',
  'חסימות אורח תקפות בדפדפן המזוהה בכל חדרי השרת, עד תפוגה או אתחול השרת. מחיקת נתוני הדפדפן יוצרת זהות אורח חדשה.',
].join('\n');

function take(bucket, max, windowMs, now) {
  if (now - bucket.since >= windowMs) { bucket.since = now; bucket.count = 0; }
  if (bucket.count >= max) return false;
  bucket.count++;
  return true;
}

function parseCommand(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 300 || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value)) {
    throw new Error('פקודה לא תקינה. האורך המרבי הוא 300 תווים.');
  }
  const tokens = []; let index = 0;
  while (index < value.length) {
    while (/\s/u.test(value[index] || '') && index < value.length) index++;
    if (index >= value.length) break;
    let token = '';
    if (value[index] === '"' || value[index] === "'") {
      const quote = value[index++]; let closed = false;
      while (index < value.length) {
        const char = value[index++];
        if (char === quote) { closed = true; break; }
        if (char === '\\' && (value[index] === quote || value[index] === '\\')) token += value[index++];
        else token += char;
      }
      if (!closed || (index < value.length && !/\s/u.test(value[index]))) throw new Error('בדוק שהמרכאות סביב שם השחקן סגורות.');
    } else {
      while (index < value.length && !/\s/u.test(value[index])) token += value[index++];
    }
    if (!token) throw new Error('חסר שם שחקן או ערך בפקודה.');
    tokens.push(token);
  }
  if (!/^\/[a-z]+$/i.test(tokens[0] || '')) throw new Error('פקודת ניהול מתחילה ב־/. הקלד /help לעזרה.');
  return { action: tokens[0].slice(1).toLowerCase(), args: tokens.slice(1) };
}

function targetInRoom(sim, name, defaultPlayer) {
  if (name === undefined && defaultPlayer) return defaultPlayer;
  if (!name) throw new Error('צריך לציין שם או מזהה שחקן.');
  if (sim.players.has(name)) return sim.players.get(name);
  const matches = [...sim.players.values()].filter(player => player.name === name);
  if (!matches.length) throw new Error('השחקן לא נמצא בחדר שלך.');
  if (matches.length > 1) throw new Error('יש כמה שחקנים בשם הזה. השתמש במזהה השחקן המדויק.');
  return matches[0];
}

function integer(text, min, max) {
  if (typeof text !== 'string' || !/^[+-]?\d+$/.test(text)) throw new Error('הערך חייב להיות מספר שלם.');
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`הערך חייב להיות בין ${min} ל־${max}.`);
  return value;
}

function stopPlayer(sim, player) {
  const car = sim.vehicles.find(candidate => candidate.id === player.vehicle);
  if (car?.driver === player.id) { car.driver = null; car.speed = 0; car.steer = 0; car.braking = false; }
  player.vehicle = null; player.speed = 0; player.aiming = false; player.heist = 0;
  sim.setInput(player.id, {});
  for (const npc of sim.pedestrians) if (npc.hostageBy === player.id) { npc.hostageBy = null; npc.speed = 0; }
  player.hostageId = null; player.hostageTime = 0;
}

function teleportNear(sim, moving, destination) {
  if (moving.jail > 0 || destination.jail > 0 || moving.cuffed > 0 || destination.cuffed > 0) {
    throw new Error('אי אפשר לשגר שחקן כלוא או אזוק, או להשתגר אליו. השתמש ב־/release תחילה.');
  }
  let spot;
  for (const radius of [3.8, 6, 9]) {
    for (let step = 0; step < 16; step++) {
      const angle = step * Math.PI / 8;
      const candidate = { x: destination.x + Math.sin(angle) * radius, z: destination.z + Math.cos(angle) * radius };
      if (!blocked(candidate.x, candidate.z, .5) && !sim.vehicles.some(car => distance(car, candidate) < 3.3)) { spot = candidate; break; }
    }
    if (spot) break;
  }
  if (!spot) throw new Error('לא נמצא מקום פנוי ובטוח ליד השחקן.');
  stopPlayer(sim, moving);
  Object.assign(moving, spot, { invulnerable: Math.max(moving.invulnerable || 0, 3) });
}

function execute({ io, socket, sim, actor, action, args, bans }) {
  const counts = { help: [0, 0], heal: [0, 1], repair: [0, 1], cash: [2, 2], jail: [2, 2], release: [1, 1], kick: [1, 1], tp: [1, 1], bring: [1, 1], setrole: [2, 2], ban: [1, 2], unban: [1, 1], bans: [0, 0] };
  if (!Object.hasOwn(counts, action)) throw new Error('פקודה לא מוכרת. הקלד /help לרשימת הפקודות.');
  const [min, max] = counts[action];
  if (args.length < min || args.length > max) throw new Error('מספר הפרטים בפקודה אינו נכון. הקלד /help לעזרה.');
  if (action === 'help') return { message: HELP };
  if (action === 'bans') return { message: bans.list() };
  if (action === 'unban') {
    bans.remove(args[0]);
    return { message: `החסימה ${args[0]} בוטלה.`, value: args[0] };
  }
  const target = targetInRoom(sim, args[0], ['heal', 'repair'].includes(action) ? actor : undefined);
  let value, afterReply;
  if (action === 'heal') {
    target.health = 100; target.invulnerable = Math.max(target.invulnerable || 0, 3);
  } else if (action === 'repair') {
    const car = sim.vehicles.find(c => c.id === target.vehicle && c.driver === target.id)
      || sim.vehicles.filter(c => !c.driver && distance(c, target) < 12).sort((a, b) => distance(a, target) - distance(b, target))[0];
    if (!car) throw new Error('אין רכב של השחקן או רכב פנוי קרוב לתיקון.');
    car.health = 100;
  } else if (action === 'cash') {
    value = integer(args[1], -100000, 100000);
    const cash = target.cash + value;
    if (!Number.isSafeInteger(cash) || cash < 0 || cash > 1_000_000_000) throw new Error('הפעולה תחרוג מיתרה מותרת של $0–$1,000,000,000.');
    target.cash = cash;
  } else if (action === 'jail') {
    value = integer(args[1], 1, 600);
    stopPlayer(sim, target); sim.jailPlayer(target); target.jail = value;
    sim.notice(target.id, `מנהל השרת שלח אותך לכלא ל־${value} שניות.`, 'danger');
  } else if (action === 'release') {
    const wasJailed = target.jail > 0;
    stopPlayer(sim, target);
    Object.assign(target, { jail: 0, cuffed: 0, cuffedBy: null, arrest: 0, wanted: 0, health: 100, invulnerable: 5 });
    if (wasJailed) Object.assign(target, { x: -60, z: -24 });
  } else if (action === 'kick') {
    const targetSocket = io.sockets.sockets.get(target.id);
    if (!targetSocket || targetSocket.data.room !== socket.data.room) throw new Error('השחקן כבר אינו מחובר לחדר.');
    afterReply = () => { targetSocket.emit('admin:removed', { reason: 'kick', message: 'הוצאת מהשרת בידי מנהל.' }); targetSocket.disconnect(true); };
  } else if (action === 'ban') {
    value = args[1] === undefined ? 60 : integer(args[1], 1, 1440);
    const targetSocket = io.sockets.sockets.get(target.id);
    if (!targetSocket || targetSocket.data.room !== socket.data.room || !targetSocket.data.guestId) throw new Error('השחקן כבר אינו מחובר לחדר או שזהותו אינה זמינה.');
    const ban = bans.add(targetSocket.data.guestId, target.name, value);
    return { targetId: target.id, value: ban.id,
      message: `האורח ${target.name} נחסם ל־${value} דקות. מזהה: ${ban.id}. זו חסימת דפדפן זמנית, שאינה נשמרת באתחול השרת.`,
      afterReply: () => {
        for (const peer of io.sockets.sockets.values()) if (peer.data.guestId === targetSocket.data.guestId) {
          peer.emit('admin:removed', { reason: 'ban', message: 'הגישה של האורח הזה לשרת נחסמה זמנית בידי מנהל.' });
          peer.disconnect(true);
        }
      },
    };
  } else if (action === 'tp') teleportNear(sim, actor, target);
  else if (action === 'bring') teleportNear(sim, target, actor);
  else if (action === 'setrole') {
    if (!['civilian', 'police'].includes(args[1])) throw new Error('התפקיד חייב להיות civilian או police.');
    value = args[1];
    if (target.role !== value) { sim.releaseCuffs(target.id); stopPlayer(sim, target); target.role = value; }
  }
  return { message: `הפקודה /${action} בוצעה עבור ${target.name}.`, targetId: target.id, value, afterReply };
}

/** Create once per server; attach(socket, () => joinedRoom) once per connection. */
export function createAdminHandlers({ io, adminToken = process.env.ADMIN_TOKEN || '', now = Date.now,
  audit = entry => console.info(JSON.stringify(entry)) } = {}) {
  const token = typeof adminToken === 'string' && adminToken.length <= 512 ? adminToken : '';
  const expectedHash = createHash('sha256').update(token).digest();
  const guestKey = token || randomBytes(32);
  const signGuest = id => createHmac('sha256', guestKey).update(`rp-smai-guest-v1:${id}`).digest();
  const ips = new Map(), guestBans = new Map();
  const clearExpiredBans = () => { for (const [id, ban] of guestBans) if (ban.expiresAt <= now()) guestBans.delete(id); };
  const bans = {
    add(guestId, name, minutes) {
      clearExpiredBans();
      const existing = [...guestBans.values()].find(ban => ban.guestId === guestId);
      if (!existing && guestBans.size >= 1000) throw new Error('רשימת החסימות מלאה. בטל חסימה ישנה לפני הוספת חסימה.');
      let id = existing?.id;
      if (!id) { do { id = `BAN-${randomUUID().slice(0, 8).toUpperCase()}`; } while (guestBans.has(id)); }
      const ban = { id, guestId, name, expiresAt: now() + minutes * 60000 };
      guestBans.set(id, ban); return ban;
    },
    remove(id) {
      clearExpiredBans();
      if (!guestBans.delete(id)) throw new Error('לא נמצאה חסימה פעילה עם המזהה הזה.');
    },
    list() {
      clearExpiredBans();
      if (!guestBans.size) return 'אין חסימות אורח פעילות.';
      const rows = [...guestBans.values()].sort((a, b) => a.expiresAt - b.expiresAt);
      return [`חסימות פעילות: ${rows.length} (מוצגות עד 50).`, ...rows.slice(0, 50).map(ban => `${ban.id} · ${ban.name} · עד ${new Date(ban.expiresAt).toISOString()}`)].join('\n');
    },
  };
  function attachAdmin(socket, getRoom) {
    socket.data.admin = false;
    const logins = { since: now(), count: 0 }, commands = { since: now(), count: 0 };
    // Use the actual transport peer, never a user-supplied forwarding header.
    const ip = createHash('sha256').update(String(socket.handshake?.address || socket.conn?.remoteAddress || 'unknown')).digest('hex');
    const record = (type, data = {}) => audit({ type, createdAt: new Date(now()).toISOString(), actorId: socket.id, room: socket.data.room || null, ...data });
    const context = () => {
      const room = getRoom(), sim = room?.sim, actor = sim?.players.get(socket.id);
      if (!socket.data.room || !actor) throw new Error('צריך להצטרף לחדר לפני שימוש בניהול.');
      return { sim, actor };
    };
    socket.on('admin:login', (data, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        context();
        if (!token) return reply({ error: 'ניהול השרת אינו מוגדר. המפעיל צריך להגדיר ADMIN_TOKEN.' });
        const timestamp = now();
        for (const [key, bucket] of ips) if (timestamp - bucket.since >= LOGIN_WINDOW) ips.delete(key);
        if (!ips.has(ip)) {
          if (ips.size >= MAX_IP_BUCKETS) return reply({ error: 'יש יותר מדי ניסיונות כניסה. נסה שוב מאוחר יותר.' });
          ips.set(ip, { since: timestamp, count: 0 });
        }
        if (!take(logins, 5, LOGIN_WINDOW, timestamp) || !take(ips.get(ip), 5, LOGIN_WINDOW, timestamp)) {
          return reply({ error: 'אפשר לבצע עד 5 ניסיונות כניסה בחמש דקות. נסה שוב מאוחר יותר.' });
        }
        const provided = typeof data?.token === 'string' && data.token.length <= 512 ? data.token : '';
        const valid = timingSafeEqual(createHash('sha256').update(provided).digest(), expectedHash);
        socket.data.admin = valid;
        record('admin-auth', { ok: valid });
        return reply(valid ? { ok: true } : { error: 'מפתח הניהול אינו נכון.' });
      } catch (error) { return reply({ error: error.message }); }
    });
    socket.on('admin:command', (data, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try {
        if (socket.data.admin !== true) return reply({ error: 'צריך להתחבר כמנהל לפני הפעלת פקודות.' });
        const { sim, actor } = context();
        if (!take(commands, 10, 10000, now())) return reply({ error: 'אפשר להפעיל עד 10 פקודות בעשר שניות.' });
        const { action, args } = parseCommand(data?.command);
        const result = execute({ io, socket, sim, actor, action, args, bans });
        record('admin-action', { action, targetId: result.targetId || null, ...(result.value !== undefined ? { value: result.value } : {}) });
        reply({ ok: true, message: result.message });
        if (result.afterReply) queueMicrotask(result.afterReply);
      } catch (error) { reply({ error: error.message }); }
    });
    socket.on('disconnect', () => { socket.data.admin = false; });
  }
  // The opaque guest credential is returned only to its own browser in join ACKs.
  // It identifies a browser, not an account: clearing storage creates a new guest.
  attachAdmin.identify = (socket, supplied) => {
    let guestId;
    if (typeof supplied === 'string' && supplied.length <= 256) {
      const match = /^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.([A-Za-z0-9_-]{43})$/.exec(supplied);
      if (match) {
        const provided = Buffer.from(match[2], 'base64url'), expected = signGuest(match[1]);
        if (provided.length === expected.length && timingSafeEqual(provided, expected)) guestId = match[1];
      }
    }
    guestId ||= randomUUID(); socket.data.guestId = guestId;
    return { guestToken: `${guestId}.${signGuest(guestId).toString('base64url')}` };
  };
  attachAdmin.checkBan = socket => {
    clearExpiredBans();
    return [...guestBans.values()].some(ban => ban.guestId === socket.data.guestId)
      ? 'הגישה של האורח הזה לשרת נחסמה זמנית בידי מנהל.' : null;
  };
  return attachAdmin;
}
