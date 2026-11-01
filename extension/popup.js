const $ = (id) => document.getElementById(id);
let settings = { ...VOICE_DEFAULTS }, status = null, micAllowed = false;

const keyName = (code) => (code === 'Backquote' ? '`' : code.replace(/^(Key|Digit)/, '').replace(/^Arrow/, '') || code);
const save = (values) => {
  settings = { ...settings, ...values };
  chrome.storage.local.set({ voice: settings });
  render();
};
chrome.storage.local.get('voice').then(({ voice }) => {
  settings = { ...VOICE_DEFAULTS, ...voice };
  render();
  meter();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.voice) return;
  const device = settings.device;
  settings = { ...VOICE_DEFAULTS, ...changes.voice.newValue };
  render();
  if (settings.device !== device) meter();
});

function render() {
  $('on').checked = settings.on;
  const mute = settings.muted || settings.deafened;
  $('mute').setAttribute('aria-pressed', String(settings.muted));
  $('mute').querySelector('use').setAttribute('href', mute ? '#i-mic-off' : '#i-mic');
  $('mute').querySelector('em').textContent = settings.muted ? 'Muted' : settings.deafened ? 'Off' : 'On';
  $('deafen').setAttribute('aria-pressed', String(settings.deafened));
  $('deafen').querySelector('use').setAttribute('href', settings.deafened ? '#i-ears-off' : '#i-ears');
  $('deafen').querySelector('em').textContent = settings.deafened ? 'Deafened' : 'On';
  for (const button of document.querySelectorAll('[data-mode]')) button.setAttribute('aria-checked', String(button.dataset.mode === settings.mode));
  $('pttRow').hidden = settings.mode !== 'ptt';
  $('vadRow').hidden = settings.mode !== 'vad';
  if (!$('key').classList.contains('listening')) $('key').textContent = keyName(settings.key);
  $('threshold').value = settings.threshold;
  $('thresholdOut').textContent = `${settings.threshold} dB`;
  $('mark').style.left = `${(settings.threshold + 90) / 90 * 100}%`;
  $('mark').hidden = settings.mode !== 'vad';
  $('volume').value = settings.volume;
  $('volumeOut').textContent = `${Math.round(settings.volume * 100)}%`;
  $('range').value = settings.range;
  $('rangeOut').textContent = `${settings.range} tiles`;
  $('panel').checked = settings.panel;
  $('panelOut').textContent = settings.panel ? 'Shown' : 'Hidden';
  if (document.activeElement !== $('server')) $('server').value = settings.server;
  $('device').value = settings.device;
  renderStatus();
}

function renderStatus() {
  const s = settings.on ? status : null;
  const state = !settings.on ? 'off' : !s || s.state === 'off' ? 'idle' : s.state;
  $('dot').className = state;
  $('state').textContent = { off: 'Off', idle: 'Waiting', connecting: 'Connecting...', error: 'Problem', live: 'Connected' }[state];
  const near = s?.players.filter((p) => p.near).length ?? 0;
  $('where').textContent = state === 'off' ? 'Voice is off. Use the power button to turn it on.'
    : state === 'idle' ? 'Open Woozworld and log in to start talking.'
    : state === 'error' ? s.text
    : state === 'live' ? `${s.room ? `In ${s.room}` : 'Not in a Unitz'} · ${near} nearby` : '';
  const players = s?.state === 'live' ? s.players : [];
  $('count').textContent = players.length ? String(players.length) : '';
  $('empty').textContent = state !== 'live' ? 'Players in your Unitz with voice show up here.'
    : players.length ? '' : 'Nobody else here has voice on yet.';
  const list = $('players'), rows = new Map([...list.children].map((li) => [li.dataset.uid, li]));
  for (const player of players) {
    const li = rows.get(String(player.uid)) ?? row(player.uid);
    rows.delete(String(player.uid));
    list.append(li);
    const own = settings.players[player.uid] ?? 1;
    const tile = li.querySelector('.dot');
    tile.className = `dot ${player.speaking ? 'speaking' : player.near ? 'near' : ''}`;
    tile.textContent = voiceInitial(player.name);
    tile.style.setProperty('--tile', voiceTile(player.uid));
    li.querySelector('.name').firstChild.textContent = player.name;
    li.querySelector('small').textContent = !player.connected ? 'connecting...' : player.speaking ? 'talking' : player.near ? 'nearby' : 'too far to hear';
    const slider = li.querySelector('input');
    if (document.activeElement !== slider) slider.value = own;
    slider.setAttribute('aria-label', `Volume for ${player.name}`);
    const mute = li.querySelector('button');
    mute.setAttribute('aria-pressed', String(own === 0));
    mute.setAttribute('aria-label', own === 0 ? `Unmute ${player.name}` : `Mute ${player.name}`);
    mute.querySelector('use').setAttribute('href', own === 0 ? '#i-speaker-off' : '#i-speaker');
  }
  for (const li of rows.values()) li.remove();
}

