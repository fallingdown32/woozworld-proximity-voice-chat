let settings = { ...VOICE_DEFAULTS }, view = null, port = null, starting = false, retryAt = 0, talking = false, hud = null;

chrome.storage.local.get('voice').then(({ voice }) => {
  settings = { ...VOICE_DEFAULTS, ...voice };
  update();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.voice) return;
  settings = { ...VOICE_DEFAULTS, ...changes.voice.newValue };
  update();
});
const save = (values) => chrome.storage.local.set({ voice: { ...settings, ...values } });

const short = (s, n) => typeof s === 'string' && s.length <= n;
document.addEventListener('proxvoice', (event) => {
  if (!short(event.detail, 65536)) return;
  let next;
  try { next = JSON.parse(event.detail); } catch { return; }
  const { self, room, roomName, users } = next ?? {};
  if ((self !== null && !Number.isInteger(self)) || (room !== null && !short(room, 200)) || !short(roomName, 40)) return;
  if (!Array.isArray(users) || users.length > 300) return;
  if (!users.every((u) => Array.isArray(u) && u.length === 4 && Number.isInteger(u[0]) && Number.isFinite(u[1]) && Number.isFinite(u[2]) && short(u[3], 40))) return;
  view = { self, room, roomName, users };
  update();
});

const wanted = () => Boolean(settings.on && view?.self != null);
function update() {
  if (!wanted()) {
    port?.disconnect();
    return gone();
  }
  if (port) port.postMessage({ settings, view });
  else if (!starting && Date.now() >= retryAt) start();
  draw();
}
setInterval(() => !port && update(), 5000);

async function start() {
  starting = true;
  const opened = await chrome.runtime.sendMessage({ voice: 'open' }).catch(() => false);
  starting = false;
  retryAt = Date.now() + 5000;
  if (!opened || !wanted() || port) return draw(opened ? undefined : { state: 'error', text: 'Voice could not start' });
  const own = port = chrome.runtime.connect({ name: 'voice' });
  own.onMessage.addListener((message) => message?.status && draw(message.status));
  own.onDisconnect.addListener(() => { if (port === own) gone(); });
  own.postMessage({ settings, view });
}

function gone() {
  port = null;
  talking = false;
  hud?.host.remove();
  hud = null;
  lastStatus = { state: 'connecting', text: '', players: [] };
}

function press(down) {
  return (event) => {
    if (!port || settings.mode !== 'ptt' || event.code !== settings.key) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat || talking === down) return;
    talking = down;
    port.postMessage({ talk: down });
  };
}
window.addEventListener('keydown', press(true), true);
window.addEventListener('keyup', press(false), true);
window.addEventListener('blur', () => {
  if (!talking) return;
  talking = false;
  port?.postMessage({ talk: false });
});

