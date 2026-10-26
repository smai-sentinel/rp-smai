import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceChat } from '../src/voice.js';
const makeVoice = () => new VoiceChat({ on() {}, off() {}, emit() {} }, () => {}, []);
const peer = () => ({ audio: { volume: 0, pause() {} }, pc: { close() {} } });
test('voice is equally audible across the room, and absent players are silent', () => {
  const voice = makeVoice(); voice.peers.set('far', peer()); voice.peers.set('gone', peer());
  voice.proximity({ players: [{ id: 'me', x: -400, z: -400 }, { id: 'far', x: 400, z: 400 }] }, 'me');
  assert.equal(voice.peers.get('far').audio.volume, 1); assert.equal(voice.peers.get('gone').audio.volume, 0);
  voice.dispose();
});
test('individual mutes and deafen apply immediately and preserve each other', () => {
  const voice = makeVoice(); voice.peers.set('a', peer()); voice.peers.set('b', peer());
  voice.proximity({ players: [{ id: 'me' }, { id: 'a' }, { id: 'b' }] }, 'me');
  voice.setMuted('a', true); assert.equal(voice.peers.get('a').audio.volume, 0); assert.equal(voice.peers.get('b').audio.volume, 1);
  voice.setDeafened(true); assert.equal(voice.peers.get('b').audio.volume, 0);
  voice.setDeafened(false); assert.equal(voice.peers.get('a').audio.volume, 0); assert.equal(voice.peers.get('b').audio.volume, 1);
  voice.setMuted('a', false); assert.equal(voice.peers.get('a').audio.volume, 1);
  voice.proximity({ players: [] }, 'me'); assert.equal(voice.peers.get('a').audio.volume, 0);
  voice.dispose();
});
test('local mute survives a remote microphone reconnect and clears on room departure', () => {
  const voice = makeVoice(); voice.peers.set('a', peer()); voice.setMuted('a', true);
  voice.remove('a'); voice.peers.set('a', peer());
  voice.proximity({ players: [{ id: 'me' }, { id: 'a' }] }, 'me');
  assert.equal(voice.peers.get('a').audio.volume, 0);
  voice.proximity({ players: [{ id: 'me' }] }, 'me');
  assert.equal(voice.muted.has('a'), false); voice.dispose();
});
