// Audio only. Capture starts exclusively after the player presses the microphone button.
export class VoiceChat {
  constructor(socket, notify, iceServers) {
    this.socket = socket; this.notify = notify; this.iceServers = iceServers; this.peers = new Map(); this.stream = null; this.enabled = false;
    this.deafened = false; this.muted = new Set(); this.members = null; this.onStatus = null; this.generation = 0;
    this.resumePlayback = () => { for (const peer of this.peers.values()) if (peer.audio.srcObject && peer.audio.paused) peer.audio.play().catch(() => {}); };
    globalThis.document?.addEventListener('pointerdown', this.resumePlayback);
    this.handlers = {
      'voice:peers': ids => { for (const id of ids) this.ensure(id); },
      'voice:joined': id => { if (this.enabled) this.ensure(id); },
      'voice:left': id => this.remove(id),
      'voice:signal': data => this.signal(data).catch(() => this.notify('לא ניתן לחבר קול לאחד השחקנים. ייתכן שנדרש שרת TURN.')),
    };
    for (const [name, handler] of Object.entries(this.handlers)) socket.on(name, handler);
  }
  async enable() {
    if (this.enabled) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('וויס צ׳אט דורש HTTPS או localhost.');
    if (this.enabling) return this.enabling;
    const generation = this.generation;
    this.enabling = navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }).then(stream => {
      if (generation !== this.generation) { stream.getTracks().forEach(t => t.stop()); return; }
      this.stream = stream; this.enabled = true; this.talk(false); this.socket.emit('voice:ready', true); this.onStatus?.();
    }).finally(() => { this.enabling = null; });
    return this.enabling;
  }
  talk(down) { this.stream?.getAudioTracks().forEach(t => { t.enabled = !!down; }); }
  ensure(id) {
    if (!this.enabled || id === this.socket.id) return null;
    if (this.peers.has(id)) return this.peers.get(id);
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer = { pc, polite: this.socket.id.localeCompare(id) > 0, makingOffer: false, ignoreOffer: false, answering: false, pending: [], audio: new Audio() };
    peer.audio.autoplay = true; peer.audio.setAttribute('playsinline', ''); this.peers.set(id, peer); this.updateVolumes(); this.onStatus?.();
    for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);
    pc.onicecandidate = e => { if (e.candidate) this.socket.emit('voice:signal', { to: id, candidate: e.candidate.toJSON() }); };
    pc.ontrack = e => { peer.audio.srcObject = e.streams[0] || new MediaStream([e.track]); peer.audio.play().catch(() => this.notify('לחץ שוב במשחק כדי לאפשר השמעת קול.')); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') this.notify('חיבור הקול לשחקן נכשל ברשת הנוכחית.'); this.onStatus?.(); };
    pc.onnegotiationneeded = async () => {
      try { peer.makingOffer = true; await pc.setLocalDescription(); this.socket.emit('voice:signal', { to: id, description: pc.localDescription }); }
      catch { this.notify('לא ניתן להתחיל שיחת קול כרגע.'); }
      finally { peer.makingOffer = false; }
    };
    return peer;
  }
  async signal({ from, description, candidate }) {
    const peer = this.ensure(from); if (!peer) return; const { pc } = peer;
    if (description) {
      const ready = !peer.makingOffer && (pc.signalingState === 'stable' || peer.answering);
      peer.ignoreOffer = !peer.polite && description.type === 'offer' && !ready;
      if (peer.ignoreOffer) return;
      peer.answering = description.type === 'answer'; await pc.setRemoteDescription(description); peer.answering = false;
      for (const c of peer.pending.splice(0)) await pc.addIceCandidate(c);
      if (description.type === 'offer') { await pc.setLocalDescription(); this.socket.emit('voice:signal', { to: from, description: pc.localDescription }); }
    } else if (candidate && !peer.ignoreOffer) { if (pc.remoteDescription) await pc.addIceCandidate(candidate); else peer.pending.push(candidate); }
  }
  proximity(state, id) {
    // The server limits signaling to the current room; distance never changes volume.
    this.members = new Set(state.players.some(p => p.id === id) ? state.players.map(p => p.id) : []);
    for (const peerId of this.muted) if (!this.members.has(peerId)) this.muted.delete(peerId);
    this.updateVolumes();
  }
  setMuted(id, muted) { if (muted) this.muted.add(id); else this.muted.delete(id); this.updateVolumes(); this.onStatus?.(); }
  setDeafened(value) { this.deafened = !!value; this.updateVolumes(); this.onStatus?.(); }
  updateVolumes() {
    for (const [peerId, peer] of this.peers) {
      peer.audio.volume = !this.deafened && !this.muted.has(peerId) && (!this.members || this.members.has(peerId)) ? 1 : 0;
    }
  }
  remove(id) { const peer = this.peers.get(id); if (!peer) return; peer.pc.close(); peer.audio.pause(); peer.audio.srcObject = null; this.peers.delete(id); this.onStatus?.(); }
  stop() { this.generation++; this.talk(false); this.stream?.getTracks().forEach(t => t.stop()); this.stream = null; this.enabled = false; for (const id of this.peers.keys()) this.remove(id); this.socket.emit('voice:ready', false); this.onStatus?.(); }
  dispose() { this.stop(); for (const [name, handler] of Object.entries(this.handlers)) this.socket.off(name, handler); globalThis.document?.removeEventListener('pointerdown', this.resumePlayback); }
}
