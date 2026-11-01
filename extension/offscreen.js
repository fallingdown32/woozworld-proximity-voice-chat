const ICE = [{ urls: 'stun:stun.l.google.com:19302' }];
const HOLD_MS = 400;
const ROOM_ERRORS = { full: 'Voice is full in this Unitz', taken: 'Someone else is already in voice as you here' };
let game = null, settings = { ...VOICE_DEFAULTS }, view = null, talk = false;
let session = 0, ws = null, server = '', me = null, joined = '', error = '';
let raw = null, send = null, device = null, meter = null, openUntil = 0, said = '';
const peers = new Map(), popups = new Set();
const audio = new AudioContext();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'popup') {
    popups.add(port);
    port.onDisconnect.addListener(() => popups.delete(port));
    port.postMessage({ status: status() });
    return;
  }
  if (port.name !== 'voice' || !port.sender?.tab) return;
  game?.disconnect();
  stop();
  game = port;
  port.onMessage.addListener(fromGame);
  port.onDisconnect.addListener(() => {
    if (game !== port) return;
    game = null;
    stop();
    report();
    setTimeout(() => !game && chrome.runtime.sendMessage({ voice: 'close' }).catch(() => {}), 2000);
  });
});

function fromGame(message) {
  if (typeof message.talk === 'boolean') talk = message.talk;
  if (message.settings) settings = { ...VOICE_DEFAULTS, ...message.settings };
  if (message.view) view = message.view;
  if (!game) return;
  if (settings.device !== device) openMic();
  if (settings.server !== server) connect();
  place();
  report();
}

function stop() {
  session += 1;
  ws?.close();
  ws = me = null;
  server = joined = error = '';
  for (const id of [...peers.keys()]) drop(id);
  for (const track of raw?.getTracks() ?? []) track.stop();
  send?.stop();
  raw = send = device = meter = null;
  talk = false;
}

async function openMic() {
  const id = session, want = device = settings.device;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: want ? { exact: want } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch {
    if (id === session && device === want) {
      error = 'Microphone blocked or missing. Open the extension popup to fix it.';
      report();
      setTimeout(() => { if (id === session && device === want) { device = null; fromGame({}); } }, 5000);
    }
    return;
  }
  if (id !== session || device !== want) return stream.getTracks().forEach((track) => track.stop());
  if (error.startsWith('Microphone')) error = '';
  const oldRaw = raw, oldSend = send;
  raw = stream;
  send = stream.getAudioTracks()[0].clone();
  send.enabled = false;
  meter = audio.createAnalyser();
  meter.fftSize = 1024;
  audio.createMediaStreamSource(stream).connect(meter);
  audio.resume().catch(() => {});
  for (const peer of peers.values()) if (peer.sending) peer.sender?.replaceTrack(send).catch(() => {});
  for (const track of oldRaw?.getTracks() ?? []) track.stop();
  oldSend?.stop();
  report();
}

