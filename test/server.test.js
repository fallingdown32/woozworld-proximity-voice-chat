import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { createVoiceServer } from '../server/voice-server.js';

async function listen(options) {
  const voice = createVoiceServer(options);
  const server = createServer().on('upgrade', (request, socket, head) => voice.handleUpgrade(request, socket, head));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `ws://127.0.0.1:${server.address().port}/voice`, stop: () => { voice.close(); server.close(); } };
}

async function client(url) {
  const ws = new WebSocket(url);
  const inbox = [], waiting = [];
  ws.on('message', (raw) => { const m = JSON.parse(raw); const w = waiting.shift(); w ? w(m) : inbox.push(m); });
  ws.closed = new Promise((resolve) => ws.on('close', (code) => resolve(code)));
  ws.next = () => (inbox.length ? Promise.resolve(inbox.shift()) : new Promise((resolve) => waiting.push(resolve)));
  ws.say = (m) => ws.send(JSON.stringify(m));
  ws.id = (await ws.next()).id;
  return ws;
}

test('players in the same room find each other and signal only there', async () => {
  const { url, stop } = await listen();
  const a = await client(url), b = await client(url), c = await client(url);
  a.say({ t: 'join', room: 'host#1', uid: 10 });
  assert.deepEqual(await a.next(), { t: 'peers', peers: [] });
  b.say({ t: 'join', room: 'host#1', uid: 20 });
  assert.deepEqual(await b.next(), { t: 'peers', peers: [{ id: a.id, uid: 10 }] });
  assert.deepEqual(await a.next(), { t: 'join', peer: { id: b.id, uid: 20 } });
  c.say({ t: 'join', room: 'host#2', uid: 30 });
  assert.deepEqual(await c.next(), { t: 'peers', peers: [] });

  b.say({ t: 'signal', to: a.id, data: { description: { type: 'offer', sdp: 'x' } } });
  assert.deepEqual(await a.next(), { t: 'signal', from: b.id, data: { description: { type: 'offer', sdp: 'x' } } });
  c.say({ t: 'signal', to: a.id, data: { candidate: {} } });

  b.say({ t: 'join', room: 'host#2', uid: 20 });
  assert.deepEqual(await a.next(), { t: 'leave', id: b.id });
  assert.deepEqual(await b.next(), { t: 'peers', peers: [{ id: c.id, uid: 30 }] });
  assert.deepEqual(await c.next(), { t: 'join', peer: { id: b.id, uid: 20 } });
  b.close();
  assert.deepEqual(await c.next(), { t: 'leave', id: b.id });
  a.say({ t: 'signal', to: c.id, data: {} });
  a.say({ t: 'join', room: null });
  assert.deepEqual(await a.next(), { t: 'peers', peers: [] }, 'the cross-room signal never arrived');
  for (const ws of [a, c]) ws.close();
  stop();
});

test('a claimed player or a full room keeps you out, bad input closes', async () => {
  const { url, stop } = await listen({ maxRoom: 2 });
  const a = await client(url), b = await client(url), c = await client(url), d = await client(url);
  a.say({ t: 'join', room: 'r', uid: 1 });
  await a.next();
  b.say({ t: 'join', room: 'r', uid: 1 });
  assert.deepEqual(await b.next(), { t: 'error', reason: 'taken' });
  b.say({ t: 'join', room: 'r', uid: 2 });
  assert.equal((await b.next()).t, 'peers');
  c.say({ t: 'join', room: 'r', uid: 3 });
  assert.deepEqual(await c.next(), { t: 'error', reason: 'full' });
  d.say({ t: 'join', room: 'r', uid: 'x' });
  assert.deepEqual(await d.next(), { t: 'error', reason: 'bad' });
  assert.equal(await d.closed, 4000);
  for (const ws of [a, b, c]) ws.close();
  stop();
});
