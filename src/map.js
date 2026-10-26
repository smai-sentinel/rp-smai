import { buildings, ROADS, LANDMARKS } from '../shared/world.js';
const icons = { bank: '$', police: '★', jail: '▥', garage: 'G', hideout: 'H', delivery: 'D', hospital: '+' };
export function drawMap(canvas, state, me, waypoint, full = false) {
  const ctx = canvas.getContext('2d'), size = canvas.width; ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#18373e'; ctx.fillRect(0, 0, size, size);
  const span = full ? 940 : 260, scale = size / span; const cx = full ? 0 : me?.x || 0, cz = full ? 0 : me?.z || 0;
  const x = v => (v - cx) * scale + size / 2, y = v => (v - cz) * scale + size / 2;
  ctx.fillStyle = '#263b3e'; ctx.fillRect(x(-425), y(-425), 850 * scale, 850 * scale);
  ctx.fillStyle = '#405053';
  for (const b of buildings) ctx.fillRect(x(b.x - b.w / 2), y(b.z - b.d / 2), b.w * scale, b.d * scale);
  ctx.strokeStyle = '#718080'; ctx.lineWidth = 24 * scale;
  for (const r of ROADS) { ctx.beginPath(); ctx.moveTo(x(r), y(-420)); ctx.lineTo(x(r), y(420)); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x(-420), y(r)); ctx.lineTo(x(420), y(r)); ctx.stroke(); }
  ctx.strokeStyle = '#c0b59c'; ctx.lineWidth = 9 * scale; ctx.beginPath(); ctx.moveTo(x(-420), y(410)); ctx.lineTo(x(420), y(410)); ctx.stroke();
  if (waypoint && me) {
    ctx.setLineDash([6, 4]); ctx.strokeStyle = '#ddfca0'; ctx.lineWidth = full ? 2 : 3; ctx.beginPath(); ctx.moveTo(x(me.x), y(me.z)); ctx.lineTo(x(waypoint.x), y(me.z)); ctx.lineTo(x(waypoint.x), y(waypoint.z)); ctx.stroke(); ctx.setLineDash([]);
  }
  for (const [key, l] of Object.entries(LANDMARKS)) {
    const px = x(l.x), py = y(l.z); if (px < 0 || py < 0 || px > size || py > size) continue;
    ctx.fillStyle = '#14252b'; ctx.beginPath(); ctx.arc(px, py, full ? 13 : 10, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = l.color; ctx.font = `bold ${full ? 14 : 11}px Arial`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(icons[key], px, py);
  }
  for (const p of state.players) {
    ctx.save(); ctx.translate(x(p.x), y(p.z)); ctx.rotate(-p.yaw); ctx.fillStyle = p.id === me?.id ? '#ddfca0' : '#ffffff';
    ctx.beginPath(); ctx.moveTo(0, 7); ctx.lineTo(-5, -5); ctx.lineTo(0, -2); ctx.lineTo(5, -5); ctx.closePath(); ctx.fill(); ctx.restore();
  }
  if (me?.wanted) for (const c of state.vehicles.filter(c => c.police)) { ctx.fillStyle = '#62a2ee'; ctx.beginPath(); ctx.arc(x(c.x), y(c.z), 3, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#ffffff99'; ctx.font = '10px Arial'; ctx.textAlign = 'left'; ctx.fillText('N ↑', 12, 17);
}