function connect() {
  ws?.close();
  ws = me = null;
  joined = '';
  for (const id of [...peers.keys()]) drop(id);
  const id = session, url = server = settings.server;
  let socket;
  try {
    if (!/^wss?:\/\//.test(url)) throw new Error('scheme');
    socket = ws = new WebSocket(url);
  } catch {
    error = 'The voice server address is not valid';
    return report();
  }
  socket.onmessage = (event) => {
    if (socket !== ws) return;
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    fromServer(message);
  };
  socket.onclose = () => {
    if (socket !== ws) return;
    ws = me = null;
    joined = '';
    for (const peer of [...peers.keys()]) drop(peer);
    error = 'Voice server unreachable, retrying...';
    report();
    setTimeout(() => id === session && !ws && game && connect(), 3000);
  };
}

function fromServer(message) {
  if (message.t === 'hello') {
    me = message.id;
    if (!error.startsWith('Microphone')) error = '';
    place();
  } else if (message.t === 'peers') {
    for (const id of [...peers.keys()]) drop(id);
    for (const peer of message.peers ?? []) add(peer, true);
  } else if (message.t === 'join') add(message.peer ?? {}, false);
  else if (message.t === 'leave') drop(message.id);
  else if (message.t === 'signal') signal(message.from, message.data);
  else if (message.t === 'error' && ROOM_ERRORS[message.reason]) {
    error = ROOM_ERRORS[message.reason];
    const id = session, key = joined;
    setTimeout(() => {
      if (id !== session || joined !== key) return;
      error = '';
      joined = '';
      place();
    }, 10000);
  }
  report();
}
const out = (message) => ws?.readyState === 1 && ws.send(JSON.stringify(message));

function place() {
  const key = view?.room && view.self != null ? `${view.room}|${view.self}` : '-';
  if (!me || key === joined) return;
  joined = key;
  if (Object.values(ROOM_ERRORS).includes(error)) error = '';
  for (const id of [...peers.keys()]) drop(id);
  out(key === '-' ? { t: 'join', room: null } : { t: 'join', room: view.room, uid: view.self });
}

function add({ id, uid }, offer) {
  if (typeof id !== 'string' || !Number.isInteger(uid)) return;
  drop(id);
  const pc = new RTCPeerConnection({ iceServers: ICE });
  const player = new Audio();
  player.volume = 0;
  const peer = { id, uid, pc, player, sender: null, sending: false, level: 0, speakingUntil: 0, chain: Promise.resolve() };
  peers.set(id, peer);
  pc.onicecandidate = ({ candidate }) => candidate && out({ t: 'signal', to: id, data: { candidate: candidate.toJSON() } });
  pc.ontrack = ({ streams, track }) => {
    player.srcObject = streams[0] ?? new MediaStream([track]);
    player.play().catch(() => {});
  };
  pc.onconnectionstatechange = report;
  if (offer) {
    peer.sender = pc.addTransceiver('audio', { direction: 'sendrecv' }).sender;
    queue(peer, async () => {
      await pc.setLocalDescription();
      out({ t: 'signal', to: id, data: { description: pc.localDescription.toJSON() } });
    });
  }
}
const queue = (peer, step) => { peer.chain = peer.chain.then(step).catch(() => {}); };

function signal(from, data) {
  const peer = peers.get(from);
  if (!peer || !data || typeof data !== 'object') return;
  const { description, candidate } = data;
  if (description && ['offer', 'answer'].includes(description.type) && typeof description.sdp === 'string') {
    queue(peer, async () => {
      await peer.pc.setRemoteDescription({ type: description.type, sdp: description.sdp });
      if (description.type !== 'offer') return;
      const transceiver = peer.pc.getTransceivers()[0];
      if (transceiver) {
        transceiver.direction = 'sendrecv';
        peer.sender = transceiver.sender;
        if (peer.sending) await peer.sender.replaceTrack(send);
      }
      await peer.pc.setLocalDescription();
      out({ t: 'signal', to: from, data: { description: peer.pc.localDescription.toJSON() } });
    });
  } else if (candidate && typeof candidate === 'object') queue(peer, () => peer.pc.addIceCandidate(candidate));
}

function drop(id) {
  const peer = peers.get(id);
  if (!peer) return;
  peers.delete(id);
  peer.pc.close();
  peer.player.srcObject = null;
}

const spot = (uid) => view?.users.find((user) => user[0] === uid);
function closeness(peer) {
  if (!view?.room || peer.uid === view.self) return 0;
  const a = spot(view.self), b = spot(peer.uid);
  if (!a || !b) return 0;
  const far = Math.max(2, Number(settings.range) || VOICE_DEFAULTS.range), near = Math.min(VOICE_NEAR, far / 2);
  const t = Math.min(1, Math.max(0, (Math.hypot(a[1] - b[1], a[2] - b[2]) - near) / (far - near)));
  return 1 - t * t * (3 - 2 * t);
}

const transmitting = () => Boolean(send && me && !settings.muted && !settings.deafened
  && (settings.mode === 'ptt' ? talk : performance.now() < openUntil));
const samples = new Float32Array(1024);
setInterval(() => {
  const now = performance.now();
  if (meter) {
    meter.getFloatTimeDomainData(samples);
    const db = 10 * Math.log10(samples.reduce((sum, s) => sum + s * s, 0) / samples.length + 1e-12);
    if (db > settings.threshold) openUntil = now + HOLD_MS;
  }
  if (send) send.enabled = transmitting();
  for (const peer of peers.values()) {
    const target = closeness(peer);
    const near = target > 0;
    if (near !== peer.sending) {
      peer.sending = near;
      peer.sender?.replaceTrack(near ? send : null).catch(() => {});
    }
    peer.level = Math.abs(target - peer.level) < 0.01 ? target : peer.level + (target - peer.level) * 0.3;
    const own = settings.players?.[peer.uid] ?? 1;
    peer.player.volume = settings.deafened ? 0 : Math.min(1, Math.max(0, peer.level * settings.volume * own));
    const source = peer.pc.getReceivers()[0]?.getSynchronizationSources?.()[0];
    const fresh = source && Math.min(Math.abs(now - source.timestamp), Math.abs(Date.now() - source.timestamp)) < 300;
    if (fresh && source.audioLevel > 0.03) peer.speakingUntil = now + 300;
  }
  report();
}, 50);

function status() {
  const now = performance.now();
  const players = [...peers.values()].map((peer) => {
    const near = closeness(peer) > 0;
    return {
      uid: peer.uid,
      name: spot(peer.uid)?.[3] || `Player ${peer.uid}`,
      near,
      speaking: near && !settings.deafened && now < peer.speakingUntil,
      connected: peer.pc.connectionState === 'connected',
    };
  }).sort((a, b) => b.near - a.near || a.name.localeCompare(b.name));
  return {
    state: !game ? 'off' : error ? 'error' : !me ? 'connecting' : 'live',
    text: error,
    transmitting: transmitting(),
    room: view?.roomName || null,
    players,
  };
}

function report() {
  const next = status(), text = JSON.stringify(next);
  if (text === said) return;
  said = text;
  game?.postMessage({ status: next });
  for (const port of popups) port.postMessage({ status: next });
}
