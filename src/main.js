import './style.css';
import { io } from 'socket.io-client';
import { CityRenderer } from './world.js';
import { Simulation, BANK_DURATION } from '../shared/simulation.js';
import { LANDMARKS, distance, district } from '../shared/world.js';
import { VoiceChat } from './voice.js';
import { GameAudio } from './audio.js';
import { drawMap } from './map.js';
import { TouchControls } from './touch.js';
import { gameServerURL, roomInvite } from './network.js';
import { FireLimiter, chatDestination, gameplayAvailable, isTypingTarget, keyboardLook, movementInput } from './controls.js';
import { BANK_TOOL_PRICE, HOSTAGE_DURATION } from '../shared/roleplay.js';

const $ = id => document.getElementById(id);
const icon = (name, size = 18) => {
  const paths = {
    arrow: '<path d="M7 17 17 7M7 7h10v10"/>', sound: '<path d="m11 5-6 4H2v6h3l6 4zM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
    map: '<path d="m2 6 7-3 6 3 7-3v15l-7 3-6-3-7 3zM9 3v15M15 6v15"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
    users: '<circle cx="9" cy="7" r="3"/><path d="M2 21v-3a7 7 0 0 1 14 0v3M17 4a3 3 0 0 1 0 6M19 14a5 5 0 0 1 3 4v3"/>',
    shield: '<path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6zM8 12l3 3 5-6"/>', car: '<path d="m4 8 2-5h12l2 5M3 9h18v10H3zM6 19v2M18 19v2M6 13h2M16 13h2"/>',
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.arrow}</svg>`;
};
document.getElementById('app').innerHTML = `
  <div id="vignette"></div>
  <section id="lobby" class="lobby">
    <header class="lobby-nav" dir="ltr"><a class="brand" href="#" aria-label="RP SMAI"><span class="brand-rp">RP</span><span>SMAI<small>ROLEPLAY / OPEN WORLD</small></span></a><div class="nav-middle"><span class="live-dot"></span> SENTINEL COAST <span class="nav-divider">/</span> EST. 2026</div><button id="about-button" class="text-button">מדריך למשחק ${icon('arrow', 15)}</button></header>
    <div class="hero-copy" dir="ltr"><div class="eyebrow"><span></span> YOUR NEXT LIFE STARTS HERE</div><h1>A CITY.<br>YOUR <em>STORY.</em></h1><p dir="rtl">העיר לא עוצרת.<br>עכשיו תורך להיכנס לסיפור.</p><div class="hero-tags"><span>OPEN WORLD</span><span>MULTIPLAYER</span><span>ROLEPLAY</span></div></div>
    <form id="join-form" class="join-panel">
      <div class="panel-kicker" dir="ltr"><span class="live-dot"></span> WELCOME TO SENTINEL COAST <span>01</span></div>
      <h2>החיים הבאים שלך.</h2><p class="muted">עיר חוף פתוחה. חוקים משלך. סיפור משותף.</p>
      <label class="field-label" for="player-name">איך יקראו לך בעיר?</label><input id="player-name" maxlength="20" placeholder="שם הדמות שלך" autocomplete="nickname" required />
      <div class="field-label role-label">בחר את הצד שלך <span>אפשר להחליף בכניסה הבאה</span></div>
      <div class="role-options"><label><input type="radio" name="role" value="civilian" checked><span>${icon('users')}<b>אזרח</b><small>לנהוג. להרוויח. להסתכן.</small></span></label><label><input type="radio" name="role" value="police"><span>${icon('shield')}<b>שוטר</b><small>לסייר. לרדוף. לעצור.</small></span></label></div>
      <div class="room-row"><div><label class="field-label" for="room-code">קוד חדר עם חברים</label><input id="room-code" maxlength="20" dir="ltr" value="SMAI" pattern="[a-zA-Z0-9-]+" title="אותיות באנגלית, מספרים ומקף" /></div><div><label class="field-label" for="room-password">סיסמת שרת <span>אם נדרשת</span></label><input id="room-password" type="password" maxlength="128" autocomplete="off" placeholder="ללא סיסמה" /></div></div>
      <button class="primary" type="submit" id="online-button"><span>כניסה לעיר עם חברים</span>${icon('arrow')}</button>
      <button class="solo-button" type="button" id="solo-button"><span>לשחק לבד עם בוטים</span><span class="small-key">SOLO</span></button>
      <button class="solo-button hidden" type="button" id="cancel-join">ביטול התחברות</button>
      <p id="load-status" class="load-status"><span class="live-dot"></span> בונה את העיר…</p>
      <p id="join-error" role="alert" class="join-error"></p>
    </form>
    <footer class="lobby-footer" dir="ltr"><span>01 / SENTINEL COAST <b>THE CITY IS YOURS.</b></span><span class="footer-right">ORIGINAL GAME <i>•</i> PLAYABLE ALPHA 0.3</span></footer>
  </section>
  <section id="hud" class="hidden">
    <div class="hud-top"><button type="button" id="menu-brand" class="mini-brand" dir="ltr" title="תפריט המשחק (Esc)" aria-label="RP SMAI — פתיחת תפריט המשחק">RP <b>SMAI</b><span id="connection-pill">SOLO</span></button><div class="location"><small id="clock">17:30</small><b id="district">SENTINEL DOWNTOWN</b><span>W &nbsp; · &nbsp; N &nbsp; · &nbsp; E</span></div><div class="wallet" dir="ltr"><small>AVAILABLE BALANCE</small><b id="money">$2,500</b><span id="wanted">☆☆☆☆☆</span></div></div>
    <div class="hud-tools"><button id="mic-button" title="הפעלת מיקרופון — לחיצה על V כדי לדבר">${icon('mic')}<span id="mic-label">קול כבוי</span></button><button id="sound-button" title="אפקטים קוליים">${icon('sound')}</button><button id="map-button" title="מפה (M)">${icon('map')}</button><button id="pause-button" title="תפריט (Esc)">☰</button><span id="performance-readout" title="קצב תמונות ואיכות התצוגה" style="align-self:center;font:10px Inter,Arial,sans-serif;opacity:.8;padding:0 4px;white-space:nowrap" dir="ltr">— FPS</span></div>
    <aside class="mission-card"><div class="eyebrow">YOUR NEXT MOVE <span id="role-badge">CITIZEN</span></div><h3 id="mission-title">ברוכים הבאים לעיר.</h3><p id="mission-body">הרכב הראשון מחכה לידך. לחץ E כדי להיכנס, או פתח מפה ובחר יעד.</p><p id="equipment-status" class="equipment-status"></p><p id="hostage-status" class="hostage-status hidden" role="status"></p><div id="mission-progress" class="progress hidden"><i></i></div><button id="mission-button">בחר יעד במפה <span>↗</span></button></aside>
    <div id="notifications" aria-live="polite"></div>
    <div id="reticle" class="hidden"><i></i><i></i><i></i><i></i><b></b></div><div id="hitmarker" class="hidden">×</div>
    <div id="chat" class="chat"><div id="chat-log" aria-live="polite"></div><form id="chat-form" class="hidden"><label class="sr-only" for="chat-input">הודעה לשחקנים</label><input id="chat-input" maxlength="180" placeholder="הודעה לשחקנים… Enter לשליחה" autocomplete="off"><button type="submit">↵</button></form><button id="chat-open" class="chat-open"><kbd>T</kbd> צ׳אט עירוני</button></div>
    <div class="minimap-wrap"><canvas id="minimap" width="260" height="260" aria-label="מפת הסביבה הקרובה"></canvas><div class="map-bottom"><span id="map-distance">SENTINEL COAST</span><button id="expand-map">M ${icon('map', 12)}</button></div><div class="health-row"><span>+</span><div><i id="health-bar"></i></div><b id="health-text">100</b></div></div>
    <div id="cuff-banner" class="cuff-banner hidden" role="status"></div><div id="interaction" class="interaction"><kbd>E</kbd><span>כניסה לרכב / אינטראקציה</span></div>
    <div class="bottom-controls"><span><kbd>W A S D</kbd> תנועה</span><span><kbd>SHIFT</kbd> ריצה</span><span><kbd>Q</kbd> כוונת</span><span><kbd>חצים</kbd> כיוון</span><span><kbd>X</kbd> ירי</span><span><kbd>M</kbd> מפה</span></div>
    <div class="vehicle-status" dir="ltr"><div id="speed-wrap" class="hidden"><span id="gear">N</span><b id="speed">000</b><small>KM / H</small><div class="rpm"><i id="rpm-bar"></i></div><p id="vehicle-name">SMAI CONCEPT / SPORT</p></div><div id="ammo-wrap"><span class="weapon-icon">▰</span><b id="ammo">12</b><span>/ <span id="reserve">120</span></span><small>PISTOL · <kbd>X</kbd> FIRE · <kbd>R</kbd> RELOAD</small></div></div>
    <div id="jail-banner" class="jail-banner hidden"><small>COUNTY JAIL</small><h2>העיר תחכה לך.</h2><p>השלל הוחרם. זמן עד לשחרור:</p><b id="jail-time">30</b></div>
    <div id="disconnect-banner" class="disconnect-banner hidden">החיבור לשרת נותק. מנסה להתחבר מחדש…</div>
    <div id="touch-controls" class="touch-controls" aria-label="שליטה במגע">
      <div class="look-hint">גרור על העיר לסיבוב המצלמה</div>
      <div id="touch-stick" class="touch-stick" role="group" aria-label="ג׳ויסטיק תנועה ונהיגה"><span>תנועה</span><i id="stick-knob"></i></div>
      <div class="touch-utility"><button data-touch="camera" aria-label="החלפת מצלמה">מצלמה</button><button data-touch="siren">סירנה</button><button data-touch="cuff" class="hidden">אזיקים</button><button data-touch="garage">מוסך</button><button data-touch="buyBankTools" class="hidden">ערכת שוד</button><button data-touch="hostage" class="hidden">בן ערובה</button><button data-touch="talk" aria-label="החזק כדי לדבר">החזק לדבר</button></div>
      <div class="touch-actions"><button data-touch="reload">טעינה</button><button data-touch="aim" aria-pressed="false">כוונת</button><button data-touch="interact">פעולה / רכב</button><button data-touch="shoot" class="touch-fire">ירי</button><button data-touch="brake" class="touch-brake">בלם</button></div>
    </div>
  </section>
  <div id="modal" class="modal hidden"><section class="modal-card"><button id="close-modal" class="close-modal" aria-label="סגירה">${icon('close')}</button><div id="modal-content"></div></section></div>
  <div id="fatal" class="fatal hidden" role="alert"></div>
`;

let renderer, localSim, state, touch, cancelJoin, id = null, socket = null, voice = null, mode = null, started = false, modal = null;
const preview = new Simulation(); state = preview.snapshot();
const audio = new GameAudio(); const keys = new Set(); let aiming = false, waypoint = null, previous = performance.now(), elapsed = 0, accumulator = 0, inputClock = 0, uiClock = 0, mouseDrag = false;
const view = { yaw: 0, pitch: -.04, firstPerson: false, justStarted: true }; let cameraFollow = true, windowFocused = true, mouseFire = false;
const fireLimiter = new FireLimiter(); let sessionTab = 'settings', voiceRosterSignature = '', voiceBusy = false, qualityMode = 'auto';
let adminAuthenticated = false, adminLoginBusy = false, adminGeneration = 0, guestToken = '', connectionNotice = '';
try { const savedGuest = localStorage.getItem('smai-guest-token') || ''; if (savedGuest.length <= 2048) guestToken = savedGuest; } catch {}
try { const savedQuality = localStorage.getItem('smai-quality'); if (['auto', 'high', 'low'].includes(savedQuality)) qualityMode = savedQuality; } catch {}
const touchDefault = matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).get('controls') === 'touch';
const serverURL = gameServerURL(import.meta.env.VITE_SERVER_URL, location);
try { const name = localStorage.getItem('smai-name'); if (name) $('player-name').value = name; } catch {}
try { renderer = new CityRenderer($('world'), message => { $('load-status').textContent = message; }); }
catch (error) { $('fatal').classList.remove('hidden'); $('fatal').textContent = 'לא ניתן להפעיל גרפיקה תלת־ממדית. נסה דפדפן עם WebGL 2 והאצת חומרה. ' + error.message; }
if (renderer) {
  if (renderer.setQualityMode) renderer.setQualityMode(qualityMode); else renderer.quality(qualityMode === 'high' || (qualityMode === 'auto' && !touchDefault));
  renderer.ready.then(() => { $('load-status').textContent = renderer.assetErrors ? 'העיר מוכנה. חלק מהמודלים נטענו במצב בסיסי.' : 'העיר מוכנה. הסיפור מחכה לך.'; });
  requestAnimationFrame(frame);
}
function talk(down) { voice?.talk(down); $('mic-button').classList.toggle('talking', down && !!voice?.enabled); }
function controlsAvailable() {
  return gameplayAvailable({ started, modal, typing: isTypingTarget(document.activeElement), focused: windowFocused, hidden: document.hidden, connected: mode !== 'online' || !!socket?.connected });
}
function resetControls() {
  keys.clear(); touch?.reset(); aiming = false; mouseDrag = false; mouseFire = false; cameraFollow = true; talk(false);
}
function fire(autoAim = false) {
  if (!controlsAvailable()) return;
  const me = state.players.find(player => player.id === id);
  if (!me || me.vehicle || me.jail || me.reload || me.health <= 0) return;
  if (autoAim) { aiming = true; cameraFollow = false; }
  if (!aiming) { toast('Q מפעיל כוונת. אפשר להחזיק X כדי לכוון ולירות בלי עכבר.'); return; }
  if (!fireLimiter.take(performance.now() / 1000)) return;
  if (mode === 'solo') localSim.setInput(id, input()); else socket?.emit('input', input());
  action('shoot');
}
touch = new TouchControls({
  root: $('touch-controls'), canvas: $('world'), available: controlsAvailable,
  lookEnd: () => { cameraFollow = !aiming; },
  look: (dx, dy) => { cameraFollow = false; view.yaw -= dx * .005; view.pitch = Math.max(-.45, Math.min(.55, view.pitch - dy * .004)); },
  command: name => {
    if (name === 'aim') { aiming = !aiming; cameraFollow = !aiming; }
    else if (name === 'camera') view.firstPerson = !view.firstPerson;
    else if (name === 'shoot') fire(true);
    else if (name === 'cuff') useCuffs();
    else if (name === 'hostage') useHostage();
    else action(name);
  }, talk,
}); touch.enable(touchDefault);
function toast(text, kind = 'info') {
  const el = document.createElement('div'); el.className = `toast ${kind}`; el.textContent = text; $('notifications').append(el);
  while ($('notifications').children.length > 4) $('notifications').firstElementChild.remove();
  setTimeout(() => el.remove(), 6500);
}
function eventReceived(event) {
  if (event.type === 'shot') {
    renderer.shot(event); const me = state.players.find(p => p.id === id);
    if (me && Math.hypot(me.x - event.from.x, me.z - event.from.z) < 100) audio.shot();
    if (event.shooter === id) { view.pitch = Math.min(.65, view.pitch + .012); if (event.hit) { $('hitmarker').classList.remove('hidden'); setTimeout(() => $('hitmarker').classList.add('hidden'), 140); } }
  } else if (!event.to || event.to === id) toast(event.text, event.kind);
}
function addChat(message) {
  const row = document.createElement('p'); const name = document.createElement('b'); name.textContent = `${message.name} `; const text = document.createElement('span'); text.textContent = message.text;
  row.append(name, text); if (message.system) row.classList.add('system'); $('chat-log').append(row);
  while ($('chat-log').children.length > 5) $('chat-log').firstElementChild.remove();
}
function action(name) { if (!controlsAvailable()) return; if (mode === 'solo') { localSim[name]?.(id); } else socket?.emit('action', name); }
async function startGame(nextMode) {
  if (started) return; $('join-error').textContent = '';
  const name = $('player-name').value.trim(); if (!name) { $('player-name').focus(); return; }
  const role = document.querySelector('input[name="role"]:checked').value;
  const room = $('room-code').value.toUpperCase().replace(/[^A-Z0-9-]/g, '') || 'SMAI';
  $('online-button').disabled = $('solo-button').disabled = true;
  try {
    // Start audio within the click gesture; asset loading and browser audio policy are independent.
    audio.start();
    if (!renderer) throw new Error('נדרש דפדפן עם תמיכה ב־WebGL 2 כדי להיכנס לעיר.');
    await renderer.ready;
    if (nextMode === 'solo') {
      localSim = new Simulation(); id = 'local'; const p = localSim.addPlayer(id, name, role);
      try { const save = JSON.parse(localStorage.getItem('smai-solo-v1') || 'null'); if (save && Number.isFinite(save.cash) && save.cash >= 0) p.cash = save.cash; } catch {}
      state = localSim.snapshot();
    } else {
      if (!serverURL) throw new Error('שרת המשחק עדיין לא הוגדר. אפשר לשחק כעת לבד עם בוטים.');
      socket?.disconnect(); connectionNotice = ''; socket = io(serverURL, { autoConnect: false, reconnection: true, timeout: 20000, reconnectionDelayMax: 4000, transports: ['polling', 'websocket'] });
      const joinData = { name, role, room, password: $('room-password').value, guestToken };
      const joined = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('השרת אינו זמין כרגע. אפשר לנסות שוב או לשחק לבד עם בוטים.')), 120000);
        cancelJoin = () => { clearTimeout(timer); reject(new Error('ההתחברות בוטלה.')); };
        $('cancel-join').classList.remove('hidden'); $('load-status').textContent = 'מתחבר לשרת העיר… הכניסה הראשונה עשויה לקחת כדקה.';
        socket.on('connect_error', () => { if (!started) $('load-status').textContent = 'ממתין לשרת העיר להתעורר… אפשר לבטל ולשחק לבד.'; });
        socket.on('connect', () => {
          socket.timeout(8000).emit('join', joinData, (error, data) => {
            if (error || data?.error) {
              const message = data?.error || 'השרת לא השיב בזמן.';
              clearTimeout(timer); reject(new Error(message));
              if (started) { connectionNotice = message; socket.disconnect(); toast(message, 'danger'); }
              return;
            }
            clearTimeout(timer); cancelJoin = null; connectionNotice = ''; id = data.id; state = data.state;
            if (typeof data.guestToken === 'string' && data.guestToken.length <= 2048) { guestToken = data.guestToken; joinData.guestToken = guestToken; try { localStorage.setItem('smai-guest-token', guestToken); } catch {} }
            if (started) { clearAdminSession(); voice?.dispose(); voice = new VoiceChat(socket, toast, data.iceServers); bindVoiceStatus(); updateMic(); $('disconnect-banner').classList.add('hidden'); toast('החיבור חודש. נפתחה דמות חדשה לחיבור הנוכחי.'); }
            resolve(data);
          });
        }); socket.connect();
      });
      voice = new VoiceChat(socket, toast, joined.iceServers); bindVoiceStatus();
      socket.on('state', next => { state = next; }); socket.on('event', eventReceived); socket.on('chat', addChat);
      socket.on('admin:removed', data => { connectionNotice = typeof data?.message === 'string' ? data.message.slice(0, 500) : 'מנהל השרת ניתק אותך מהחדר.'; toast(connectionNotice, 'danger'); });
      socket.on('disconnect', reason => {
        clearAdminSession(); resetControls(); voice?.stop(); updateMic();
        if (started) {
          $('disconnect-banner').textContent = connectionNotice ? `${connectionNotice} · Esc או לוגו SMAI לחזרה לתפריט.` : reason === 'io server disconnect' ? 'השרת סיים את החיבור. פתח Esc או לחץ על לוגו SMAI כדי לצאת לתפריט.' : 'החיבור לשרת נותק. מנסה להתחבר מחדש…';
          $('disconnect-banner').classList.remove('hidden');
        }
      });
    }
    mode = nextMode; adminAuthenticated = false; started = true; windowFocused = true; resetControls(); accumulator = 0; view.justStarted = true; view.yaw = 0; view.pitch = -.04;
    document.activeElement?.blur?.();
    document.body.classList.add('in-game');
    $('lobby').classList.add('hidden'); $('hud').classList.remove('hidden'); $('connection-pill').textContent = mode === 'solo' ? 'SOLO + BOTS' : `LIVE / ${room}`;
    $('role-badge').textContent = role === 'police' ? 'POLICE OFFICER' : 'CITIZEN'; $('chat-log').replaceChildren();
    addChat({ name: 'מערכת', text: mode === 'solo' ? 'העיר חיה גם לבד. יש תנועה, אזרחים וסיורי משטרה.' : `מחובר לחדר ${room}. שתפו חברים בקישור ובקוד החדר.` });
    try { localStorage.setItem('smai-name', name); } catch {}
    toast(touch.enabled ? 'ג׳ויסטיק לתנועה, גרירה על העיר למצלמה. כפתור פעולה נכנס לרכב. חברים מצטרפים דרך הקישור בתפריט.' : role === 'police' ? 'בתפקיד שוטר: מצא ניידת בתחנת המשטרה. E עוצר חשוד קרוב, L מפעיל סירנה.' : 'E לכניסה לרכב. M לבנק, מוסך, משלוחים ונקודת מילוט.');
    if (!touch.enabled) toast('בלי עכבר: X לכוונת ולירי, Q להחלפת כוונת, חצים לכיוון בזמן כוונת. WASD לתנועה ו־Shift לכיוון מדויק.');
  } catch (error) { socket?.disconnect(); socket = null; $('join-error').textContent = error.message || 'הכניסה נכשלה.'; }
  finally { cancelJoin = null; $('cancel-join').classList.add('hidden'); $('online-button').disabled = $('solo-button').disabled = false; if (renderer) $('load-status').textContent = renderer.assetErrors ? 'העיר מוכנה. חלק מהמודלים במצב בסיסי.' : 'העיר מוכנה. הסיפור מחכה לך.'; }
}
$('cancel-join').onclick = () => cancelJoin?.();
$('join-form').addEventListener('submit', event => { event.preventDefault(); startGame('online'); });
$('solo-button').addEventListener('click', () => startGame('solo'));
function input() {
  return movementInput(keys, { aiming, disabled: !controlsAvailable(), touch: touch.state, yaw: view.yaw, pitch: view.pitch });
}
function frame(now) {
  const dt = Math.min((now - previous) / 1000, .05); previous = now; elapsed += dt;
  if (!started) { preview.tick(dt); state = preview.snapshot(); }
  else {
    Object.assign(view, keyboardLook(keys, { aiming, disabled: !controlsAvailable(), yaw: view.yaw, pitch: view.pitch }, dt));
    const fireHeld = mouseFire || (touch.enabled && [...touch.activePointers.values()].includes('shoot'));
    if (keys.has('KeyX') || (aiming && fireHeld)) fire(keys.has('KeyX'));
    inputClock += dt;
    if (mode === 'solo') {
      localSim.setInput(id, input()); accumulator += dt;
      while (accumulator >= 1 / 30) { localSim.tick(1 / 30); accumulator -= 1 / 30; }
      state = localSim.snapshot(); localSim.events.splice(0).forEach(eventReceived);
    } else if (inputClock >= 1 / 30) { socket?.emit('input', input()); inputClock = 0; }
    const p = state.players.find(p => p.id === id);
    if (p?.vehicle && cameraFollow && !mouseDrag) view.yaw += Math.atan2(Math.sin(p.yaw - view.yaw), Math.cos(p.yaw - view.yaw)) * Math.min(1, dt * 4.5);
  }
  const me = renderer.render(state, started ? id : null, view, dt, elapsed);
  uiClock += dt;
  if (started && me && uiClock > .09) { updateHUD(me); audio.update(me, state); voice?.proximity(state, id); uiClock = 0; }
  requestAnimationFrame(frame);
}
function updateHUD(me) {
  if (touch.enabled) touch.update(me, aiming, voice?.enabled);
  const fps = renderer.stats?.fps;
  $('performance-readout').textContent = Number.isFinite(fps) ? `${Math.round(fps)} FPS · ${qualityMode.toUpperCase()}` : '';
  if (modal === 'pause' && sessionTab === 'voice') updateVoicePanel();
  $('role-badge').textContent = me.jail ? 'PRISONER' : me.role === 'police' ? 'POLICE OFFICER' : 'CITIZEN';
  const cuffed = Number.isFinite(me.cuffed) ? me.cuffed : 0;
  $('cuff-banner').classList.toggle('hidden', cuffed <= 0 || !!me.jail);
  if (cuffed > 0) $('cuff-banner').textContent = `אתה באזיקים · ${Math.ceil(cuffed)} שנ׳`;
  document.querySelector('[data-touch="cuff"]').classList.toggle('hidden', me.role !== 'police' || !!me.jail);
  $('equipment-status').textContent = `ערכות שוד: ${me.bankTools ?? 0} · B לרכישה במוסך`;
  $('equipment-status').classList.toggle('hidden', me.role !== 'civilian');
  $('hostage-status').classList.toggle('hidden', !me.hostageId);
  if (me.hostageId) $('hostage-status').textContent = `בן הערובה עוקב אחריך · ${Math.ceil(me.hostageTime || 0)} שנ׳ · Z לשחרור`;
  const hostageButton = document.querySelector('[data-touch="hostage"]');
  hostageButton.classList.toggle('hidden', me.role !== 'civilian' || !!me.jail || !!me.vehicle || (!aiming && !me.hostageId));
  hostageButton.textContent = me.hostageId ? 'שחרור' : 'בן ערובה';
  const kitButton = document.querySelector('[data-touch="buyBankTools"]');
  kitButton.classList.toggle('hidden', me.role !== 'civilian' || !!me.jail || distance(me, LANDMARKS.garage) >= 22);
  kitButton.textContent = `ערכת שוד · $${BANK_TOOL_PRICE}`;
  $('money').textContent = `$${Math.round(me.cash).toLocaleString()}`; $('wanted').textContent = '★'.repeat(me.wanted) + '☆'.repeat(5 - me.wanted);
  $('wanted').classList.toggle('active', me.wanted > 0); $('health-bar').style.width = `${me.health}%`; $('health-text').textContent = Math.ceil(me.health);
  $('district').textContent = district(me.x, me.z); const hours = Math.floor(state.clock), mins = Math.floor((state.clock % 1) * 60); $('clock').textContent = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  $('speed-wrap').classList.toggle('hidden', !me.vehicle); $('ammo-wrap').classList.toggle('hidden', !!me.vehicle);
  if (me.vehicle) { const speed = Math.round(Math.abs(me.speed) * 3.6); $('speed').textContent = String(speed).padStart(3, '0'); $('gear').textContent = me.speed < -1 ? 'R' : speed < 3 ? 'N' : Math.min(6, 1 + Math.floor(speed / 38)); $('rpm-bar').style.width = `${Math.min(100, 12 + speed % 40 * 2)}%`; }
  $('ammo').textContent = me.reload ? '··' : me.ammo; $('reserve').textContent = me.reserve;
  $('reticle').classList.toggle('hidden', !aiming || !!me.vehicle || !!me.jail || !!modal);
  $('jail-banner').classList.toggle('hidden', !me.jail); $('jail-time').textContent = Math.ceil(me.jail);
  const progress = $('mission-progress'); progress.classList.add('hidden');
  if (me.heist > 0) { $('mission-title').textContent = 'פותח את הכספת…'; $('mission-body').textContent = 'הישאר ליד הכספת. המשטרה כבר בדרך. הכן את נתיב המילוט.'; progress.classList.remove('hidden'); progress.firstElementChild.style.width = `${me.heist / BANK_DURATION * 100}%`; }
  else if (me.loot) { $('mission-title').textContent = `שלל ביד: $${me.loot.toLocaleString()}`; $('mission-body').textContent = 'הגע לנקודת המילוט הסגולה, הרחק את המשטרה, צא מהרכב ולחץ E.'; waypoint = LANDMARKS.hideout; }
  else if (me.arrest > 0) { $('mission-title').textContent = 'השוטרים סוגרים עליך'; $('mission-body').textContent = 'התרחק מהניידת כדי להימנע ממעצר.'; progress.classList.remove('hidden'); progress.firstElementChild.style.width = `${me.arrest / 3.5 * 100}%`; }
  else if (me.delivery) { $('mission-title').textContent = 'משלוח לטיילת · $900'; $('mission-body').textContent = 'סע לסימון הכחול בטיילת. צא מהרכב ולחץ E כדי למסור.'; waypoint = LANDMARKS.delivery; }
  else if (waypoint) { $('mission-title').textContent = waypoint.label; $('mission-body').textContent = `היעד במרחק ${Math.round(distance(me, waypoint))} מטר. היעזר במפה כדי למצוא דרך דרך הרחובות.`; }
  else { $('mission-title').textContent = me.role === 'police' ? 'שמור על העיר.' : 'מה הסיפור שלך?'; $('mission-body').textContent = me.role === 'police' ? 'מצא ניידת בתחנה. L לסירנה. התקרב לחשוד מבוקש ולחץ E כדי לעצור.' : 'שוד נועז, נסיעה לאורך הים או משלוח ראשון. פתח מפה ובחר לאן להמשיך.'; }
  let prompt = me.vehicle ? 'יציאה מהרכב' : 'כניסה לרכב / אינטראקציה';
  if (!me.vehicle && distance(me, LANDMARKS.bank) < 8) prompt = state.bankCooldown > 0 ? `הבנק נעול · ${Math.ceil(state.bankCooldown)} שנ׳` : me.bankTools > 0 ? 'תחילת שוד הכספת · ערכה אחת' : 'דרושה ערכת שוד · B במוסך';
  if (!me.vehicle && distance(me, LANDMARKS.hideout) < 10 && me.loot) prompt = 'הפקדת השלל';
  if (!me.vehicle && distance(me, LANDMARKS.delivery) < 12 && me.delivery) prompt = 'מסירת משלוח';
  $('interaction').lastElementChild.textContent = prompt; $('interaction').classList.toggle('hidden', !!me.jail || !!modal);
  $('map-distance').textContent = waypoint ? `${Math.round(distance(me, waypoint))} M · ${waypoint.en}` : district(me.x, me.z);
  drawMap($('minimap'), state, me, waypoint);
  if (modal === 'map') drawMap($('full-map'), state, me, waypoint, true);
}
function openChat() { if (!controlsAvailable()) return; resetControls(); document.body.classList.add('chatting'); $('chat-form').classList.remove('hidden'); $('chat-open').classList.add('hidden'); $('chat-input').focus(); }
function closeChat() { document.body.classList.remove('chatting'); $('chat-form').classList.add('hidden'); $('chat-open').classList.remove('hidden'); $('chat-input').blur(); }
$('chat-open').onclick = openChat;
$('chat-form').onsubmit = event => {
  event.preventDefault(); const text = $('chat-input').value.trim();
  const destination = chatDestination(text, { online: mode === 'online', admin: adminAuthenticated });
  if (destination === 'admin') sendAdminCommand(text, reply => addChat({ name: 'ניהול · פרטי', text: reply.error || reply.message, system: true }));
  else if (destination === 'blocked') toast('פקודות ניהול נשלחות רק אחרי התחברות בלשונית ניהול. סיסמה מזינים שם בלבד.');
  else if (destination === 'chat' && socket?.connected) socket.emit('chat', text);
  else if (destination === 'local') addChat({ name: state.players.find(player => player.id === id)?.name || 'אני', text });
  $('chat-input').value = ''; closeChat();
};
function closeModal() { if ($('admin-token')) $('admin-token').value = ''; if ($('modal').contains(document.activeElement)) document.activeElement?.blur?.(); modal = null; document.body.classList.remove('modal-open'); $('modal').classList.add('hidden'); resetControls(); }
function showModal(kind, content) { closeChat(); modal = kind; document.body.classList.add('modal-open'); resetControls(); $('modal-content').innerHTML = content; $('modal').classList.remove('hidden'); }
function openMap() {
  if (!started) return;
  showModal('map', `<div class="modal-eyebrow">SENTINEL COAST / CITY MAP</div><h2>לאן ממשיכים?</h2><div class="map-layout"><canvas id="full-map" width="650" height="650" aria-label="מפת העיר"></canvas><div class="map-places">${Object.entries(LANDMARKS).map(([key, l], i) => `<button data-place="${key}"><span style="color:${l.color}">0${i + 1}</span><div><b>${l.label}</b><small>${l.en}</small></div>↗</button>`).join('')}<button id="delivery-job" class="job-button">קבלת משלוח · $900</button><p>הקו מסמן את כיוון היעד. בחר מסלול דרך הרחובות.</p></div></div>`);
  document.querySelectorAll('[data-place]').forEach(button => { button.onclick = () => { waypoint = LANDMARKS[button.dataset.place]; closeModal(); toast(`יעד חדש: ${waypoint.label}`); }; });
  $('delivery-job').onclick = () => { closeModal(); action('delivery'); waypoint = LANDMARKS.delivery; };
  drawMap($('full-map'), state, state.players.find(p => p.id === id), waypoint, true);
}
function help() {
  showModal('help', `<div class="modal-eyebrow">RP SMAI / FIELD GUIDE</div><h2>העיר היא מגרש המשחקים שלך.</h2><div class="help-grid"><div><h3>טלפון וטאבלט</h3><p>ג׳ויסטיק שמאלי לתנועה ולהיגוי; דחיפה עד הקצה לריצה. גרור על העיר לסיבוב המצלמה. כפתור פעולה לכניסה לרכב, יציאה ואינטראקציה. הפעל כוונת ולחץ ירי; בזמן נהיגה לחץ בלם. אחרי הפעלת המיקרופון, החזק את כפתור הדיבור. לשוטרים מופיע גם כפתור אזיקים. מומלץ לשחק לרוחב.</p><h3>תנועה ונהיגה</h3><p><kbd>W A S D</kbd> או החצים · תנועה ונהיגה<br><kbd>SHIFT</kbd> ריצה · <kbd>SPACE</kbd> בלם יד<br><kbd>E</kbd> כניסה לרכב, יציאה ופעולות<br>גרירת עכבר שמאלית · מצלמה<br><kbd>F</kbd> מצלמה בגוף ראשון / שלישי</p><h3>כיוון וירי</h3><p>החזק <kbd>X</kbd> לכוונת ולירי גם בלי עכבר.<br><kbd>Q</kbd> מפעיל ומכבה כוונת. בזמן כוונת החצים מסובבים את המצלמה, ו־<kbd>W A S D</kbd> ממשיכים להזיז את הדמות.<br><kbd>SHIFT</kbd> בזמן כוונת מאט את הסיבוב לכיוון מדויק.<br>עם עכבר: כפתור ימני לכוונת, שמאלי לירי.<br><kbd>R</kbd> טעינה · מחסנית 12 כדורים.<br>ירי אזרחי מפעיל תגובת משטרה.</p></div><div><h3>העבודה הראשונה</h3><p><kbd>M</kbd> פותח מפה. בחר משלוח לטיילת כדי להרוויח $900, או היכנס לבנק דרך הפתח הגדול. כל דמות מתחילה עם ערכת שוד אחת. ליד הכספת לחץ E והישאר 14 שניות; התחלת השוד צורכת ערכה. <kbd>B</kbd> ליד המוסך קונה ערכה ב־$${BANK_TOOL_PRICE} (עד 3). התחמק מהשוטרים והפקד את השלל בנקודת המילוט.</p><h3>בני ערובה במשחק</h3><p>בתפקיד אזרח, הפעל כוונת והתקרב לדמות רחוב ממוחשבת. <kbd>Z</kbd> לוקח אותה כבת ערובה; היא עוקבת אחריך למשך עד ${HOSTAGE_DURATION} שניות. Z נוסף משחרר. הפעולה מעלה את רמת המבוקשות. במגע מופיע כפתור בזמן כוונת. אי אפשר לקחת שחקנים אחרים כבני ערובה.</p><h3>חברים וקול</h3><p>היכנסו לאותה כתובת שרת והקלידו אותו קוד חדר. <kbd>T</kbd> פותח צ׳אט. הפעל מיקרופון ואז החזק <kbd>V</kbd> כדי לדבר. כל מי שהפעיל קול באותו חדר יכול לשמוע, בכל מרחק. <kbd>Esc</kbd> או לוגו RP SMAI פותחים הגדרות, השתקה, דיווח וניהול. <kbd>H</kbd> שם אזיקים על חשוד מבוקש קרוב; <kbd>E</kbd> מבצע מעצר. כלא המחוז מסומן במפה וזמן המאסר מוצג בזמן כליאה. שוטר שיורה באזרחים עלול לאבד את תפקידו ולהיכלא.<br><kbd>L</kbd> מפעיל סירנה בניידת; <kbd>G</kbd> מתקן רכב ליד המוסך.</p></div></div><p class="credits-note">גרסת אלפא מקורית. דמות Sam מאת Innerscene / MakeHuman ברישיון CC0. רכב Car Concept © Darmstadt Graphics Group / Eric Chadwick, ברישיון CC BY 4.0. <a href="${import.meta.env.BASE_URL}licenses/credits.html" target="_blank" rel="noopener">קרדיטים ורישיונות ↗</a></p>`);
}
function pause() {
  if (!started) return;
  showModal('pause', `<div class="modal-eyebrow">RP SMAI / SESSION</div><h2>התפריט שלך.</h2><p class="muted">העיר ממשיכה לפעול כשהתפריט פתוח. Esc חוזר למשחק.</p><div class="session-tabs" role="tablist" aria-label="תפריט המשחק"><button type="button" id="menu-tab-settings" data-session-tab="settings" role="tab" aria-controls="session-panel">הגדרות</button><button type="button" id="menu-tab-voice" data-session-tab="voice" role="tab" aria-controls="session-panel">וויס צ׳אט</button><button type="button" id="menu-tab-report" data-session-tab="report" role="tab" aria-controls="session-panel">דיווח</button><button type="button" id="menu-tab-admin" data-session-tab="admin" role="tab" aria-controls="session-panel">ניהול</button></div><div id="session-panel" class="session-panel" role="tabpanel"></div>`);
  document.querySelectorAll('[data-session-tab]').forEach(button => { button.onclick = () => setSessionTab(button.dataset.sessionTab); });
  setSessionTab('settings');
}
function setSessionTab(tab) {
  sessionTab = tab;
  document.querySelectorAll('[data-session-tab]').forEach(button => { const selected = button.dataset.sessionTab === tab; button.classList.toggle('active', selected); button.setAttribute('aria-selected', String(selected)); });
  $('session-panel').setAttribute('aria-labelledby', `menu-tab-${tab}`);
  if (tab === 'voice') { renderVoicePanel(); return; }
  if (tab === 'report') { renderReportPanel(); return; }
  if (tab === 'admin') { renderAdminPanel(); return; }
  $('session-panel').innerHTML = `<div class="menu-setting"><label for="quality">איכות וביצועים</label><select id="quality"><option value="auto">אוטומטי — לפי המכשיר</option><option value="high">גרפיקה גבוהה</option><option value="low">ביצועים — פחות עומס</option></select></div><label class="menu-setting">אפקטים קוליים<input id="menu-sound" type="checkbox"></label><label class="menu-setting">שליטה במגע<input id="touch-enabled" type="checkbox"></label><p class="muted">בלי עכבר: X לירי, Q לכוונת, חצים לכיוון בזמן כוונת. WASD לתנועה. H לאזיקים בתפקיד שוטר. B קונה ערכת שוד במוסך; Z ללקיחת בן ערובה או שחרורו.</p><div class="menu-actions"><button id="resume" class="primary">חזרה למשחק ↗</button><button id="help-in-game">מדריך ושליטה</button><button id="invite">הזמנת חברים</button><button id="players-button">שחקנים בעיר</button><button id="fullscreen">מסך מלא</button><button id="leave" class="danger-button">יציאה לתפריט הראשי</button></div>`;
  $('resume').onclick = closeModal; $('help-in-game').onclick = help;
  $('quality').value = qualityMode;
  $('quality').onchange = event => {
    qualityMode = event.target.value;
    if (renderer.setQualityMode) renderer.setQualityMode(qualityMode); else renderer.quality(qualityMode !== 'low');
    try { localStorage.setItem('smai-quality', qualityMode); } catch {}
  };
  $('menu-sound').checked = audio.enabled;
  $('menu-sound').onchange = event => setSound(event.target.checked);
  $('invite').onclick = shareInvite; $('players-button').onclick = showPlayers;
  $('touch-enabled').checked = touch.enabled; $('touch-enabled').onchange = event => { touch.enable(event.target.checked); updateMic(); };
  $('fullscreen').onclick = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); else toast('בדפדפן זה אפשר להוסיף למסך הבית דרך תפריט השיתוף.'); } catch { toast('מסך מלא אינו זמין בדפדפן הזה.'); } };
  $('leave').onclick = leaveGame;
}
function renderVoicePanel() {
  $('session-panel').innerHTML = `<h3>כל החדר, מכל מקום בעיר.</h3><p class="muted">השחקנים שהפעילו קול באותו חדר שומעים זה את זה בכל מרחק. הפעל מיקרופון והחזק V, או את כפתור הדיבור במגע, כדי לשדר. ההשתקות כאן משפיעות רק על מה שאתה שומע.</p><div class="menu-actions"><button id="menu-mic" class="primary">הפעלת מיקרופון</button><button id="deafen-button" aria-pressed="false">השתקת כולם</button></div><p id="voice-room-status" class="muted"></p><div id="voice-list" class="voice-list" aria-label="שחקנים בחדר"></div>`;
  $('menu-mic').onclick = toggleVoice;
  $('deafen-button').onclick = () => { voice?.setDeafened?.(!voice.deafened); updateVoicePanel(); };
  voiceRosterSignature = ''; updateVoicePanel();
}
function bindVoiceStatus() { if (voice) voice.onStatus = () => { updateMic(); if (modal === 'pause' && sessionTab === 'voice') updateVoicePanel(); }; }
function updateVoicePanel() {
  if (!$('menu-mic') || modal !== 'pause' || sessionTab !== 'voice') return;
  const connected = mode === 'online' && !!socket?.connected;
  $('menu-mic').disabled = !connected || voiceBusy;
  $('menu-mic').textContent = voiceBusy ? 'ממתין להרשאת מיקרופון…' : voice?.enabled ? 'כיבוי המיקרופון והקול' : 'הפעלת מיקרופון וקול';
  $('deafen-button').disabled = !connected || !voice?.enabled;
  $('deafen-button').textContent = voice?.deafened ? 'ביטול השתקת כולם' : 'השתקת כולם';
  $('deafen-button').setAttribute('aria-pressed', String(!!voice?.deafened));
  $('voice-room-status').textContent = mode === 'solo' ? 'וויס צ׳אט זמין במשחק עם חברים. צא לתפריט ובחר כניסה לעיר עם חברים.' : !connected ? 'אין חיבור לשרת כרגע.' : voice?.enabled ? (voice.deafened ? 'כל השחקנים מושתקים אצלך.' : 'הקול פעיל בכל החדר. החזק V כדי לדבר.') : 'המיקרופון כבוי. הפעל אותו כדי להצטרף לקול בחדר.';
  const signature = JSON.stringify(state.players.map(player => [player.id, player.name, !!voice?.muted?.has(player.id), voice?.peers?.get(player.id)?.pc.connectionState, player.id === id && !!voice?.enabled]));
  if (signature === voiceRosterSignature) return;
  voiceRosterSignature = signature; $('voice-list').replaceChildren();
  for (const player of state.players) {
    const row = document.createElement('div'); row.className = 'voice-person';
    const info = document.createElement('div'), name = document.createElement('b'), status = document.createElement('small');
    name.textContent = `${player.name}${player.id === id ? ' (אתה)' : ''}`;
    const muted = !!voice?.muted?.has(player.id), peer = voice?.peers?.get(player.id);
    status.textContent = player.id === id ? voice?.enabled ? 'המיקרופון שלך פעיל · החזק V לדיבור' : 'המיקרופון שלך כבוי' : muted ? 'מושתק אצלך' : peer?.pc.connectionState === 'connected' ? 'קול מחובר' : peer ? 'מחבר קול…' : 'אין חיבור קול פעיל';
    info.append(name, status); row.append(info);
    if (player.id !== id && connected) { const button = document.createElement('button'); button.type = 'button'; button.textContent = muted ? 'ביטול השתקה' : 'השתקה'; button.setAttribute('aria-pressed', String(muted)); button.setAttribute('aria-label', `${muted ? 'ביטול השתקה של' : 'השתקת'} ${player.name}`); button.onclick = () => { voice?.setMuted?.(player.id, !voice.muted?.has(player.id)); updateVoicePanel(); }; row.append(button); }
    $('voice-list').append(row);
  }
}
function renderReportPanel() {
  if (mode !== 'online') { $('session-panel').innerHTML = '<h3>דיווח על שחקן</h3><p class="muted">דיווחים זמינים בחדר מקוון עם שחקנים אחרים. בבוטים מטפלת מערכת המשחק.</p>'; return; }
  $('session-panel').innerHTML = `<h3>דיווח על שחקן</h3><p class="muted">הדיווח נשלח למפעיל השרת ואינו מעניש שחקנים אוטומטית. אפשר גם להשתיק שחקן בלשונית וויס צ׳אט.</p><form id="report-form" class="report-form"><label for="report-player">על מי לדווח?</label><select id="report-player" required></select><label for="report-reason">סיבת הדיווח</label><select id="report-reason" required><option value="harassment">הטרדה או התנהגות פוגענית</option><option value="cheating">חשד לרמאות</option><option value="voice">הפרעה בוויס צ׳אט</option><option value="other">סיבה אחרת</option></select><label for="report-details">מה קרה? <span class="muted">עד 500 תווים, בלי פרטים אישיים</span></label><textarea id="report-details" rows="4" maxlength="500" placeholder="תאר בקצרה את מה שקרה במשחק"></textarea><button id="report-submit" class="primary" type="submit">שליחת דיווח</button><p id="report-status" class="report-status" role="status"></p></form>`;
  const targets = state.players.filter(player => player.id !== id);
  for (const player of targets) { const option = document.createElement('option'); option.value = player.id; option.textContent = player.name; $('report-player').append(option); }
  $('report-submit').disabled = !targets.length || !socket?.connected;
  if (!targets.length) $('report-status').textContent = 'אין כרגע שחקן נוסף בחדר שאפשר לדווח עליו.';
  $('report-form').onsubmit = event => {
    event.preventDefault();
    if (!socket?.connected) { $('report-status').textContent = 'אין חיבור לשרת. נסה שוב לאחר שהחיבור יחזור.'; return; }
    const payload = { targetId: $('report-player').value, reason: $('report-reason').value, details: $('report-details').value.trim().slice(0, 500) };
    const button = $('report-submit'), status = $('report-status'); button.disabled = true; status.textContent = 'שולח דיווח…';
    socket.timeout(8000).emit('report', payload, (error, reply) => {
      button.disabled = false;
      if (error || !reply?.ok) { status.textContent = reply?.error || 'השרת לא אישר את הדיווח. נסה שוב בעוד רגע.'; return; }
      status.textContent = `הדיווח התקבל. מספר דיווח: ${reply.id}`;
      toast('הדיווח התקבל בשרת. תודה שעזרת לשמור על החדר.');
    });
  };
}
function clearAdminSession() {
  adminAuthenticated = false; adminLoginBusy = false; adminGeneration++;
  if ($('admin-token')) $('admin-token').value = '';
  if (modal === 'pause' && sessionTab === 'admin') renderAdminPanel();
}
function renderAdminPanel() {
  if (mode !== 'online') { $('session-panel').innerHTML = '<h3>ניהול שרת</h3><p class="muted">פקודות ניהול זמינות בשרת המקוון למפעיל שהגדיר סיסמת ניהול. מצב סולו אינו משתמש בהרשאות שרת.</p>'; return; }
  if (!adminAuthenticated) {
    $('session-panel').innerHTML = `<h3>כניסה לניהול השרת</h3><p class="muted">למפעיל השרת בלבד. מזינים כאן את סיסמת הניהול שהוגדרה בשרת. הסיסמה אינה נשמרת בדפדפן ואינה נשלחת בצ׳אט. ההרשאה מסתיימת בניתוק מהשרת.</p><form id="admin-login-form" class="report-form" autocomplete="off"><label for="admin-token">סיסמת ניהול</label><input id="admin-token" type="password" maxlength="256" autocomplete="off" autocapitalize="none" spellcheck="false" required><button id="admin-login-submit" class="primary" type="submit">כניסה לניהול</button><p id="admin-status" class="report-status" role="status"></p></form>`;
    $('admin-login-submit').disabled = adminLoginBusy || !socket?.connected;
    if (!socket?.connected) $('admin-status').textContent = 'אין חיבור לשרת כרגע.';
    else if (adminLoginBusy) $('admin-status').textContent = 'ממתין לאישור ההתחברות…';
    $('admin-login-form').onsubmit = event => {
      event.preventDefault();
      if (!socket?.connected || adminLoginBusy) return;
      const token = $('admin-token').value; $('admin-token').value = '';
      if (!token) return;
      const status = $('admin-status'), button = $('admin-login-submit'), expectedSocket = socket, expectedId = socket.id, generation = adminGeneration;
      button.disabled = true; adminLoginBusy = true; status.textContent = 'בודק הרשאת ניהול…';
      expectedSocket.timeout(8000).emit('admin:login', { token }, (error, reply) => {
        if (socket !== expectedSocket || socket.id !== expectedId || adminGeneration !== generation || !socket.connected) return;
        adminLoginBusy = false; button.disabled = false;
        if (error || !reply?.ok) {
          const message = reply?.error || 'השרת לא אישר את ההתחברות. נסה שוב בעוד רגע.';
          if (modal === 'pause' && sessionTab === 'admin') { renderAdminPanel(); $('admin-status').textContent = message; }
          else toast(message);
          return;
        }
        adminAuthenticated = true;
        if (modal === 'pause' && sessionTab === 'admin') renderAdminPanel();
        toast('ניהול פעיל בחיבור הנוכחי. פקודות נשלחות בפרטי לשרת.');
      });
    };
    return;
  }
  $('session-panel').innerHTML = `<h3>ניהול פעיל</h3><p class="muted">הפקודות פועלות בחדר הנוכחי. אפשר לשלוח אותן כאן או בצ׳אט עם /. רק תוצאת הפקודה מוצגת לך. שם שחקן חייב להיות מדויק; שם עם רווחים כותבים במירכאות.</p><form id="admin-command-form" class="report-form"><label for="admin-command">פקודה לשרת</label><input id="admin-command" dir="ltr" maxlength="500" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder='/heal "Player Name"' required><button id="admin-command-submit" class="primary" type="submit">הרצת פקודה</button><p id="admin-status" class="report-status" style="white-space:pre-line" role="status"></p></form><details class="admin-help" open><summary>פקודות זמינות</summary><ul><li><code dir="ltr">/help</code> — עזרה</li><li><code dir="ltr">/heal [name]</code> — ריפוי שחקן או עצמך</li><li><code dir="ltr">/repair [name]</code> — תיקון רכב</li><li><code dir="ltr">/cash name amount</code> — הוספת סכום לכסף (מספר שלילי מפחית)</li><li><code dir="ltr">/jail name seconds</code> — כליאה למספר שניות</li><li><code dir="ltr">/release name</code> — שחרור מכלא</li><li><code dir="ltr">/kick name</code> — ניתוק שחקן מהחדר</li><li><code dir="ltr">/ban name [minutes]</code> — חסימה, ברירת מחדל 60 דקות ועד 1440</li><li><code dir="ltr">/unban BAN-ID</code> — ביטול חסימה לפי המספר שלה</li><li><code dir="ltr">/bans</code> — רשימת החסימות הפעילות</li><li><code dir="ltr">/tp name</code> — מעבר אל שחקן</li><li><code dir="ltr">/bring name</code> — הבאת שחקן אליך</li><li><code dir="ltr">/setrole name civilian|police</code> — החלפת תפקיד</li></ul><p class="muted">החסימה משויכת לזהות האורח בדפדפן, ומסתיימת גם באתחול השרת. זו אינה מערכת חשבונות.</p></details>`;
  $('admin-command-form').onsubmit = event => {
    event.preventDefault();
    const command = $('admin-command').value.trim(), status = $('admin-status'), button = $('admin-command-submit');
    if (!command) return;
    $('admin-command').value = ''; button.disabled = true; status.textContent = 'שולח פקודה…';
    sendAdminCommand(command, reply => { button.disabled = false; status.textContent = reply.error || reply.message; });
  };
}
function sendAdminCommand(command, done = reply => toast(reply.error || reply.message)) {
  if (mode !== 'online' || !socket?.connected || !adminAuthenticated) { done({ error: 'נדרשת התחברות לניהול בחיבור הנוכחי.' }); return; }
  if (typeof command !== 'string' || !command.trim().startsWith('/') || command.length > 500) { done({ error: 'פקודה מתחילה ב־/ ומוגבלת ל־500 תווים.' }); return; }
  const expectedSocket = socket, expectedId = socket.id, generation = adminGeneration;
  expectedSocket.timeout(8000).emit('admin:command', { command }, (error, reply) => {
    if (socket !== expectedSocket || socket.id !== expectedId || generation !== adminGeneration || !socket.connected) { done({ error: 'החיבור השתנה; אין אישור לתוצאת הפקודה.' }); return; }
    if (error || !reply?.ok) { done({ error: reply?.error || 'השרת לא אישר את הפקודה. בדוק את המצב לפני ניסיון נוסף.' }); return; }
    done({ ok: true, message: String(reply.message || 'הפקודה בוצעה.') });
  });
}
async function shareInvite() {
  const url = roomInvite(location, $('room-code').value);
  try {
    if (navigator.share && touch.enabled) await navigator.share({ title: 'RP SMAI', text: 'נפגשים בעיר — בחרו כניסה עם חברים', url });
    else { await navigator.clipboard.writeText(url); toast('קישור החדר הועתק. שלחו לחברים ובחרו כניסה עם חברים.'); }
  } catch (error) {
    if (error.name === 'AbortError') return;
    showModal('invite', '<h2>הזמנה לעיר</h2><p>העתק ושלח לחברים:</p><input id="invite-url" class="invite-url" dir="ltr" readonly>');
    $('invite-url').value = url; $('invite-url').select();
  }
}
function showPlayers() {
  showModal('players', '<div class="modal-eyebrow">CITY RESIDENTS</div><h2>מי בעיר?</h2><div id="players-list"></div>');
  for (const player of state.players) { const row = document.createElement('p'); row.textContent = `${player.role === 'police' ? '★' : '●'} ${player.name} ${player.id === id ? '(אתה)' : ''}`; $('players-list').append(row); }
}
function saveSolo() { const p = state.players.find(p => p.id === id); if (mode === 'solo' && p) { try { localStorage.setItem('smai-solo-v1', JSON.stringify({ cash: p.cash })); } catch {} } }
function leaveGame() {
    saveSolo(); clearAdminSession(); resetControls(); started = false; voice?.dispose(); voice = null; socket?.disconnect(); socket = null; localSim = null; mode = null; id = null; keys.clear(); aiming = false; waypoint = null;
  touch.reset(); document.body.classList.remove('in-game'); closeModal(); closeChat(); updateMic(); $('hud').classList.add('hidden'); $('lobby').classList.remove('hidden'); $('disconnect-banner').classList.add('hidden'); audio.update(null, state);
}
function updateMic() { $('mic-button').classList.toggle('enabled', !!voice?.enabled); $('mic-label').textContent = voice?.enabled ? (touch.enabled ? 'קול פעיל' : 'V כדי לדבר') : 'קול כבוי'; }
async function toggleVoice() {
  if (mode === 'solo') { toast('וויס צ׳אט זמין בחדר עם חברים.'); return; }
  if (!voice || !socket?.connected || voiceBusy) return;
  if (voice.enabled) { voice.stop(); updateMic(); updateVoicePanel(); return; }
  const currentVoice = voice; voiceBusy = true; updateVoicePanel();
  try {
    await currentVoice.enable();
    if (voice !== currentVoice || !started) { currentVoice.stop(); return; }
    updateMic(); toast(touch.enabled ? 'המיקרופון מוכן. החזק את כפתור הדיבור כדי לשדר לכל החדר.' : 'המיקרופון מוכן. החזק V כדי לדבר לכל החדר, מכל מרחק.');
  } catch (error) { toast(error.name === 'NotAllowedError' ? 'לא ניתנה הרשאת מיקרופון. אפשר לשנות זאת בהגדרות הדפדפן.' : error.message, 'danger'); }
  finally { voiceBusy = false; updateVoicePanel(); }
}
$('mic-button').onclick = toggleVoice;
function setSound(enabled) { audio.enabled = enabled; if (enabled) audio.start(); $('sound-button').classList.toggle('muted-button', !enabled); }
$('sound-button').onclick = () => setSound(!audio.enabled);
$('map-button').onclick = $('expand-map').onclick = $('mission-button').onclick = openMap;
$('pause-button').onclick = $('menu-brand').onclick = pause; $('about-button').onclick = help; $('close-modal').onclick = closeModal;
$('modal').addEventListener('click', event => { if (event.target === $('modal')) closeModal(); });
function useCuffs() {
  if (!controlsAvailable()) return;
  if (state.players.find(player => player.id === id)?.role !== 'police') { toast('אזיקים זמינים בתפקיד שוטר.'); return; }
  action('cuff');
}
function useHostage() {
  if (!controlsAvailable()) return;
  const me = state.players.find(player => player.id === id);
  if (!me) return;
  if (mode === 'solo') localSim.setInput(id, input()); else socket?.emit('input', input());
  action('hostage');
}
document.addEventListener('keydown', event => {
  if (isTypingTarget(event.target)) {
    if (event.code === 'Escape') { event.preventDefault(); modal ? closeModal() : closeChat(); event.target.blur?.(); }
    return;
  }
  if (!started) { if (event.code === 'Escape') closeModal(); return; }
  if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyX'].includes(event.code) && !modal) event.preventDefault();
  if (event.code === 'Escape') { event.preventDefault(); if (!event.repeat) modal ? closeModal() : pause(); return; }
  if (!controlsAvailable()) return;
  keys.add(event.code);
  if (event.repeat) return;
  audio.start();
  if (event.code === 'KeyE') action('interact'); if (event.code === 'KeyR') action('reload'); if (event.code === 'KeyG') action('garage'); if (event.code === 'KeyL') action('siren');
  if (event.code === 'KeyM') openMap(); if (event.code === 'KeyT') { event.preventDefault(); openChat(); } if (event.code === 'KeyF') view.firstPerson = !view.firstPerson;
  if (event.code === 'KeyQ') { aiming = !aiming; cameraFollow = !aiming; }
  if (event.code === 'KeyX') fire(true);
  if (event.code === 'KeyH') useCuffs();
  if (event.code === 'KeyB') action('buyBankTools');
  if (event.code === 'KeyZ') useHostage();
  if (event.code === 'KeyV') talk(true);
  if (event.code === 'Tab') showPlayers();
});
document.addEventListener('keyup', event => { keys.delete(event.code); if (event.code === 'KeyV') talk(false); if (event.code === 'Tab' && modal === 'players') closeModal(); });
window.addEventListener('blur', () => { windowFocused = false; resetControls(); });
window.addEventListener('focus', () => { windowFocused = true; resetControls(); });
document.addEventListener('focusin', event => { if (isTypingTarget(event.target)) resetControls(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) resetControls(); });
document.addEventListener('contextmenu', event => { if (controlsAvailable()) event.preventDefault(); });
$('world').addEventListener('pointerdown', event => {
  if (event.pointerType !== 'mouse' || !controlsAvailable()) return;
  audio.start();
  if (event.button === 2) { aiming = true; cameraFollow = false; }
  if (event.button === 0) { if (aiming) { mouseFire = true; fire(); } else { mouseDrag = true; cameraFollow = false; } }
});
window.addEventListener('pointerup', event => { if (event.pointerType !== 'mouse') return; if (event.button === 2) { aiming = false; cameraFollow = true; } if (event.button === 0) { mouseFire = false; mouseDrag = false; cameraFollow = !aiming; } });
window.addEventListener('pointercancel', event => { if (event.pointerType === 'mouse') resetControls(); });
window.addEventListener('pointermove', event => { if (event.pointerType !== 'mouse' || !controlsAvailable() || (!mouseDrag && !aiming)) return; view.yaw -= event.movementX * .004; view.pitch = Math.max(-.45, Math.min(.55, view.pitch - event.movementY * .003)); });
window.addEventListener('beforeunload', () => { saveSolo(); voice?.stop(); });
setInterval(saveSolo, 10000);
const invitedRoom = new URLSearchParams(location.search).get('room'); if (invitedRoom) $('room-code').value = invitedRoom.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20);
