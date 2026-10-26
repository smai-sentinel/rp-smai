// Pointer capture keeps each thumb independent, including when it leaves a button.
export function stickInput(dx, dy, radius) {
  const length = Math.hypot(dx, dy), scale = Math.min(1, radius / (length || 1));
  const x = dx * scale / radius, y = dy * scale / radius;
  return { x, y, up: y < -.25, down: y > .25, left: x < -.25, right: x > .25, sprint: length > radius * .85 && y < -.5 };
}

export class TouchControls {
  constructor({ root, canvas, available, look, lookEnd, command, talk }) {
    Object.assign(this, { root, available, command, talk }); this.state = {}; this.activePointers = new Map();
    const stick = root.querySelector('#touch-stick'), knob = root.querySelector('#stick-knob'); this.knob = knob;
    let stickPointer = null, lookPointer = null, lastX = 0, lastY = 0;
    const moveStick = e => {
      const rect = stick.getBoundingClientRect();
      const next = stickInput(e.clientX - rect.left - rect.width / 2, e.clientY - rect.top - rect.height / 2, rect.width * .34);
      Object.assign(this.state, next); knob.style.transform = `translate(${next.x * rect.width * .34}px, ${next.y * rect.height * .34}px)`;
    };
    stick.addEventListener('pointerdown', e => {
      if (!this.enabled || !available() || stickPointer !== null) return;
      e.preventDefault(); stickPointer = e.pointerId; stick.setPointerCapture(e.pointerId); moveStick(e);
    });
    stick.addEventListener('pointermove', e => { if (e.pointerId === stickPointer) { e.preventDefault(); if (available()) moveStick(e); else this.reset(); } });
    const endStick = e => { if (e.pointerId !== stickPointer) return; stickPointer = null; this.state = { brake: this.state.brake }; knob.style.transform = ''; };
    stick.addEventListener('lostpointercapture', endStick); stick.addEventListener('pointercancel', endStick); stick.addEventListener('pointerup', endStick);
    canvas.addEventListener('pointerdown', e => {
      if (!this.enabled || e.pointerType === 'mouse' || !available() || lookPointer !== null) return;
      e.preventDefault(); lookPointer = e.pointerId; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', e => {
      if (e.pointerId !== lookPointer || !available()) return;
      e.preventDefault(); look(e.clientX - lastX, e.clientY - lastY); lastX = e.clientX; lastY = e.clientY;
    });
    const endLook = e => { if (e.pointerId === lookPointer) { lookPointer = null; lookEnd?.(); } };
    canvas.addEventListener('lostpointercapture', endLook); canvas.addEventListener('pointerup', endLook); canvas.addEventListener('pointercancel', endLook);
    this.clearPointers = () => {
      if (stickPointer !== null && stick.hasPointerCapture(stickPointer)) stick.releasePointerCapture(stickPointer);
      if (lookPointer !== null && canvas.hasPointerCapture(lookPointer)) canvas.releasePointerCapture(lookPointer);
      stickPointer = lookPointer = null;
    };
    for (const button of root.querySelectorAll('[data-touch]')) {
      const name = button.dataset.touch;
      button.addEventListener('pointerdown', e => {
        if (!this.enabled || !available() || this.activePointers.has(e.pointerId)) return;
        e.preventDefault(); button.setPointerCapture(e.pointerId); this.activePointers.set(e.pointerId, name); button.classList.add('pressed');
        if (name === 'brake') this.state.brake = true;
        else if (name === 'talk') talk(true);
        else command(name);
      });
      const release = e => {
        if (this.activePointers.get(e.pointerId) !== name) return;
        this.activePointers.delete(e.pointerId); button.classList.remove('pressed');
        if (name === 'brake') this.state.brake = false;
        if (name === 'talk') talk(false);
      };
      button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release); button.addEventListener('lostpointercapture', release);
      button.addEventListener('click', e => { if (e.detail === 0 && this.enabled && available() && !['brake', 'talk'].includes(name)) command(name); });
    }
    window.addEventListener('blur', () => this.reset());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset(); });
  }
  enable(value) { this.enabled = value; document.body.classList.toggle('touch-mode', value); this.reset(); }
  reset() { this.clearPointers?.(); this.state = {}; this.knob.style.transform = ''; this.activePointers.clear(); this.root.querySelectorAll('.pressed').forEach(el => el.classList.remove('pressed')); this.talk(false); }
  update(player, aiming, voiceEnabled) {
    this.root.classList.toggle('driving', !!player.vehicle);
    const aim = this.root.querySelector('[data-touch="aim"]'); aim.classList.toggle('selected', aiming); aim.setAttribute('aria-pressed', String(aiming));
    this.root.querySelector('[data-touch="talk"]').classList.toggle('voice-ready', !!voiceEnabled);
    this.root.querySelector('[data-touch="interact"]').textContent = player.vehicle ? 'יציאה' : 'פעולה / רכב';
  }
}
