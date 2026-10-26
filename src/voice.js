// Audio only. Capture starts exclusively after the player presses the microphone button.
export class VoiceChat {
  constructor(socket, notify, iceServers) {
    this.socket = socket; this.notify = notify; this.iceServers = iceServers; this.peers = new Map(); this.stream = null; this.enabled = false;
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
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    this.enabled = true; this.talk(false); this.socket.emit('voice:ready', true);
  }
  talk(down) { this.stream?.getAudioTracks().forEach(t => { t.enabled = !!down; }); }
  ensure(id) {
    if (!this.enabled || id === this.socket.id) return null;
    if (this.peers.has(id)) return this.peers.get(id);
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer = { pc, polite: this.socket.id.localeCompare(id) > 0, makingOffer: false, ignoreOffer: false, answering: false, pending: [], audio: new Audio() };
    peer.audio.autoplay = true; peer.audio.setAttribute('playsinline', ''); this.peers.set(id, peer);
    for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);
    pc.onicecandidate = e => { if (e.candidate) this.socket.emit('voice:signal', { to: id, candidate: e.candidate.toJSON() }); };
    pc.ontrack = e => { peer.audio.srcObject = e.streams[0] || new MediaStream([e.track]); peer.audio.play().catch(() => this.notify('לחץ שוב במשחק כדי לאפשר השמעת קול.')); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') this.notify('חיבור הקול נכשל. בדוק הגדרות TURN בשרת.'); };
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
    const me = state.players.find(p => p.id === id); if (!me) return;
    for (const [peerId, peer] of this.peers) {
      const p = state.players.find(p => p.id === peerId);
      peer.audio.volume = p ? Math.max(0, 1 - Math.hypot(p.x - me.x, p.z - me.z) / 85) : 0;
    }
  }
  remove(id) { const peer = this.peers.get(id); if (!peer) return; peer.pc.close(); peer.audio.pause(); peer.audio.srcObject = null; this.peers.delete(id); }
  stop() { this.talk(false); this.stream?.getTracks().forEach(t => t.stop()); this.stream = null; this.enabled = false; for (const id of this.peers.keys()) this.remove(id); this.socket.emit('voice:ready', false); }
  dispose() { this.stop(); for (const [name, handler] of Object.entries(this.handlers)) this.socket.off(name, handler); }
}
