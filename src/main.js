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
    <footer class="lobby-footer" dir="ltr"><span>01 / SENTINEL COAST <b>THE CITY IS YOURS.</b></span><span class="footer-right">ORIGINAL GAME <i>•</i> PLAYABLE ALPHA 0.2</span></footer>
  </section>
  <section id="hud" class="hidden">
    <div class="hud-top"><div class="mini-brand" dir="ltr">RP <b>SMAI</b><span id="connection-pill">SOLO</span></div><div class="location"><small id="clock">17:30</small><b id="district">SENTINEL DOWNTOWN</b><span>W &nbsp; · &nbsp; N &nbsp; · &nbsp; E</span></div><div class="wallet" dir="ltr"><small>AVAILABLE BALANCE</small><b id="money">$2,500</b><span id="wanted">☆☆☆☆☆</span></div></div>
    <div class="hud-tools"><button id="mic-button" title="הפעלת מיקרופון — לחיצה על V כדי לדבר">${icon('mic')}<span id="mic-label">קול כבוי</span></button><button id="sound-button" title="אפקטים קוליים">${icon('sound')}</button><button id="map-button" title="מפה (M)">${icon('map')}</button><button id="pause-button" title="תפריט (Esc)">☰</button></div>
    <aside class="mission-card"><div class="eyebrow">YOUR NEXT MOVE <span id="role-badge">CITIZEN</span></div><h3 id="mission-title">ברוכים הבאים לעיר.</h3><p id="mission-body">הרכב הראשון מחכה לידך. לחץ E כדי להיכנס, או פתח מפה ובחר יעד.</p><div id="mission-progress" class="progress hidden"><i></i></div><button id="mission-button">בחר יעד במפה <span>↗</span></button></aside>
    <div id="notifications" aria-live="polite"></div>
    <div id="reticle" class="hidden"><i></i><i></i><i></i><i></i><b></b></div><div id="hitmarker" class="hidden">×</div>
    <div id="chat" class="chat"><div id="chat-log" aria-live="polite"></div><form id="chat-form" class="hidden"><label class="sr-only" for="chat-input">הודעה לשחקנים</label><input id="chat-input" maxlength="180" placeholder="הודעה לשחקנים… Enter לשליחה" autocomplete="off"><button type="submit">↵</button></form><button id="chat-open" class="chat-open"><kbd>T</kbd> צ׳אט עירוני</button></div>
    <div class="minimap-wrap"><canvas id="minimap" width="260" height="260" aria-label="מפת הסביבה הקרובה"></canvas><div class="map-bottom"><span id="map-distance">SENTINEL COAST</span><button id="expand-map">M ${icon('map', 12)}</button></div><div class="health-row"><span>+</span><div><i id="health-bar"></i></div><b id="health-text">100</b></div></div>
    <div id="interaction" class="interaction"><kbd>E</kbd><span>כניסה לרכב / אינטראקציה</span></div>
    <div class="bottom-controls"><span><kbd>W A S D</kbd> תנועה</span><span><kbd>SHIFT</kbd> ריצה</span><span><kbd>RMB</kbd> כיוון</span><span><kbd>M</kbd> מפה</span></div>
    <div class="vehicle-status" dir="ltr"><div id="speed-wrap" class="hidden"><span id="gear">N</span><b id="speed">000</b><small>KM / H</small><div class="rpm"><i id="rpm-bar"></i></div><p id="vehicle-name">SMAI CONCEPT / SPORT</p></div><div id="ammo-wrap"><span class="weapon-icon">▰</span><b id="ammo">12</b><span>/ <span id="reserve">120</span></span><small>SERVICE PISTOL · <kbd>R</kbd> RELOAD</small></div></div>
    <div id="jail-banner" class="jail-banner hidden"><small>COUNTY JAIL</small><h2>העיר תחכה לך.</h2><p>השלל הוחרם. זמן עד לשחרור:</p><b id="jail-time">30</b></div>
    <div id="disconnect-banner" class="disconnect-banner hidden">החיבור לשרת נותק. מנסה להתחבר מחדש…</div>
    <div id="touch-controls" class="touch-controls" aria-label="שליטה במגע">
      <div class="look-hint">גרור על העיר לסיבוב המצלמה</div>
      <div id="touch-stick" class="touch-stick" role="group" aria-label="ג׳ויסטיק תנועה ונהיגה"><span>תנועה</span><i id="stick-knob"></i></div>
      <div class="touch-utility"><button data-touch="camera" aria-label="החלפת מצלמה">מצלמה</button><button data-touch="siren">סירנה</button><button data-touch="garage">מוסך</button><button data-touch="talk" aria-label="החזק כדי לדבר">החזק לדבר</button></div>
      <div class="touch-actions"><button data-touch="reload">טעינה</button><button data-touch="aim" aria-pressed="false">כוונת</button><button data-touch="interact">פעולה / רכב</button><button data-touch="shoot" class="touch-fire">ירי</button><button data-touch="brake" class="touch-brake">בלם</button></div>
    </div>
  </section>
  <div id="modal" class="modal hidden"><section class="modal-card"><button id="close-modal" class="close-modal" aria-label="סגירה">${icon('close')}</button><div id="modal-content"></div></section></div>
  <div id="fatal" class="fatal hidden" role="alert"></div>