const ICONS = {
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
  micOff: '<path d="M2 2l20 20"/><path d="M18.9 13.4A7 7 0 0 0 19 12v-2"/><path d="M15 9.3V5a3 3 0 0 0-5.7-1.3"/><path d="M9 9v3a3 3 0 0 0 5.1 2.1"/><path d="M16.9 16.9A7 7 0 0 1 5 12v-2"/><path d="M12 19v3"/>',
  ears: '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>',
  earsOff: '<path d="M2 2l20 20"/><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 2.6-6.4"/><path d="M8.3 3.9A9 9 0 0 1 21 12v5"/><path d="M21 14h-3"/>',
  speaker: '<path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6A1.4 1.4 0 0 1 5.4 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.4 5.6a9 9 0 0 1 0 12.8"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
const CSS = `
:host { all: initial; position: fixed; left: 12px; bottom: 12px; z-index: 2147483646; font: 400 13px/1.3 Ubuntu, "Trebuchet MS", sans-serif; letter-spacing: -.2px; color: #fff; pointer-events: none; }
.talkers { display: flex; flex-direction: column; align-items: flex-start; gap: 5px; margin-bottom: 8px; }
.talker { display: flex; align-items: center; gap: 7px; height: 29px; padding: 1px 12px 1px 2px; border-radius: 100px; background: rgba(43,43,43,.94);
  font: 600 14px "Nunito Sans", sans-serif; box-shadow: 0 4px 14px rgba(0,0,0,.35); animation: in .14s ease-out; }
.talker b { display: grid; place-items: center; width: 25px; height: 25px; border-radius: 100px; background: #35b879; }
.talker svg { width: 14px; height: 14px; stroke: #fff; }
.bar { display: flex; align-items: center; gap: 6px; }
button { pointer-events: auto; display: grid; place-items: center; width: 40px; height: 40px; padding: 0; border: 0; border-radius: 5.3px; cursor: pointer;
  background: #3b3c3d; color: #fff; box-shadow: 0 4px 14px rgba(0,0,0,.35); transition: background .12s; }
button:hover { background: #4b4b4b; }
button:focus-visible { outline: 2px solid #2683ff; outline-offset: 2px; }
button.on { background: #35b879; box-shadow: 0 0 16px rgba(53,184,121,.6); }
button.off { background: #f23b57; }
button.idle { color: #8a8f93; }
svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.note { display: flex; align-items: center; height: 29px; padding: 0 12px; border-radius: 100px; background: rgba(43,43,43,.94); max-width: 260px; font: 600 13px "Nunito Sans", sans-serif; }
.note.error { color: #ffc7d0; }
.note:empty { display: none; }
.panel { position: fixed; top: 72px; right: 12px; width: 232px; padding: 11px; pointer-events: auto; border-radius: 16px; background: #2b2b2b;
  box-shadow: 0 10px 30px rgba(0,0,0,.45); }
.panel[hidden] { display: none; }
.head { display: flex; align-items: center; gap: 8px; cursor: grab; touch-action: none; user-select: none; }
.head.dragging { cursor: grabbing; }
.app { width: 28px; height: 28px; flex: none; border-radius: 6px; }
.sep { width: 1px; height: 14px; flex: none; background: #717171; }
.where { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: #dedede; font: 600 15px "Nunito Sans", sans-serif; }
.badge { display: flex; align-items: center; gap: 5px; height: 24px; padding: 0 9px 0 3px; border-radius: 100px; background: rgba(116,116,116,.435); font: 600 12px "Nunito Sans", sans-serif; }
.badge i { width: 18px; height: 18px; border-radius: 100px; background: #35b879; }
.badge.none i { background: rgba(116,116,116,.64); }
.rule { height: 1px; margin: 10px 0; background: #717171; }
.list { margin: 0; padding: 0; list-style: none; max-height: 240px; overflow-y: auto; border-radius: 7.6px; background: #4b4b4b; }
.list li { display: flex; align-items: center; gap: 9px; padding: 7px 10px; border-top: 1px solid #1c1d1d; font: 600 14px "Nunito Sans", sans-serif; }
.list li:first-child { border-top: 0; }
.list li.far { color: #a3a3a3; }
.list li.far i { opacity: .45; }
.list i { display: grid; place-items: center; width: 23px; height: 23px; flex: none; border-radius: 2.85px; font-style: normal; font-weight: 700; font-size: 12px; color: #fff; }
.list li.talking i { box-shadow: 0 0 0 2px #4b4b4b, 0 0 0 4px #35b879; }
.list span { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.list small { color: #cfcfcf; font: 400 11px Ubuntu, sans-serif; opacity: .75; }
.list li.talking small { color: #35b879; opacity: 1; }
.list .empty { color: #cfcfcf; font: 400 12px Ubuntu, sans-serif; }
.foot { margin-top: 8px; color: #8a8f93; font-size: 11px; }
@keyframes in { from { opacity: 0; transform: translateX(-6px); } }
@media (prefers-reduced-motion: reduce) { .talker { animation: none; } button { transition: none; } }`;

for (const [family, file, weight] of [['Ubuntu', 'ubuntu-400', '400'], ['Ubuntu', 'ubuntu-700', '700'], ['Nunito Sans', 'nunito-sans-600', '600'], ['Nunito Sans', 'nunito-sans-700', '700']]) {
  document.fonts.add(new FontFace(family, `url(${chrome.runtime.getURL(`fonts/${file}.woff2`)})`, { weight }));
}

const keyName = (code) => (code === 'Backquote' ? '`' : code.replace(/^(Key|Digit)/, ''));
let lastStatus = { state: 'connecting', text: '', players: [] };
function draw(status = lastStatus) {
  lastStatus = status;
  if (!port && status.state !== 'error') return;
  if (!hud) {
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>${CSS}</style><div class="talkers" role="status" aria-label="Talking now"></div>
      <div class="bar"><button class="mic"></button><button class="ears"></button><span class="note" role="status"></span></div>
      <section class="panel" aria-label="Voice: players in this Unitz" hidden><div class="head" title="Drag to move"><img class="app" alt="" src="${chrome.runtime.getURL('icons/48.png')}"><i class="sep"></i><span class="where"></span><span class="badge"><i></i><b></b></span></div><div class="rule"></div><ul class="list"></ul><div class="foot">Proximity Voice</div></section>`;
    hud = { host, talkers: root.querySelector('.talkers'), mic: root.querySelector('.mic'), ears: root.querySelector('.ears'), note: root.querySelector('.note'),
      panel: root.querySelector('.panel'), where: root.querySelector('.where'), badge: root.querySelector('.badge'), list: root.querySelector('.list') };
    drag(root.querySelector('.head'));
    hud.mic.addEventListener('click', () => save({ muted: !settings.muted }));
    hud.ears.addEventListener('click', () => save({ deafened: !settings.deafened }));
    (document.body ?? document.documentElement).append(host);
  }
  const live = status.state === 'live';
  const how = settings.mode === 'ptt' ? `hold ${keyName(settings.key)} to talk` : 'voice activation';
  const micLabel = settings.muted ? 'Microphone muted. Click to unmute' : `Microphone on (${how}). Click to mute`;
  hud.mic.className = `mic ${settings.muted || settings.deafened ? 'off' : status.transmitting ? 'on' : live ? '' : 'idle'}`;
  hud.mic.innerHTML = icon(settings.muted || settings.deafened ? 'micOff' : 'mic');
  hud.mic.title = micLabel;
  hud.mic.setAttribute('aria-label', micLabel);
  const earsLabel = settings.deafened ? 'Sound off. Click to hear others' : 'Hearing others. Click to turn sound off';
  hud.ears.className = `ears ${settings.deafened ? 'off' : ''}`;
  hud.ears.innerHTML = icon(settings.deafened ? 'earsOff' : 'ears');
  hud.ears.title = earsLabel;
  hud.ears.setAttribute('aria-label', earsLabel);
  hud.note.className = `note ${status.state === 'error' ? 'error' : ''}`;
  hud.note.textContent = status.state === 'connecting' ? 'Voice connecting...' : status.state === 'error' ? status.text : '';
  hud.panel.hidden = !settings.panel;
  if (settings.panel) {
    placePanel();
    const near = status.players.filter((p) => p.near);
    hud.where.textContent = !live ? (status.state === 'error' ? 'Voice problem' : 'Voice connecting...') : status.room || 'Not in a Unitz';
    hud.badge.querySelector('b').textContent = String(near.length);
    hud.badge.title = `${near.length} nearby`;
    hud.badge.className = `badge ${near.length ? '' : 'none'}`;
    const rows = live ? status.players.map((p) => {
      const li = document.createElement('li');
      li.className = p.speaking ? 'talking' : p.near ? '' : 'far';
      const tag = document.createElement('small');
      tag.textContent = !p.connected ? 'joining' : p.speaking ? 'talking' : p.near ? 'nearby' : 'too far';
      const name = document.createElement('span');
      name.textContent = p.name;
      const tile = document.createElement('i');
      tile.textContent = voiceInitial(p.name);
      tile.style.background = voiceTile(p.uid);
      li.append(tile, name, tag);
      return li;
    }) : [];
    if (!rows.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = live ? 'Nobody else here has voice on' : status.text || '';
      rows.push(li);
    }
    hud.list.replaceChildren(...rows);
  }
  const names = status.players.filter((p) => p.speaking).map((p) => p.name);
  if (hud.talkers.dataset.names !== names.join('\n')) {
    hud.talkers.dataset.names = names.join('\n');
    hud.talkers.replaceChildren(...names.map((name) => {
      const chip = document.createElement('div');
      chip.className = 'talker';
      chip.innerHTML = `<b>${icon('speaker')}</b>`;
      chip.append(name);
      return chip;
    }));
  }
}

let panelAt = null;
chrome.storage.local.get('voicePanelAt').then(({ voicePanelAt }) => {
  panelAt = voicePanelAt ?? null;
  placePanel();
});
function placePanel() {
  if (!hud || !panelAt) return;
  const { panel } = hud;
  panel.style.right = 'auto';
  panel.style.left = `${Math.max(0, Math.min(panelAt.x, innerWidth - panel.offsetWidth))}px`;
  panel.style.top = `${Math.max(0, Math.min(panelAt.y, innerHeight - 40))}px`;
}
addEventListener('resize', placePanel);
function drag(head) {
  let from = null;
  head.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const box = hud.panel.getBoundingClientRect();
    from = { x: event.clientX - box.left, y: event.clientY - box.top };
    head.setPointerCapture(event.pointerId);
    head.classList.add('dragging');
    event.preventDefault();
  });
  head.addEventListener('pointermove', (event) => {
    if (!from) return;
    panelAt = { x: event.clientX - from.x, y: event.clientY - from.y };
    placePanel();
  });
  const drop = () => {
    if (!from) return;
    from = null;
    head.classList.remove('dragging');
    chrome.storage.local.set({ voicePanelAt: panelAt }).catch(() => {});
  };
  head.addEventListener('pointerup', drop);
  head.addEventListener('pointercancel', drop);
}
