(() => {
  const Native = window.WebSocket;
  if (!Native || Native.proxVoice) return;
  const MAX_FRAME = 4 << 20, MAX_INFLATED = 16 << 20, MAX_USERS = 300;
  let self = null, host = '', room = null, roomName = '', users = new Map(), timer = 0, last = '';

  async function inflate(bytes) {
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
    const parts = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_INFLATED) return void reader.cancel();
      parts.push(value);
    }
    const out = new Uint8Array(size);
    parts.reduce((at, part) => (out.set(part, at), at + part.length), 0);
    return out;
  }

  function read(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const text = new TextDecoder();
    let i = 0;
    const need = (n) => { if (i + n > bytes.length) throw new Error('short'); const at = i; i += n; return at; };
    const u16 = () => view.getUint16(need(2));
    const str = () => { const n = u16(); return text.decode(bytes.subarray(need(n), i)); };
    const list = (one) => Array.from({ length: u16() }, one);
    const val = (depth) => {
      if (depth > 32) throw new Error('deep');
      const t = bytes[need(1)];
      switch (t) {
        case 0: return null;
        case 1: return bytes[need(1)] === 1;
        case 2: return bytes[need(1)];
        case 3: return view.getInt16(need(2));
        case 4: return view.getInt32(need(4));
        case 5: return Number(view.getBigInt64(need(8)));
        case 6: return view.getFloat32(need(4));
        case 7: return view.getFloat64(need(8));
        case 8: return str();
        case 9: return list(() => bytes[need(1)] === 1);
        case 10: need(view.getInt32(need(4)) >>> 0); return null;
        case 11: return list(() => view.getInt16(need(2)));
        case 12: return list(() => view.getInt32(need(4)));
        case 13: return list(() => Number(view.getBigInt64(need(8))));
        case 14: return list(() => view.getFloat32(need(4)));
        case 15: return list(() => view.getFloat64(need(8)));
        case 16: return list(str);
        case 17: return list(() => val(depth + 1));
        case 18: { const o = Object.create(null); for (let n = u16(); n > 0; n -= 1) { const k = str(); o[k] = val(depth + 1); } return o; }
        default: throw new Error('type');
      }
    };
    return val(0);
  }

  async function decode(buffer) {
    const b = new Uint8Array(buffer);
    if (b.length < 3 || !(b[0] & 0x80)) return null;
    const big = b[0] & 0x08, start = big ? 5 : 3;
    if (b.length < start) return null;
    const length = big ? new DataView(buffer).getUint32(1) : new DataView(buffer).getUint16(1);
    if (length > MAX_FRAME || start + length > b.length) return null;
    const body = b[0] & 0x20 ? await inflate(b.subarray(start, start + length)) : b.subarray(start, start + length);
    return body ? read(body) : null;
  }

  const name = (value, old = '') => (typeof value === 'string' ? value.slice(0, 40) : old);
  function put(uid, x, y, username) {
    if (!Number.isInteger(uid) || !Number.isFinite(x) || !Number.isFinite(y)) return;
    if (!users.has(uid) && users.size >= MAX_USERS) return;
    users.set(uid, [x, y, name(username, users.get(uid)?.[2])]);
  }

  function apply(packet, from) {
    if (packet?.c === 0 && packet.a === 1 && Number.isInteger(packet.p?.id)) {
      self = packet.p.id;
      host = from;
      return send();
    }
    if (packet?.c !== 1 || packet.a !== 13) return;
    const command = packet.p?.c, data = packet.p?.p;
    if (!data) return;
    if (command === 'jps') {
      room = typeof data.id === 'string' || Number.isInteger(data.id) ? `${host}#${data.id}` : null;
      roomName = name(data.name);
      users = new Map();
      for (const user of Array.isArray(data.users) ? data.users : []) put(user?.uid, user?.vars?.x, user?.vars?.y, user?.username);
    } else if (command === 'eps') {
      put(data.uid, data.vars?.x, data.vars?.y, data.username);
    } else if (command === 'lps') {
      users.delete(data.uid);
    } else if (command === 'mv') {
      put(data.u, data.x, data.y);
    } else return;
    send();
  }

  function send() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = 0;
      const text = JSON.stringify({ self, room, roomName, users: [...users].map(([id, [x, y, n]]) => [id, x, y, n]) });
      if (text !== last) document.dispatchEvent(new CustomEvent('proxvoice', { detail: text }));
      last = text;
    }, 100);
  }

  function reset() {
    self = room = null;
    roomName = '';
    users = new Map();
    send();
  }

  function watch(socket, url) {
    let queue = Promise.resolve(), smartfox = false;
    const from = (() => { try { return new URL(url).host; } catch { return ''; } })();
    socket.addEventListener('message', ({ data }) => {
      if (typeof data === 'string') return;
      queue = queue.then(async () => {
        const packet = await decode(data instanceof Blob ? await data.arrayBuffer() : data);
        if (packet) smartfox = true;
        apply(packet, from);
      }).catch(() => {});
    });
    socket.addEventListener('close', () => { queue = queue.then(() => smartfox && reset()); });
  }

  const Hooked = new Proxy(Native, {
    construct(target, args, newTarget) {
      const socket = Reflect.construct(target, args, newTarget === Hooked ? target : newTarget);
      try { watch(socket, String(args[0])); } catch {}
      return socket;
    },
    get: (target, key) => (key === 'proxVoice' ? true : Reflect.get(target, key)),
  });
  window.WebSocket = Hooked;
})();
