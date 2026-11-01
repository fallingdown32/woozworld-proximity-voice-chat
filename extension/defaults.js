const VOICE_DEFAULTS = {
  on: true,
  mode: 'ptt',
  key: 'Backquote',
  threshold: -50,
  muted: false,
  deafened: false,
  volume: 1,
  range: 10,
  panel: false,
  device: '',
  players: {},
  server: 'wss://voice.browseminecraft.org/voice',
};
const VOICE_NEAR = 2;
const VOICE_TILES = ['linear-gradient(to right top,#ff3200,#f86800)', '#f23b57', '#0aa0f0', 'linear-gradient(to right top,#2f9e0f,#7ad63a)', 'linear-gradient(to right top,#6a3df0,#a46bff)', 'linear-gradient(to right top,#d6336c,#ff6fa8)'];
const voiceTile = (uid) => VOICE_TILES[Math.abs(uid) % VOICE_TILES.length];
const voiceInitial = (name) => (String(name).trim()[0] || '?').toUpperCase();
