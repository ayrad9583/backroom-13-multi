'use strict';
(() => {
  const style = document.createElement('style');
  style.textContent = `
    #mp-panel{position:fixed;z-index:10000;inset:0;display:grid;place-items:center;padding:18px;background:rgba(3,8,10,.88);font:16px/1.5 "Share Tech Mono",monospace;color:#d9f3f5;user-select:text}
    #mp-panel[hidden]{display:none}#mp-card{width:min(520px,100%);padding:24px;background:#071821;border:1px solid #347080;box-shadow:0 0 42px #041015}
    #mp-card h2{margin:0 0 8px;color:#67e6ff;font:36px "VT323",monospace}#mp-card p{margin:8px 0;color:#a6c4ca}
    #mp-card label{display:block;margin:12px 0 4px;color:#79a4ad}#mp-card input{box-sizing:border-box;width:100%;padding:10px;background:#0b222b;border:1px solid #31515b;color:#e6f8fa;font:16px "Share Tech Mono",monospace}
    #mp-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}#mp-card button{padding:9px 13px;background:#12313c;border:1px solid #4b8998;color:#d9f3f5;font:inherit;cursor:pointer}
    #mp-card button.primary{background:#67e6ff;color:#07141a;border-color:#67e6ff;font-weight:bold}#mp-card button:disabled{opacity:.45;cursor:not-allowed}
    #mp-message{min-height:24px;color:#ffbd83!important}#mp-room{font-size:30px;letter-spacing:.18em;color:#ffe58a}#mp-players{padding-left:20px}#mp-status{color:#7dffb2}#mp-back{margin-top:12px}
    #mp-net-status{position:fixed;z-index:9999;top:12px;left:50%;transform:translateX(-50%);padding:5px 10px;background:rgba(0,0,0,.7);font:16px "Share Tech Mono",monospace;color:#7dffb2;pointer-events:none}
  `;
  document.head.append(style);
  const panel = document.createElement('section');
  panel.id = 'mp-panel';
  panel.setAttribute('aria-label', 'Salon multijoueur');
  panel.innerHTML = `<div id="mp-card"><h2>EXPLORATION EN ÉQUIPE</h2><p>Crée un salon et partage son code avec ton ami, ou rejoins son salon.</p>
    <label for="mp-name">Nom du chercheur</label><input id="mp-name" maxlength="20" autocomplete="nickname" placeholder="Chercheur">
    <div id="mp-lobby-controls"><label for="mp-code">Code du salon</label><input id="mp-code" maxlength="5" autocomplete="off" placeholder="ABCDE" style="text-transform:uppercase">
      <div id="mp-actions"><button class="primary" id="mp-create">Créer un salon</button><button id="mp-join">Rejoindre</button><button id="mp-solo">Jouer seul</button></div></div>
    <div id="mp-room-view" hidden><p>Code à partager</p><div id="mp-room"></div><p id="mp-status">En attente des joueurs…</p><ul id="mp-players"></ul>
      <div id="mp-actions"><button id="mp-ready">Je suis prêt</button><button class="primary" id="mp-start" hidden>Lancer la partie</button><button id="mp-copy">Copier le code</button></div></div>
    <p id="mp-message" role="status" aria-live="polite"></p><button id="mp-back" hidden>Quitter le salon</button></div>`;
  document.body.append(panel);
  const $ = id => document.getElementById(id);
  const originalMenu = $('menu');
  const remotePlayers = new Map();
  let socket;
  let roomCode = '';
  let ready = false;
  let launched = false;
  let currentScene = null;
  let latestCamera = null;
  let sendTimer = null;
  let lastSent = 0;
  const netStatus = document.createElement('div');
  netStatus.id = 'mp-net-status';
  netStatus.hidden = true;
  document.body.append(netStatus);

  function showMessage(text) { $('mp-message').textContent = text || ''; }
  function updateNetStatus() {
    if (!launched || remotePlayers.size === 0) { netStatus.hidden = true; return; }
    netStatus.hidden = false;
    netStatus.textContent = `ÉQUIPE · ${remotePlayers.size} ${remotePlayers.size === 1 ? 'joueur' : 'joueurs'} connecté${remotePlayers.size === 1 ? '' : 's'}`;
  }
  function connect() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
    socket.addEventListener('open', () => showMessage('Connecté au serveur de salons.'));
    socket.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'error' || message.type === 'notice') { showMessage(message.message); return; }
      if (message.type === 'joined') {
        roomCode = message.room;
        $('mp-lobby-controls').hidden = true;
        $('mp-room-view').hidden = false;
        $('mp-back').hidden = false;
        $('mp-room').textContent = roomCode;
        $('mp-start').hidden = !message.host;
        renderPlayers(message.players);
        showMessage('Salon prêt. Envoie le code à ton ami.');
      } else if (message.type === 'players') renderPlayers(message.players);
      else if (message.type === 'player-state') updateRemote(message.player);
      else if (message.type === 'player-left') removeRemote(message.id);
      else if (message.type === 'start') {
        launched = true;
        panel.hidden = true;
        if (originalMenu) originalMenu.hidden = false;
        const startButton = $('start');
        if (startButton) startButton.click();
        window.setTimeout(installThreeHook, 500);
      } else if (message.type === 'left') resetLobby();
    });
    socket.addEventListener('close', () => {
      if (sendTimer) clearInterval(sendTimer);
      if (!launched && roomCode) showMessage('Connexion perdue. Recharge la page pour réessayer.');
      remotePlayers.clear();
      updateNetStatus();
    });
  }
  function send(data) {
    if (socket && socket.readyState === WebSocket.OPEN) { socket.send(JSON.stringify(data)); return; }
    if (!socket || socket.readyState === WebSocket.CLOSED) connect();
    showMessage('Connexion au serveur en cours… réessaie dans un instant.');
    if (socket) socket.addEventListener('open', () => socket.send(JSON.stringify(data)), { once: true });
  }
  function renderPlayers(players) {
    const list = $('mp-players');
    list.replaceChildren();
    for (const player of players || []) {
      const item = document.createElement('li');
      item.textContent = `${player.name}${player.host ? ' · hôte' : ''}${player.ready ? ' · prêt' : ' · en attente'}`;
      list.append(item);
    }
    const enoughPlayers = (players || []).length >= 2;
    const everybodyReady = enoughPlayers && players.every(player => player.ready);
    $('mp-start').disabled = !enoughPlayers || !everybodyReady;
    $('mp-status').textContent = !enoughPlayers ? 'En attente d’un autre joueur…' : everybodyReady ? 'Tout le monde est prêt.' : 'En attente que tout le monde soit prêt…';
  }
  function resetLobby() {
    roomCode = ''; ready = false;
    $('mp-room-view').hidden = true; $('mp-lobby-controls').hidden = false; $('mp-back').hidden = true;
    $('mp-ready').textContent = 'Je suis prêt'; showMessage('Tu as quitté le salon.');
  }
  function makeNameSprite(name) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,.72)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#65e6ff'; ctx.lineWidth = 3; ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
    ctx.fillStyle = '#d9faff'; ctx.font = 'bold 28px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(name || 'Joueur').slice(0, 16), canvas.width / 2, canvas.height / 2);
    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.scale.set(2.4, .6, 1);
    sprite.position.y = 2.35;
    return sprite;
  }
  function createAvatar(player) {
    const group = new THREE.Group();
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x18b9d1, emissive: 0x06323b, roughness: .7 });
    const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x10232a, emissive: 0x051216, roughness: .8 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(.28, .34, 1.05, 8), bodyMaterial);
    body.position.y = .95;
    const head = new THREE.Mesh(new THREE.SphereGeometry(.24, 10, 8), darkMaterial);
    head.position.y = 1.65;
    const marker = new THREE.Mesh(new THREE.ConeGeometry(.12, .28, 8), new THREE.MeshStandardMaterial({ color: 0x8dffcf, emissive: 0x245d43 }));
    marker.rotation.x = Math.PI / 2;
    marker.position.set(0, 1.2, -.36);
    group.add(body, head, marker, makeNameSprite(player.name));
    group.userData.targetPosition = new THREE.Vector3();
    group.userData.targetYaw = 0;
    group.userData.playerId = player.id;
    return group;
  }
  function updateRemote(player) {
    if (!player || player.id === (socket && socket.id) || !Array.isArray(player.position)) return;
    let avatar = remotePlayers.get(player.id);
    if (!avatar) {
      avatar = createAvatar(player);
      remotePlayers.set(player.id, avatar);
    }
    avatar.userData.targetPosition.set(player.position[0], player.position[1], player.position[2]);
    avatar.userData.targetYaw = Number(player.yaw) || 0;
    if (currentScene && avatar.parent !== currentScene) currentScene.add(avatar);
    updateNetStatus();
  }
  function removeRemote(id) {
    const avatar = remotePlayers.get(id);
    if (avatar && avatar.parent) avatar.parent.remove(avatar);
    if (avatar) {
      avatar.traverse(object => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) { if (material.map) material.map.dispose(); material.dispose(); }
        }
      });
    }
    remotePlayers.delete(id);
    updateNetStatus();
  }
  function installThreeHook() {
    if (!window.THREE || !THREE.WebGLRenderer || THREE.WebGLRenderer.prototype.__mpHooked) return;
    const proto = THREE.WebGLRenderer.prototype;
    const originalRender = proto.render;
    proto.render = function(scene, camera) {
      if (launched && scene && camera && camera.position) {
        currentScene = scene;
        latestCamera = camera;
        const now = performance.now();
        if (socket && socket.readyState === WebSocket.OPEN && now - lastSent > 65) {
          lastSent = now;
          const direction = new THREE.Vector3();
          camera.getWorldDirection(direction);
          const yaw = Math.atan2(-direction.x, -direction.z);
          send({ type: 'state', position: [camera.position.x, camera.position.y, camera.position.z], yaw });
        }
        for (const avatar of remotePlayers.values()) {
          if (avatar.parent !== scene) scene.add(avatar);
          avatar.position.lerp(avatar.userData.targetPosition, .35);
          avatar.rotation.y += Math.atan2(Math.sin(avatar.userData.targetYaw - avatar.rotation.y), Math.cos(avatar.userData.targetYaw - avatar.rotation.y)) * .35;
        }
      }
      return originalRender.apply(this, arguments);
    };
    proto.__mpHooked = true;
  }
  function startSync() {
    if (sendTimer) clearInterval(sendTimer);
    sendTimer = setInterval(installThreeHook, 500);
  }

  $('mp-create').addEventListener('click', () => { connect(); send({ type: 'create', name: $('mp-name').value }); });
  $('mp-join').addEventListener('click', () => {
    const code = $('mp-code').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(code)) return showMessage('Entre un code de salon de 5 caractères.');
    connect(); send({ type: 'join', room: code, name: $('mp-name').value });
  });
  $('mp-solo').addEventListener('click', () => { launched = true; panel.hidden = true; if (originalMenu) originalMenu.hidden = false; });
  $('mp-ready').addEventListener('click', () => {
    ready = !ready; $('mp-ready').textContent = ready ? 'Annuler « prêt »' : 'Je suis prêt'; send({ type: 'ready', ready });
  });
  $('mp-start').addEventListener('click', () => send({ type: 'start' }));
  $('mp-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(roomCode); showMessage('Code copié !'); }
    catch { showMessage(`Partage ce code : ${roomCode}`); }
  });
  $('mp-back').addEventListener('click', () => send({ type: 'leave' }));
  if (originalMenu) originalMenu.hidden = true;
  connect();
  startSync();
})();
