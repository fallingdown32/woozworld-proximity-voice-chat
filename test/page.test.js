import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

function value(v) {
  if (v === null) return Buffer.from([0]);
  if (typeof v === 'boolean') return Buffer.from([1, v ? 1 : 0]);
  if (Number.isInteger(v)) { const b = Buffer.alloc(5); b[0] = 4; b.writeInt32BE(v, 1); return b; }
  if (typeof v === 'string') return Buffer.concat([Buffer.from([8]), str(v)]);
  if (Array.isArray(v)) return Buffer.concat([Buffer.from([17, v.length >> 8, v.length & 255]), ...v.map(value)]);
  const keys = Object.keys(v);
  return Buffer.concat([Buffer.from([18, keys.length >> 8, keys.length & 255]), ...keys.flatMap((k) => [str(k), value(v[k])])]);
}
function str(s) { const b = Buffer.from(s); return Buffer.concat([Buffer.from([b.length >> 8, b.length & 255]), b]); }
function frame(packet, compress = false) {
  const body = compress ? deflateSync(value(packet)) : value(packet);
  const head = Buffer.from([compress ? 0xa0 : 0x80, body.length >> 8, body.length & 255]);
  const bytes = Buffer.concat([head, body]);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length);
}
const ext = (c, p) => ({ c: 1, a: 13, p: { c, p } });

test('the page script follows our room from the game socket', async () => {
  const sockets = [];
  class FakeSocket extends EventTarget { constructor(url) { super(); this.url = url; sockets.push(this); } }
  const document = new EventTarget();
  const snapshots = [];
  document.addEventListener('proxvoice', (event) => snapshots.push(JSON.parse(event.detail)));
  const window = { WebSocket: FakeSocket };
  new Function('window', 'document', await readFile(new URL('../extension/page.js', import.meta.url), 'utf8'))(window, document);
  const socket = new window.WebSocket('wss://game.example:9933/websocket');
  assert.ok(socket instanceof FakeSocket && window.WebSocket.proxVoice);

  const receive = (data) => { const event = new Event('message'); event.data = data; socket.dispatchEvent(event); };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 250));
  receive(frame({ c: 0, a: 1, p: { id: 7 } }));
  receive(frame(ext('jps', { id: 'u55', name: 'Rooftop', users: [
    { uid: 7, username: 'Me', vars: { x: 1, y: 2 } }, { uid: 8, username: 'Pal', vars: { x: 5, y: 5 } }] }), true));
  receive(frame(ext('eps', { uid: 9, username: 'New', vars: { x: 0, y: 0 } })));
  receive(frame(ext('mv', { u: 8, x: 3, y: 4 })));
  receive(frame(ext('lps', { uid: 9 })));
  receive('text frames are ignored');
  await settle();
  assert.deepEqual(snapshots.at(-1), { self: 7, room: 'game.example:9933#u55', roomName: 'Rooftop', users: [[7, 1, 2, 'Me'], [8, 3, 4, 'Pal']] });

  receive(new Uint8Array([0x80, 0xff, 0xff, 1]).buffer);
  socket.dispatchEvent(new Event('close'));
  await settle();
  assert.deepEqual(snapshots.at(-1), { self: null, room: null, roomName: '', users: [] });
});
