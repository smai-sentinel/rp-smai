export function gameServerURL(configured, location) {
  if (!configured) return location.hostname.endsWith('.github.io') ? null : location.origin;
  const url = new URL(configured);
  if (!['https:', 'http:'].includes(url.protocol) || (location.protocol === 'https:' && url.protocol !== 'https:')) throw new Error('שרת המשחק חייב להשתמש ב־HTTPS.');
  return url.origin;
}

export function roomInvite(location, room) {
  const url = new URL(location.href);
  url.search = ''; url.hash = '';
  url.searchParams.set('room', String(room).toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20) || 'SMAI');
  return url.href;
}
