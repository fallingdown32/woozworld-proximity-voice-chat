import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';

export function createVoiceServer({ maxRoom = 40, maxPerSecond = 60 } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024, perMessageDeflate: false });
  const rooms = new Map();
  const send = (socket, message) => socket.readyState === 1 && socket.send(JSON.stringify(message));
  const fail = (socket, reason) => { send(socket, { t: 'error', reason }); socket.close(4000, reason); };
  const card = (socket) => ({ id: socket.id, uid: socket.uid });

  function leave(socket) {
    const key = socket.room, room = rooms.get(key);
    socket.room = null;
    if (room?.get(socket.id) !== socket) return;
    room.delete(socket.id);
    if (!room.size) rooms.delete(key);
    for (const peer of room.values()) send(peer, { t: 'leave', id: socket.id });
  }

  wss.on('connection', (socket) => {
    Object.assign(socket, { id: randomUUID(), room: null, uid: null, alive: true });
    send(socket, { t: 'hello', id: socket.id });
    let since = 0, count = 0;
    socket.on('pong', () => { socket.alive = true; });
    socket.on('message', (raw) => {
      const now = Date.now();
      if (now - since > 1000) [since, count] = [now, 0];
      if ((count += 1) > maxPerSecond) return fail(socket, 'rate');
      let message;
      try { message = JSON.parse(raw); } catch { return fail(socket, 'bad'); }
      if (message?.t === 'join') {
        const { room, uid } = message;
        if (room !== null && (typeof room !== 'string' || !room || room.length > 128 || !Number.isInteger(uid))) return fail(socket, 'bad');
        leave(socket);
        if (room === null) return send(socket, { t: 'peers', peers: [] });
        const members = rooms.get(room) ?? new Map();
        if ([...members.values()].some((peer) => peer.uid === uid)) return send(socket, { t: 'error', reason: 'taken' });
        if (members.size >= maxRoom) return send(socket, { t: 'error', reason: 'full' });
        Object.assign(socket, { room, uid });
        send(socket, { t: 'peers', peers: [...members.values()].map(card) });
        for (const peer of members.values()) send(peer, { t: 'join', peer: card(socket) });
        members.set(socket.id, socket);
        rooms.set(room, members);
      } else if (message?.t === 'signal' && typeof message.to === 'string' && message.data && typeof message.data === 'object') {
        const peer = rooms.get(socket.room)?.get(message.to);
        if (peer && peer !== socket) send(peer, { t: 'signal', from: socket.id, data: message.data });
      }
    });
    socket.on('close', () => leave(socket));
    socket.on('error', () => {});
  });

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.alive) socket.terminate();
      else { socket.alive = false; socket.ping(); }
    }
  }, 30e3);
  heartbeat.unref();

  return {
    handleUpgrade: (request, socket, head) => wss.handleUpgrade(request, socket, head, (client) => wss.emit('connection', client, request)),
    close() {
      clearInterval(heartbeat);
      for (const socket of wss.clients) socket.terminate();
    },
  };
}
