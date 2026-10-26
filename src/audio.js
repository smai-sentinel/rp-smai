export class GameAudio {
  constructor() { this.enabled = true; }
  start() {
    if (!this.ctx) {
      const AudioContextType = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextType) return false;
      try {
        this.ctx = new AudioContextType(); this.master = this.ctx.createGain(); this.master.gain.value = .16; this.master.connect(this.ctx.destination);
        this.engine = this.ctx.createOscillator(); this.engine.type = 'sawtooth'; this.filter = this.ctx.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 280;
        this.gain = this.ctx.createGain(); this.gain.gain.value = 0; this.engine.connect(this.filter).connect(this.gain).connect(this.master); this.engine.start();
        this.siren = this.ctx.createOscillator(); this.sirenGain = this.ctx.createGain(); this.sirenGain.gain.value = 0; this.siren.connect(this.sirenGain).connect(this.master); this.siren.start();
      } catch {
        try { Promise.resolve(this.ctx?.close()).catch(() => {}); } catch {}
        this.ctx = null; return false;
      }
    }
    // Some browsers leave resume() pending until another user gesture. Sound
    // must never hold up joining a room or starting the solo simulation.
    if (this.ctx.state !== 'running') {
      try { Promise.resolve(this.ctx.resume()).catch(() => {}); } catch {}
    }
    return true;
  }
  update(player, state) {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(this.enabled ? .16 : 0, this.ctx.currentTime, .1);
    this.gain.gain.setTargetAtTime(player?.vehicle ? .18 + Math.abs(player.speed) / 170 : 0, this.ctx.currentTime, .1);
    this.engine.frequency.setTargetAtTime(38 + Math.abs(player?.speed || 0) * 2.3, this.ctx.currentTime, .1);
    const nearest = player ? Math.min(...state.vehicles.filter(c => c.siren).map(c => Math.hypot(c.x - player.x, c.z - player.z)), 1000) : 1000;
    this.sirenGain.gain.setTargetAtTime(Math.max(0, 1 - nearest / 80) * .22, this.ctx.currentTime, .1);
    this.siren.frequency.setTargetAtTime(720 + Math.sin(state.time * 5) * 250, this.ctx.currentTime, .03);
  }
  shot() {
    if (!this.ctx || !this.enabled) return;
    const length = this.ctx.sampleRate * .12, buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (length * .13));
    const source = this.ctx.createBufferSource(); source.buffer = buffer; const gain = this.ctx.createGain(); gain.gain.value = .9; source.connect(gain).connect(this.master); source.start(); source.onended = () => { source.disconnect(); gain.disconnect(); };
  }
}
