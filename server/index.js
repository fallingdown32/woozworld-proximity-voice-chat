#!/usr/bin/env node
import { createServer } from 'node:http';
import { createVoiceServer } from './voice-server.js';

const port = Number(process.env.PORT) || 8795;
const voice = createVoiceServer({ maxRoom: Number(process.env.MAX_ROOM) || 40 });
const server = createServer((request, response) => {
  response.writeHead(404, { 'content-type': 'text/plain' });
  response.end('Not Found');
});
server.on('upgrade', (request, socket, head) => {
  if (new URL(request.url, 'http://host').pathname === '/voice') voice.handleUpgrade(request, socket, head);
  else socket.destroy();
});
server.listen(port, process.env.HOST || undefined, () => console.log(`voice signaling on http://${process.env.HOST || 'localhost'}:${port}/voice`));
