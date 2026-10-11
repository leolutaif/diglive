const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

function send(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

// streams: Map<room, { hostWs, nickname, quality, viewers: Map<viewerId, ws> }>
const streams = new Map();
// Todos os clientes conectados recebem atualizações da lista de transmissões.
const connectedClients = new Set();

function streamsSnapshot() {
  return Array.from(streams.entries()).map(([room, s]) => ({
    room,
    nickname: s.nickname,
    quality: s.quality,
    viewers: s.viewers.size,
  }));
}

function broadcastStreams() {
  const payload = { type: 'streams-list', streams: streamsSnapshot() };
  for (const client of connectedClients) send(client, payload);
}

function endStream(room) {
  const s = streams.get(room);
  if (!s) return;
  for (const viewer of s.viewers.values()) send(viewer, { type: 'host-left' });
  streams.delete(room);
  broadcastStreams();
}

function leaveWatch(ws) {
  const s = streams.get(ws.watching);
  if (s) {
    s.viewers.delete(ws.id);
    send(s.hostWs, { type: 'viewer-left', viewerId: ws.id });
  }
  ws.watching = null;
  broadcastStreams();
}

wss.on('connection', (ws) => {
  ws.id = require('crypto').randomBytes(6).toString('hex');
  ws.nickname = null;
  ws.room = null;
  ws.watching = null;
  connectedClients.add(ws);
  send(ws, { type: 'streams-list', streams: streamsSnapshot() });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'set-nickname') {
      ws.nickname = String(msg.nickname || '').slice(0, 24) || 'Anônimo';
      return;
    }

    if (msg.type === 'go-live') {
      const room = require('crypto').randomBytes(4).toString('hex');
      streams.set(room, {
        hostWs: ws,
        nickname: ws.nickname || 'Anônimo',
        quality: msg.quality || { resolution: '1080p', fps: 60 },
        viewers: new Map(),
      });
      ws.room = room;
      send(ws, { type: 'live-started', room });
      broadcastStreams();
      return;
    }

    if (msg.type === 'stop-live') {
      endStream(ws.room);
      ws.room = null;
      return;
    }

    if (msg.type === 'watch') {
      const s = streams.get(msg.room);
      if (!s) { send(ws, { type: 'error', message: 'Essa transmissão não existe mais.' }); return; }
      ws.watching = msg.room;
      s.viewers.set(ws.id, ws);
      send(s.hostWs, { type: 'viewer-joined', viewerId: ws.id });
      broadcastStreams();
      return;
    }

    if (msg.type === 'leave-watch') {
      leaveWatch(ws);
      return;
    }

    if (['offer', 'answer', 'ice'].includes(msg.type)) {
      if (ws.room) {
        const s = streams.get(ws.room);
        if (!s) return;
        const viewer = s.viewers.get(msg.viewerId);
        send(viewer, { ...msg, from: 'host' });
      } else if (ws.watching) {
        const s = streams.get(ws.watching);
        if (!s) return;
        send(s.hostWs, { ...msg, viewerId: ws.id, from: 'viewer' });
      }
      return;
    }
  });

  ws.on('close', () => {
    connectedClients.delete(ws);
    if (ws.room) endStream(ws.room);
    if (ws.watching) leaveWatch(ws);
  });
});

const PORT = process.env.PORT || 6767;
server.listen(PORT, '0.0.0.0', () => console.log(`Diglive rodando na porta ${PORT}`));
