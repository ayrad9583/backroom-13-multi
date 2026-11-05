// Backrooms SYNT — public multiplayer server
// Node.js 20+ | npm install | npm start
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const rooms = new Map();
const clients = new Map();
const MAX_ROOMS = 80, MAX_PLAYERS = 8;
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};

const server = http.createServer((req,res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/health') {
    res.writeHead(200, {'content-type':'application/json; charset=utf-8'});
    return res.end(JSON.stringify({ok:true, service:'backrooms-synt-multiplayer', rooms:rooms.size, players:clients.size}));
  }
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/backrooms-synt-multiplayer.html';
  const file = path.resolve(ROOT, '.' + pathname);
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err,data) => {
    if (err) { res.writeHead(404, {'content-type':'text/plain; charset=utf-8'}); return res.end('Fichier introuvable'); }
    res.writeHead(200, {'content-type':mime[path.extname(file)] || 'application/octet-stream','cache-control':'no-cache'});
    res.end(data);
  });
});
const wss = new WebSocketServer({server, maxPayload: 256 * 1024});
function send(ws,obj){ if(ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(obj)); }
function publicRooms(){
  return [...rooms.values()].map(r=>({id:r.id,name:r.name,count:r.players.size,max:MAX_PLAYERS,started:r.started}));
}
function roomSnapshot(r){
  return {id:r.id,name:r.name,started:r.started,players:[...r.players.values()].map(p=>({id:p.id,name:p.name,x:p.x,z:p.z,yaw:p.yaw,level:p.level,skin:p.skin,role:p.role}))};
}
function broadcastRoom(r){
  const data={type:'room',room:roomSnapshot(r)};
  for(const p of r.players.values()) send(p.ws,data);
}
function broadcastRooms(){
  const data={type:'rooms',rooms:publicRooms()};
  for(const ws of wss.clients) send(ws,data);
}
function leave(ws){
  const c=clients.get(ws); if(!c)return;
  clients.delete(ws);
  if(c.room){
    const r=rooms.get(c.room);
    if(r){
      r.players.delete(c.id);
      for(const p of r.players.values()) send(p.ws,{type:'left',playerId:c.id});
      if(!r.players.size) rooms.delete(r.id);
      else { if(r.host===c.id){r.host=r.players.keys().next().value;for(const p of r.players.values())p.role=p.id===r.host?'host':'guest';}
        broadcastRoom(r); }
    }
  }
  broadcastRooms();
}
wss.on('connection',ws=>{
  const id=Math.random().toString(36).slice(2,10);
  clients.set(ws,{id,room:null});
  send(ws,{type:'welcome',playerId:id});
  ws.on('message',raw=>{
    let m; try{m=JSON.parse(raw.toString());}catch{return send(ws,{type:'error',message:'Message invalide.'});}
    if(!m || typeof m.type!=='string')return;
    const c=clients.get(ws); if(!c)return;
    if(m.type==='list'){send(ws,{type:'rooms',rooms:publicRooms()});return;}
    if(m.type==='create'){
      if(c.room)return send(ws,{type:'error',message:'Quitte ton salon actuel avant d’en créer un autre.'});
      if(rooms.size>=MAX_ROOMS)return send(ws,{type:'error',message:'Trop de salons actifs. Réessaie plus tard.'});
      const rid=Math.random().toString(36).slice(2,9);
      const name=String(m.name||'Expédition SYNT').replace(/[<>]/g,'').trim().slice(0,28)||'Expédition SYNT';
      const r={id:rid,name,host:c.id,started:false,seed:null,level:0,players:new Map()};
      const p={id:c.id,ws,name:'Chercheur '+c.id.slice(0,4),x:0,z:0,yaw:0,level:0,skin:'jaune',role:'host'};
      r.players.set(c.id,p);rooms.set(rid,r);c.room=rid;
      send(ws,{type:'created',playerId:c.id,role:'host',room:roomSnapshot(r)});
      broadcastRoom(r);broadcastRooms();return;
    }
    if(m.type==='join'){
      if(c.room)return send(ws,{type:'error',message:'Tu es déjà dans un salon.'});
      const r=rooms.get(String(m.room||''));
      if(!r)return send(ws,{type:'error',message:'Ce salon n’existe plus.'});
      if(r.started)return send(ws,{type:'error',message:'Cette partie a déjà commencé.'});
      if(r.players.size>=MAX_PLAYERS)return send(ws,{type:'error',message:'Ce salon est complet.'});
      const p={id:c.id,ws,name:'Chercheur '+c.id.slice(0,4),x:0,z:0,yaw:0,level:0,skin:'jaune',role:'guest'};
      r.players.set(c.id,p);c.room=r.id;
      send(ws,{type:'joined',playerId:c.id,role:'guest',room:roomSnapshot(r)});
      broadcastRoom(r);broadcastRooms();return;
    }
    if(m.type==='leave'){leave(ws);return;}
    if(m.type==='start'){
      const r=rooms.get(c.room);
      if(!r||r.host!==c.id)return send(ws,{type:'error',message:'Seul l’hôte peut démarrer la partie.'});
      if(r.players.size<1)return;
      r.started=true;
      r.seed=Number.isFinite(m.seed)?(m.seed|0):null; r.level=Number.isFinite(m.level)?Math.max(0,Math.min(100000,m.level|0)):0;
      for(const p of r.players.values())send(p.ws,{type:'started',roomId:r.id,seed:r.seed,level:r.level});
      broadcastRoom(r);broadcastRooms();return;
    }
    if(m.type==='state'){
      const r=rooms.get(c.room),p=r&&r.players.get(c.id);if(!p)return;
      const x=Number(m.x),z=Number(m.z),yaw=Number(m.yaw),level=Number(m.level);
      if(![x,z,yaw,level].every(Number.isFinite))return;
      p.x=Math.max(-100000,Math.min(100000,x));p.z=Math.max(-100000,Math.min(100000,z));
      p.yaw=yaw;p.level=Math.max(0,Math.min(100000,level));
      if(typeof m.skin==='string' && /^[a-z0-9_-]{1,20}$/.test(m.skin))p.skin=m.skin;
      for(const other of r.players.values())if(other.id!==c.id)send(other.ws,{type:'player',player:{id:p.id,name:p.name,x:p.x,z:p.z,yaw:p.yaw,level:p.level,skin:p.skin}});
    }
    if(m.type==='world'){
      const r=rooms.get(c.room); if(!r || r.host!==c.id || !r.started)return;
      const payload={type:'world',level:Number.isFinite(m.level)?m.level:r.level,seed:Number.isFinite(m.seed)?m.seed:r.seed,entity:m.entity&&typeof m.entity==='object'?m.entity:null,monsters:Array.isArray(m.monsters)?m.monsters.slice(0,120):[],collected:Array.isArray(m.collected)?m.collected.slice(0,1000):[],bookGone:Array.isArray(m.bookGone)?m.bookGone.slice(0,1000):[]};
      r.level=payload.level; r.seed=payload.seed;
      for(const other of r.players.values())if(other.id!==c.id)send(other.ws,payload);
      return;
    }
    if(m.type==='worldEvent'){
      const r=rooms.get(c.room); if(!r)return;
      const ev=m.event; if(!ev||typeof ev!=='object')return;
      if(ev.kind==='pickup' && typeof ev.key==='string' && ev.key.length<=80){for(const other of r.players.values())if(other.id!==c.id)send(other.ws,{type:'worldEvent',event:{kind:'pickup',key:ev.key}});}
      if(ev.kind==='level' && Number.isFinite(ev.level)){for(const other of r.players.values())if(other.id!==c.id)send(other.ws,{type:'worldEvent',event:{kind:'level',level:Math.max(0,Math.min(100000,ev.level|0))}});}
      return;
    }
  });
  ws.on('close',()=>leave(ws));
  ws.on('error',()=>leave(ws));
});
server.listen(PORT,'0.0.0.0',()=>console.log(`Backrooms SYNT multiplayer listening on ${PORT}`));