function row(uid) {
  const li = document.createElement('li');
  li.dataset.uid = uid;
  li.innerHTML = `<i class="dot"></i><span class="name"> <small></small></span><input type="range" min="0" max="1" step="0.05">
    <button type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-speaker"/></svg></button>`;
  const player = (volume) => {
    const players = { ...settings.players };
    if (volume === 1) delete players[uid];
    else players[uid] = volume;
    save({ players });
  };
  li.querySelector('input').addEventListener('input', (event) => player(Number(event.target.value)));
  li.querySelector('button').addEventListener('click', () => player((settings.players[uid] ?? 1) === 0 ? 1 : 0));
  return li;
}

function listen() {
  const port = chrome.runtime.connect({ name: 'popup' });
  port.onMessage.addListener((message) => {
    status = message.status;
    renderStatus();
  });
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    status = null;
    renderStatus();
    setTimeout(listen, 1500);
  });
}
listen();

let stream = null, frame = 0;
async function meter() {
  cancelAnimationFrame(frame);
  for (const track of stream?.getTracks() ?? []) track.stop();
  stream = null;
  const permission = await navigator.permissions.query({ name: 'microphone' }).catch(() => null);
  micAllowed = permission?.state === 'granted';
  if (permission) permission.onchange = meter;
  $('allow').hidden = micAllowed;
  if (!micAllowed) return;
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default');
  $('device').replaceChildren(new Option('System default', ''), ...devices.map((d, i) => new Option(d.label || `Microphone ${i + 1}`, d.deviceId)));
  $('device').value = settings.device;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: settings.device ? { exact: settings.device } : undefined, echoCancellation: true, noiseSuppression: true } });
  } catch {
    return;
  }
  const context = new AudioContext(), analyser = context.createAnalyser(), samples = new Float32Array(1024);
  analyser.fftSize = 1024;
  context.createMediaStreamSource(stream).connect(analyser);
  const draw = () => {
    analyser.getFloatTimeDomainData(samples);
    const db = 10 * Math.log10(samples.reduce((sum, s) => sum + s * s, 0) / samples.length + 1e-12);
    $('level').style.width = `${Math.max(0, Math.min(100, (db + 90) / 90 * 100))}%`;
    $('level').classList.toggle('open', settings.mode === 'ptt' || db > settings.threshold);
    frame = requestAnimationFrame(draw);
  };
  draw();
}

const openMicPage = () => chrome.tabs.create({ url: 'mic.html' });
$('allowBtn').addEventListener('click', openMicPage);
$('on').addEventListener('change', () => {
  save({ on: $('on').checked });
  if (settings.on && !micAllowed) openMicPage();
});
$('mute').addEventListener('click', () => save({ muted: !settings.muted }));
$('deafen').addEventListener('click', () => save({ deafened: !settings.deafened }));
for (const button of document.querySelectorAll('[data-mode]')) button.addEventListener('click', () => save({ mode: button.dataset.mode }));
$('threshold').addEventListener('input', () => save({ threshold: Number($('threshold').value) }));
$('volume').addEventListener('input', () => save({ volume: Number($('volume').value) }));
$('range').addEventListener('input', () => save({ range: Number($('range').value) }));
$('panel').addEventListener('change', () => save({ panel: $('panel').checked }));
$('device').addEventListener('change', () => save({ device: $('device').value }));
$('server').addEventListener('change', () => {
  const server = $('server').value.trim();
  if (/^wss?:\/\/[^\s/]+/.test(server)) save({ server });
  else render();
});
$('serverReset').addEventListener('click', () => save({ server: VOICE_DEFAULTS.server }));
$('key').addEventListener('click', () => {
  $('key').classList.add('listening');
  $('key').textContent = 'Press a key';
  window.addEventListener('keydown', (event) => {
    event.preventDefault();
    $('key').classList.remove('listening');
    if (event.code !== 'Escape') save({ key: event.code });
    else render();
  }, { once: true, capture: true });
});

$('version').textContent = chrome.runtime.getManifest?.().version ?? '';
