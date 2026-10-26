// These helpers are independent of the DOM so keyboard safety stays testable.
export function isTypingTarget(target) {
  if (!target) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName?.toUpperCase()) ||
    !!target.isContentEditable || !!target.closest?.('[contenteditable="true"], [contenteditable=""]');
}

export function gameplayAvailable({ started, modal = false, typing = false, focused = true, hidden = false, connected = true }) {
  return !!started && !modal && !typing && focused && !hidden && connected;
}

export function movementInput(keys, { aiming = false, disabled = false, touch = {}, yaw = 0, pitch = 0 } = {}) {
  const held = code => !disabled && keys.has(code);
  const direction = (letter, arrow, name) => !disabled && (keys.has(letter) || (!aiming && keys.has(arrow)) || !!touch[name]);
  return {
    up: direction('KeyW', 'ArrowUp', 'up'), down: direction('KeyS', 'ArrowDown', 'down'),
    left: direction('KeyA', 'ArrowLeft', 'left'), right: direction('KeyD', 'ArrowRight', 'right'),
    sprint: held('ShiftLeft') || held('ShiftRight') || (!disabled && !!touch.sprint),
    brake: held('Space') || (!disabled && !!touch.brake), aim: !disabled && aiming, yaw, pitch,
  };
}

export function keyboardLook(keys, { aiming, disabled = false, yaw, pitch }, dt) {
  if (!aiming || disabled) return { yaw, pitch };
  const step = Math.max(0, Math.min(.05, dt)) * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? .5 : 1.35);
  return {
    yaw: yaw + ((keys.has('ArrowLeft') ? 1 : 0) - (keys.has('ArrowRight') ? 1 : 0)) * step,
    pitch: Math.max(-.45, Math.min(.55, pitch + ((keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0)) * step)),
  };
}

export class FireLimiter {
  constructor(interval = .25) { this.interval = interval; this.nextAt = -Infinity; }
  take(now) {
    if (!Number.isFinite(now) || now < this.nextAt) return false;
    this.nextAt = now + this.interval;
    return true;
  }
}

// Slash commands are private control messages; never fall back to public chat.
export function chatDestination(text, { online = false, admin = false } = {}) {
  if (!String(text).trim()) return 'empty';
  if (String(text).trim().startsWith('/')) return online && admin ? 'admin' : 'blocked';
  return online ? 'chat' : 'local';
}
