import express from 'express';
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Server } from 'socket.io';
import { Simulation, TICK_RATE, cleanText } from '../shared/simulation.js';
import { WORLD } from '../shared/world.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const passwordMatches = (provided, required) => {
  const a = Buffer.from(typeof provided === 'string' ? provided.slice(0, 256) : ''); const b = Buffer.from(required);
  return a.length === b.length && timingSafeEqual(a, b);
};
export async function createGameServer({ dev = false, password = process.env.ROOM_PASSWORD || '', maxRooms = Number(process.env.MAX_ROOMS) || 20, publicOrigins = (process.env.PUBLIC_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean) } = {}) {
  const app = express(); const http = createServer(app); const rooms = new Map();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin');
    if (publicOrigins.includes(req.headers.origin)) { res.setHeader('Access-Control-Allow-Origin', req.headers.origin); res.vary('Origin'); }
    next();
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true, game: 'RP SMAI', rooms: rooms.size, players: [...rooms.values()].reduce((n, r) => n + r.sim.players.size, 0), capacity: WORLD.maxPlayers }));
  const iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (process.env.TURN_URL) iceServers.push({ urls: process.env.TURN_URL, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
  const io = new Server(http, {
    maxHttpBufferSize: 32768,
    cors: { origin: (origin, cb) => cb(null, !origin || publicOrigins.includes(origin)), methods: ['GET', 'POST'] },
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      if (!origin) return cb(null, true);
      try { cb(null, new URL(origin).host === req.headers.host || publicOrigins.includes(origin)); } catch { cb(null, false); }
    },
  });
  io.on('connection', socket => {
    let room = null, joined = false; const limits = new Map();
    const permit = (key, max, seconds = 1) => {
      const now = Date.now(); const bucket = limits.get(key) || { since: now, count: 0 };
      if (now - bucket.since > seconds * 1000) { bucket.since = now; bucket.count = 0; }
      bucket.count++; limits.set(key, bucket); return bucket.count <= max;
    };
    const timer = setTimeout(() => { if (!joined) socket.disconnect(true); }, 15000);
    socket.on('join', (data, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      if (joined || !permit('join', 5, 10)) return reply({ error: 'נא להמתין לפני ניסיון נוסף.' });
      if (password && !passwordMatches(data?.password, password)) return reply({ error: 'סיסמת השרת אינה נכונה.' });
      const code = cleanText(data?.room, 20).toUpperCase().replace(/[^A-Z0-9-]/g, '') || 'SMAI';
      if (!rooms.has(code)) {
        if (rooms.size >= maxRooms) return reply({ error: 'השרת מלא כרגע. נסה שוב מאוחר יותר.' });
        rooms.set(code, { sim: new Simulation(), emptySince: null });
      }
      room = rooms.get(code);
      const player = room.sim.addPlayer(socket.id, data?.name, data?.role);
      if (!player) return reply({ error: 'החדר מלא (16 שחקנים).' });
      socket.data.room = code; socket.data.voice = false; socket.join(code); joined = true; clearTimeout(timer); room.emptySince = null;
      reply({ id: socket.id, room: code, state: room.sim.snapshot(), iceServers });
      io.to(code).emit('chat', { name: 'מערכת', text: `${player.name} נכנס לעיר.`, system: true });
    });
    socket.on('input', data => { if (joined && permit('input', 50)) room.sim.setInput(socket.id, data); });
    socket.on('action', name => {
      if (!joined || !permit('action', 15)) return;
      const allowed = { interact: 'interact', delivery: 'delivery', siren: 'siren', garage: 'garage', shoot: 'shoot', reload: 'reload' };
      if (Object.hasOwn(allowed, name)) room.sim[allowed[name]](socket.id);
    });
    socket.on('chat', data => {
      if (!joined || !permit('chat', 5, 5)) return;
      const text = cleanText(data); if (!text) return;
      io.to(socket.data.room).emit('chat', { id: socket.id, name: room.sim.players.get(socket.id)?.name || 'אורח', text });
    });
    socket.on('voice:ready', enabled => {
      if (!joined || typeof enabled !== 'boolean' || !permit('voice-ready', 6, 10)) return;
      socket.data.voice = enabled;
      const peers = [...(io.sockets.adapter.rooms.get(socket.data.room) || [])].filter(id => id !== socket.id && io.sockets.sockets.get(id)?.data.voice);
      socket.emit('voice:peers', peers); socket.to(socket.data.room).emit(enabled ? 'voice:joined' : 'voice:left', socket.id);
    });
    socket.on('voice:signal', data => {
      if (!joined || !socket.data.voice || !permit('signal', 80, 5) || !data || typeof data.to !== 'string') return;
      const other = io.sockets.sockets.get(data.to);
      if (!other?.data.voice || other.data.room !== socket.data.room || data.to === socket.id) return;
      if (data.description && ['offer', 'answer'].includes(data.description.type) && typeof data.description.sdp === 'string' && data.description.sdp.length < 20000)
        other.emit('voice:signal', { from: socket.id, description: { type: data.description.type, sdp: data.description.sdp } });
      else if (data.candidate && typeof data.candidate.candidate === 'string' && data.candidate.candidate.length < 2048)
        other.emit('voice:signal', { from: socket.id, candidate: data.candidate });
    });
    socket.on('disconnect', () => { clearTimeout(timer); if (!joined) return; room.sim.removePlayer(socket.id); socket.to(socket.data.room).emit('voice:left', socket.id); if (!room.sim.players.size) room.emptySince = Date.now(); });
  });
  let count = 0;
  const interval = setInterval(() => {
    for (const [code, room] of rooms) {
      if (room.emptySince && Date.now() - room.emptySince > 60000) { rooms.delete(code); continue; }
      if (!room.sim.players.size) continue;
      room.sim.tick(1 / TICK_RATE);
      for (const event of room.sim.events.splice(0)) { if (event.to) io.to(event.to).emit('event', event); else io.to(code).emit('event', event); }
      if (count % 2 === 0) io.to(code).emit('state', room.sim.snapshot());
    }
    count++;
  }, 1000 / TICK_RATE);
  let vite;
  if (dev) { vite = await (await import('vite')).createServer({ root, server: { middlewareMode: true }, appType: 'spa' }); app.use(vite.middlewares); }
  else { app.use(express.static(resolve(root, 'dist'))); app.get('/{*path}', (_req, res) => res.sendFile(resolve(root, 'dist/index.html'))); }
  return { app, http, io, rooms, close: async () => { clearInterval(interval); await vite?.close(); await new Promise(resolve => io.close(resolve)); if (http.listening) await new Promise(resolve => http.close(resolve)); } };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await createGameServer({ dev: process.argv.includes('--dev') });
  const port = Number(process.env.PORT || 3000);
  server.http.listen(port, '0.0.0.0', () => console.log(`RP SMAI listening on http://localhost:${port}`));
  const shutdown = async () => { await server.close(); process.exit(0); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
