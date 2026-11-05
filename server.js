'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const GAME_FILE = 'backrooms-synt (13) (1).html';
const ROOT = __dirname;
const MAX_PLAYERS = 4;
const MAX_MESSAGE_BYTES = 2048;
const ROOM_TTL_MS = 30 * 60 * 1000;
const rooms = new Map();
const sockets = new Set();

function cleanName(value) {
  return String(value || 'Chercheur').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 20) || 'Chercheur';
}
function roomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from(crypto.randomBytes(5), byte => alphabet[byte % alphabet.length]).join(''); }
  while (rooms.has(code));
  return code;
}
function send(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}
function members(room) {
  return [...room.clients].map(client => ({ id: client.id, name: client.playerName, ready: client.ready, host: client === room.host }));
}
function broadcast(room, payload) { for (const client of room.clients) send(client, payload); }
function updateRoom(room) { broadcast(room, { type: 'players', room: room.code, players: members(room) }); }
function leaveRoom(socket) {
  const room = socket.room;
  if (!room) return;
  room.clients.delete(socket);
  socket.room = null;
  if (room.clients.size === 0) { rooms.delete(room.code); return; }
  if (room.host === socket) {
    room.host = room.clients.values().next().value;
    send(room.host, { type: 'notice', message: 'L’hôte a quitté le salon. Vous êtes maintenant l’hôte.' });
  }
  updateRoom(room);
}
function joinRoom(socket, code) {
  const normalized = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  const room = rooms.get(normalized);
  if (!room) return send(socket, { type: 'error', message: 'Salon introuvable. Vérifie le code.' });
  if (room.clients.size >= MAX_PLAYERS) return send(socket, { type: 'error', message: 'Ce salon est complet (4 joueurs maximum).' });
  if (room.started) return send(socket, { type: 'error', message: 'Cette partie a déjà commencé.' });
  socket.ready = false;
  socket.room = room;
  room.clients.add(socket);
  send(socket, { type: 'joined', room: room.code, host: false, players: members(room) });
  updateRoom(room);
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
    return;
  }
  if (pathname === '/multiplayer.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(path.join(ROOT, 'multiplayer.js')).pipe(res);
  }
  if (pathname !== '/' && pathname !== `/${encodeURIComponent(GAME_FILE)}` && pathname !== `/${GAME_FILE}`) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }
  fs.readFile(path.join(ROOT, GAME_FILE), 'utf8', (error, html) => {
    if (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Impossible de lire le fichier du jeu.');
      return;
    }
    const tag = '<script src="/multiplayer.js" defer></script>';
    const page = html.includes('/multiplayer.js') ? html : html.replace(/<\/body\s*>/i, `${tag}</body>`);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : page);
  });
});

const wss = new WebSocket.Server({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname !== '/ws') return socket.destroy();
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
wss.on('connection', socket => {
  sockets.add(socket);
  socket.id = crypto.randomUUID();
  socket.playerName = 'Chercheur';
  socket.ready = false;
  socket.room = null;
  socket.on('message', raw => {
    let message;
    try { message = JSON.parse(raw.toString()); }
    catch { return send(socket, { type: 'error', message: 'Message invalide.' }); }
    if (!message || typeof message.type !== 'string') return;
    if (message.type === 'create') {
      if (socket.room) leaveRoom(socket);
      const room = { code: roomCode(), clients: new Set(), host: socket, started: false, createdAt: Date.now() };
      socket.playerName = cleanName(message.name);
      socket.ready = true;
      socket.room = room;
      room.clients.add(socket);
      rooms.set(room.code, room);
      send(socket, { type: 'joined', room: room.code, host: true, players: members(room) });
      updateRoom(room);
      return;
    }
    if (message.type === 'join') {
      if (socket.room) leaveRoom(socket);
      socket.playerName = cleanName(message.name);
      return joinRoom(socket, message.room);
    }
    const room = socket.room;
    if (!room) return send(socket, { type: 'error', message: 'Crée ou rejoins un salon d’abord.' });
    if (message.type === 'ready') {
      socket.ready = Boolean(message.ready);
      updateRoom(room);
    } else if (message.type === 'start') {
      if (room.host !== socket) return send(socket, { type: 'error', message: 'Seul l’hôte peut lancer la partie.' });
      if (room.clients.size < 2) return send(socket, { type: 'error', message: 'Attends qu’un autre joueur rejoigne le salon.' });
      if ([...room.clients].some(client => !client.ready)) return send(socket, { type: 'error', message: 'Tout le monde doit être prêt.' });
      room.started = true;
      broadcast(room, { type: 'start', room: room.code });
    } else if (message.type === 'leave') {
      leaveRoom(socket);
      send(socket, { type: 'left' });
    }
  });
  socket.on('close', () => { sockets.delete(socket); leaveRoom(socket); });
});
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.clients.size === 0 || (now - room.createdAt > ROOM_TTL_MS && !room.started)) {
      for (const client of room.clients) send(client, { type: 'error', message: 'Le salon a expiré.' });
      rooms.delete(code);
    }
  }
  for (const socket of sockets) if (socket.readyState === WebSocket.OPEN) socket.ping();
}, 60_000).unref();
wss.on('error', error => console.error('WebSocket:', error));
server.listen(PORT, () => console.log(`Backrooms multijoueur : http://localhost:${PORT}`));