`;

let renderer, localSim, state, touch, cancelJoin, id = null, socket = null, voice = null, mode = null, started = false, modal = null;
const preview = new Simulation(); state = preview.snapshot();
const audio = new GameAudio(); const keys = new Set(); let aiming = false, waypoint = null, previous = performance.now(), elapsed = 0, accumulator = 0, inputClock = 0, uiClock = 0, mouseDrag = false;
const view = { yaw: 0, pitch: -.04, firstPerson: false, justStarted: true }; let cameraFollow = true;
const touchDefault = matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).get('controls') === 'touch';
const serverURL = gameServerURL(import.meta.env.VITE_SERVER_URL, location);
try { const name = localStorage.getItem('smai-name'); if (name) $('player-name').value = name; } catch {}
try { renderer = new CityRenderer($('world'), message => { $('load-status').textContent = message; }); }
catch (error) { $('fatal').classList.remove('hidden'); $('fatal').textContent = 'לא ניתן להפעיל גרפיקה תלת־ממדית. נסה דפדפן עם WebGL 2 והאצת חומרה. ' + error.message; }
if (renderer) {
  if (touchDefault) renderer.quality(false);
  renderer.ready.then(() => { $('load-status').textContent = renderer.assetErrors ? 'העיר מוכנה. חלק מהמודלים נטענו במצב בסיסי.' : 'העיר מוכנה. הסיפור מחכה לך.'; });
  requestAnimationFrame(frame);
}
function talk(down) { voice?.talk(down); $('mic-button').classList.toggle('talking', down && !!voice?.enabled); }
function fire() {
  if (!aiming) { toast('הפעל כוונת לפני הירי.'); return; }
  if (mode === 'solo') localSim.setInput(id, input()); else socket?.emit('input', input());
  action('shoot');
}
touch = new TouchControls({
  root: $('touch-controls'), canvas: $('world'), available: () => started && !modal && document.activeElement !== $('chat-input') && (mode === 'solo' || !!socket?.connected),
  lookEnd: () => { cameraFollow = !aiming; },
  look: (dx, dy) => { cameraFollow = false; view.yaw -= dx * .005; view.pitch = Math.max(-.45, Math.min(.55, view.pitch - dy * .004)); },
  command: name => {
    if (name === 'aim') { aiming = !aiming; cameraFollow = !aiming; }
    else if (name === 'camera') view.firstPerson = !view.firstPerson;
    else if (name === 'shoot') fire();
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
function action(name) { if (!started || modal) return; if (mode === 'solo') { localSim[name]?.(id); } else socket?.emit('action', name); }
async function startGame(nextMode) {
  if (started) return; $('join-error').textContent = '';
  const name = $('player-name').value.trim(); if (!name) { $('player-name').focus(); return; }
  const role = document.querySelector('input[name="role"]:checked').value;
  const room = $('room-code').value.toUpperCase().replace(/[^A-Z0-9-]/g, '') || 'SMAI';
  $('online-button').disabled = $('solo-button').disabled = true;
  try {
    await renderer.ready; await audio.start();
    if (nextMode === 'solo') {
      localSim = new Simulation(); id = 'local'; const p = localSim.addPlayer(id, name, role);
      try { const save = JSON.parse(localStorage.getItem('smai-solo-v1') || 'null'); if (save && Number.isFinite(save.cash) && save.cash >= 0) p.cash = save.cash; } catch {}
      state = localSim.snapshot();
    } else {
      if (!serverURL) throw new Error('שרת המשחק עדיין לא הוגדר. אפשר לשחק כעת לבד עם בוטים.');
      socket?.disconnect(); socket = io(serverURL, { autoConnect: false, reconnection: true, timeout: 20000, reconnectionDelayMax: 4000, transports: ['polling', 'websocket'] });
      const joinData = { name, role, room, password: $('room-password').value };
      const joined = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('השרת אינו זמין כרגע. אפשר לנסות שוב או לשחק לבד עם בוטים.')), 120000);
        cancelJoin = () => { clearTimeout(timer); reject(new Error('ההתחברות בוטלה.')); };
        $('cancel-join').classList.remove('hidden'); $('load-status').textContent = 'מתחבר לשרת העיר… הכניסה הראשונה עשויה לקחת כדקה.';
        socket.on('connect_error', () => { if (!started) $('load-status').textContent = 'ממתין לשרת העיר להתעורר… אפשר לבטל ולשחק לבד.'; });
        socket.on('connect', () => {
          socket.timeout(8000).emit('join', joinData, (error, data) => {
            if (error || data?.error) { clearTimeout(timer); reject(new Error(data?.error || 'השרת לא השיב בזמן.')); if (started) toast(data?.error || 'החיבור מחדש נכשל.', 'danger'); return; }
            clearTimeout(timer); cancelJoin = null; id = data.id; state = data.state;
            if (started) { voice?.dispose(); voice = new VoiceChat(socket, toast, data.iceServers); updateMic(); $('disconnect-banner').classList.add('hidden'); toast('החיבור חודש. נפתחה דמות חדשה לחיבור הנוכחי.'); }
            resolve(data);
          });
        }); socket.connect();
      });
      voice = new VoiceChat(socket, toast, joined.iceServers);
      socket.on('state', next => { state = next; }); socket.on('event', eventReceived); socket.on('chat', addChat);
      socket.on('disconnect', () => { keys.clear(); touch.reset(); aiming = false; voice?.stop(); updateMic(); if (started) $('disconnect-banner').classList.remove('hidden'); });
    }
    mode = nextMode; started = true; accumulator = 0; view.justStarted = true; view.yaw = 0; view.pitch = -.04;
    document.body.classList.add('in-game');
    $('lobby').classList.add('hidden'); $('hud').classList.remove('hidden'); $('connection-pill').textContent = mode === 'solo' ? 'SOLO + BOTS' : `LIVE / ${room}`;
    $('role-badge').textContent = role === 'police' ? 'POLICE OFFICER' : 'CITIZEN'; $('chat-log').replaceChildren();
    addChat({ name: 'מערכת', text: mode === 'solo' ? 'העיר חיה גם לבד. יש תנועה, אזרחים וסיורי משטרה.' : `מחובר לחדר ${room}. שתפו חברים בקישור ובקוד החדר.` });
    try { localStorage.setItem('smai-name', name); } catch {}
    toast(touch.enabled ? 'ג׳ויסטיק לתנועה, גרירה על העיר למצלמה. כפתור פעולה נכנס לרכב. חברים מצטרפים דרך הקישור בתפריט.' : role === 'police' ? 'בתפקיד שוטר: מצא ניידת בתחנת המשטרה. E עוצר חשוד קרוב, L מפעיל סירנה.' : 'E לכניסה לרכב. M לבנק, מוסך, משלוחים ונקודת מילוט.');
  } catch (error) { socket?.disconnect(); socket = null; $('join-error').textContent = error.message || 'הכניסה נכשלה.'; }
  finally { cancelJoin = null; $('cancel-join').classList.add('hidden'); $('online-button').disabled = $('solo-button').disabled = false; if (renderer) $('load-status').textContent = renderer.assetErrors ? 'העיר מוכנה. חלק מהמודלים במצב בסיסי.' : 'העיר מוכנה. הסיפור מחכה לך.'; }
}
$('cancel-join').onclick = () => cancelJoin?.();
$('join-form').addEventListener('submit', event => { event.preventDefault(); startGame('online'); });
$('solo-button').addEventListener('click', () => startGame('solo'));
function input() {
  const disabled = !!modal || document.activeElement === $('chat-input') || !started || (mode === 'online' && !socket?.connected);
  return { up: !disabled && (keys.has('KeyW') || keys.has('ArrowUp') || !!touch.state.up), down: !disabled && (keys.has('KeyS') || keys.has('ArrowDown') || !!touch.state.down),
    left: !disabled && (keys.has('KeyA') || keys.has('ArrowLeft') || !!touch.state.left), right: !disabled && (keys.has('KeyD') || keys.has('ArrowRight') || !!touch.state.right),
    sprint: !disabled && (keys.has('ShiftLeft') || keys.has('ShiftRight') || !!touch.state.sprint), brake: !disabled && (keys.has('Space') || !!touch.state.brake),
    aim: !disabled && aiming, yaw: view.yaw, pitch: view.pitch };
}
function frame(now) {
  const dt = Math.min((now - previous) / 1000, .05); previous = now; elapsed += dt;
  if (!started) { preview.tick(dt); state = preview.snapshot(); }
  else {
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
  if (!me.vehicle && distance(me, LANDMARKS.bank) < 8) prompt = state.bankCooldown > 0 ? `הבנק נעול · ${Math.ceil(state.bankCooldown)} שנ׳` : 'תחילת שוד הכספת';
  if (!me.vehicle && distance(me, LANDMARKS.hideout) < 10 && me.loot) prompt = 'הפקדת השלל';
  if (!me.vehicle && distance(me, LANDMARKS.delivery) < 12 && me.delivery) prompt = 'מסירת משלוח';
  $('interaction').lastElementChild.textContent = prompt; $('interaction').classList.toggle('hidden', !!me.jail || !!modal);
  $('map-distance').textContent = waypoint ? `${Math.round(distance(me, waypoint))} M · ${waypoint.en}` : district(me.x, me.z);
  drawMap($('minimap'), state, me, waypoint);
  if (modal === 'map') drawMap($('full-map'), state, me, waypoint, true);
}
function openChat() { if (!started || modal) return; keys.clear(); touch.reset(); aiming = false; document.body.classList.add('chatting'); $('chat-form').classList.remove('hidden'); $('chat-open').classList.add('hidden'); $('chat-input').focus(); }
function closeChat() { document.body.classList.remove('chatting'); $('chat-form').classList.add('hidden'); $('chat-open').classList.remove('hidden'); $('chat-input').blur(); }
$('chat-open').onclick = openChat;
$('chat-form').onsubmit = event => { event.preventDefault(); const text = $('chat-input').value.trim(); if (text) { if (mode === 'online') socket.emit('chat', text); else addChat({ name: state.players.find(p => p.id === id).name, text }); } $('chat-input').value = ''; closeChat(); };
function closeModal() { modal = null; document.body.classList.remove('modal-open'); $('modal').classList.add('hidden'); keys.clear(); touch.reset(); }
function showModal(kind, content) { closeChat(); modal = kind; document.body.classList.add('modal-open'); keys.clear(); touch.reset(); aiming = false; talk(false); $('modal-content').innerHTML = content; $('modal').classList.remove('hidden'); }
function openMap() {
  if (!started) return;
  showModal('map', `<div class="modal-eyebrow">SENTINEL COAST / CITY MAP</div><h2>לאן ממשיכים?</h2><div class="map-layout"><canvas id="full-map" width="650" height="650" aria-label="מפת העיר"></canvas><div class="map-places">${Object.entries(LANDMARKS).filter(([k]) => k !== 'jail').map(([key, l], i) => `<button data-place="${key}"><span style="color:${l.color}">0${i + 1}</span><div><b>${l.label}</b><small>${l.en}</small></div>↗</button>`).join('')}<button id="delivery-job" class="job-button">קבלת משלוח · $900</button><p>הקו מסמן את כיוון היעד. בחר מסלול דרך הרחובות.</p></div></div>`);
  document.querySelectorAll('[data-place]').forEach(button => { button.onclick = () => { waypoint = LANDMARKS[button.dataset.place]; closeModal(); toast(`יעד חדש: ${waypoint.label}`); }; });
  $('delivery-job').onclick = () => { closeModal(); action('delivery'); waypoint = LANDMARKS.delivery; };
  drawMap($('full-map'), state, state.players.find(p => p.id === id), waypoint, true);
}
function help() {
  showModal('help', `<div class="modal-eyebrow">RP SMAI / FIELD GUIDE</div><h2>העיר היא מגרש המשחקים שלך.</h2><div class="help-grid"><div><h3>טלפון וטאבלט</h3><p>ג׳ויסטיק שמאלי לתנועה ולהיגוי; דחיפה עד הקצה לריצה. גרור על העיר לסיבוב המצלמה. כפתור פעולה לכניסה לרכב, יציאה ואינטראקציה. הפעל כוונת ולחץ ירי; בזמן נהיגה לחץ בלם. אחרי הפעלת המיקרופון, החזק את כפתור הדיבור. מומלץ לשחק לרוחב.</p><h3>תנועה ונהיגה</h3><p><kbd>W A S D</kbd> או החצים · תנועה ונהיגה<br><kbd>SHIFT</kbd> ריצה · <kbd>SPACE</kbd> בלם יד<br><kbd>E</kbd> כניסה לרכב, יציאה ופעולות<br>גרירת עכבר שמאלית · מצלמה<br><kbd>F</kbd> מצלמה בגוף ראשון / שלישי</p><h3>כיוון וירי</h3><p>החזק כפתור עכבר ימני, או לחץ Q כדי לכוון.<br>הזז את העכבר בזמן כיוון. כפתור שמאלי יורה.<br><kbd>R</kbd> טעינה · מחסנית 12 כדורים.<br>ירי אזרחי מפעיל תגובת משטרה.</p></div><div><h3>העבודה הראשונה</h3><p><kbd>M</kbd> פותח מפה. בחר משלוח לטיילת כדי להרוויח $900, או היכנס לבנק דרך הפתח הגדול. ליד הכספת לחץ E והישאר 14 שניות. התחמק מהשוטרים והפקד את השלל בנקודת המילוט.</p><h3>חברים וקול</h3><p>היכנסו לאותה כתובת שרת והקלידו אותו קוד חדר. <kbd>T</kbd> פותח צ׳אט. הפעל מיקרופון ואז החזק <kbd>V</kbd> כדי לדבר. הקול נשמע עד 85 מטר. <kbd>L</kbd> מפעיל סירנה בניידת; <kbd>G</kbd> מתקן רכב ליד המוסך.</p></div></div><p class="credits-note">גרסת אלפא מקורית. דמות Sam מאת Innerscene / MakeHuman ברישיון CC0. רכב Car Concept © Darmstadt Graphics Group / Eric Chadwick, ברישיון CC BY 4.0. <a href="${import.meta.env.BASE_URL}licenses/credits.html" target="_blank" rel="noopener">קרדיטים ורישיונות ↗</a></p>`);
}
function pause() {
  if (!started) return;
  showModal('pause', `<div class="modal-eyebrow">RP SMAI / SESSION</div><h2>רגע לנשום.</h2><p class="muted">העיר ממשיכה לפעול כשהתפריט פתוח.</p><div class="pause-actions"><button id="resume" class="primary">חזרה לעיר ↗</button><button id="help-in-game">מדריך ושליטה</button><button id="invite">שיתוף קישור לחברים</button><button id="players-button">שחקנים בעיר</button><button id="fullscreen">מסך מלא</button><label class="quality-label">שליטה במגע <input id="touch-enabled" type="checkbox"></label><label class="quality-label">גרפיקה וצללים <select id="quality"><option value="high">גבוהה</option><option value="low">ביצועים</option></select></label><button id="leave" class="danger-button">יציאה לתפריט הראשי</button></div>`);
  $('resume').onclick = closeModal; $('help-in-game').onclick = help;
  $('quality').value = renderer.renderer.shadowMap.enabled ? 'high' : 'low'; $('quality').onchange = e => renderer.quality(e.target.value === 'high');
  $('invite').onclick = shareInvite;
  $('players-button').onclick = showPlayers;
  $('touch-enabled').checked = touch.enabled; $('touch-enabled').onchange = e => touch.enable(e.target.checked);
  $('fullscreen').onclick = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen(); else toast('בדפדפן זה אפשר להוסיף למסך הבית דרך תפריט השיתוף.'); } catch { toast('מסך מלא אינו זמין בדפדפן הזה.'); } };
  $('leave').onclick = leaveGame;
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
    saveSolo(); started = false; voice?.dispose(); voice = null; socket?.disconnect(); socket = null; localSim = null; mode = null; id = null; keys.clear(); aiming = false; waypoint = null;
  touch.reset(); document.body.classList.remove('in-game'); closeModal(); closeChat(); updateMic(); $('hud').classList.add('hidden'); $('lobby').classList.remove('hidden'); $('disconnect-banner').classList.add('hidden'); audio.update(null, state);
}
function updateMic() { $('mic-button').classList.toggle('enabled', !!voice?.enabled); $('mic-label').textContent = voice?.enabled ? (touch.enabled ? 'קול פעיל' : 'V כדי לדבר') : 'קול כבוי'; }
$('mic-button').onclick = async () => {
  if (mode === 'solo') { toast('וויס צ׳אט זמין בחדר עם חברים.'); return; }
  if (voice?.enabled) { voice.stop(); updateMic(); return; }
  try { await voice.enable(); updateMic(); toast(touch.enabled ? 'המיקרופון מוכן. החזק את כפתור הדיבור כדי לשדר.' : 'המיקרופון מוכן. רק בזמן החזקת V הקול משודר.'); }
  catch (e) { toast(e.name === 'NotAllowedError' ? 'לא ניתנה הרשאת מיקרופון. אפשר לשנות זאת בהגדרות הדפדפן.' : e.message, 'danger'); }
};
$('sound-button').onclick = () => { audio.enabled = !audio.enabled; $('sound-button').classList.toggle('muted-button', !audio.enabled); };
$('map-button').onclick = $('expand-map').onclick = $('mission-button').onclick = openMap;
$('pause-button').onclick = pause; $('about-button').onclick = help; $('close-modal').onclick = closeModal;
$('modal').addEventListener('click', event => { if (event.target === $('modal')) closeModal(); });
document.addEventListener('keydown', event => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) { if (event.code === 'Escape') { event.preventDefault(); closeChat(); event.target.blur(); } return; }
  if (!started) { if (event.code === 'Escape') closeModal(); return; }
  if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  if (event.code === 'Escape') { modal ? closeModal() : pause(); return; }
  if (modal) return; keys.add(event.code); if (event.repeat) return;
  if (event.code === 'KeyE') action('interact'); if (event.code === 'KeyR') action('reload'); if (event.code === 'KeyG') action('garage'); if (event.code === 'KeyL') action('siren');
  if (event.code === 'KeyM') openMap(); if (event.code === 'KeyT') { event.preventDefault(); openChat(); } if (event.code === 'KeyF') view.firstPerson = !view.firstPerson;
  if (event.code === 'KeyQ') { aiming = !aiming; cameraFollow = !aiming; }
  if (event.code === 'KeyV') { voice?.talk(true); $('mic-button').classList.toggle('talking', !!voice?.enabled); }
  if (event.code === 'Tab') showPlayers();
});
document.addEventListener('keyup', event => { keys.delete(event.code); if (event.code === 'KeyV') { voice?.talk(false); $('mic-button').classList.remove('talking'); } if (event.code === 'Tab' && modal === 'players') closeModal(); });
window.addEventListener('blur', () => { keys.clear(); aiming = false; mouseDrag = false; voice?.talk(false); $('mic-button').classList.remove('talking'); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { keys.clear(); aiming = false; voice?.talk(false); } });
document.addEventListener('contextmenu', event => { if (started && !modal) event.preventDefault(); });
$('world').addEventListener('pointerdown', event => {
  if (event.pointerType !== 'mouse' || !started || modal) return;
  if (event.button === 2) { aiming = true; cameraFollow = false; }
  if (event.button === 0) { if (aiming) { if (mode === 'solo') localSim.setInput(id, input()); else socket?.emit('input', input()); action('shoot'); } else { mouseDrag = true; cameraFollow = false; } }
});
window.addEventListener('pointerup', event => { if (event.pointerType !== 'mouse') return; if (event.button === 2) { aiming = false; cameraFollow = true; } if (event.button === 0) { mouseDrag = false; cameraFollow = true; } });
window.addEventListener('pointermove', event => { if (event.pointerType !== 'mouse' || !started || modal || (!mouseDrag && !aiming)) return; view.yaw -= event.movementX * .004; view.pitch = Math.max(-.45, Math.min(.55, view.pitch - event.movementY * .003)); });
window.addEventListener('beforeunload', () => { saveSolo(); voice?.stop(); });
setInterval(saveSolo, 10000);
const invitedRoom = new URLSearchParams(location.search).get('room'); if (invitedRoom) $('room-code').value = invitedRoom.toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20);
