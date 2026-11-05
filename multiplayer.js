'use strict';
(() => {
  const style = document.createElement('style');
  style.textContent = `
    #mp-panel{position:fixed;z-index:10000;inset:0;display:grid;place-items:center;padding:18px;background:rgba(3,8,10,.88);font:16px/1.5 "Share Tech Mono",monospace;color:#d9f3f5;user-select:text}
    #mp-panel[hidden]{display:none}
    #mp-card{width:min(520px,100%);padding:24px;background:#071821;border:1px solid #347080;box-shadow:0 0 42px #041015}
    #mp-card h2{margin:0 0 8px;color:#67e6ff;font:36px "VT323",monospace}
    #mp-card p{margin:8px 0;color:#a6c4ca}
    #mp-card label{display:block;margin:12px 0 4px;color:#79a4ad}
    #mp-card input{box-sizing:border-box;width:100%;padding:10px;background:#0b222b;border:1px solid #31515b;color:#e6f8fa;font:16px "Share Tech Mono",monospace}
    #mp-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
    #mp-card button{padding:9px 13px;background:#12313c;border:1px solid #4b8998;color:#d9f3f5;font:inherit;cursor:pointer}
    #mp-card button.primary{background:#67e6ff;color:#07141a;border-color:#67e6ff;font-weight:bold}
    #mp-card button:disabled{opacity:.45;cursor:not-allowed}
    #mp-message{min-height:24px;color:#ffbd83!important}
    #mp-room{font-size:30px;letter-spacing:.18em;color:#ffe58a}
    #mp-players{padding-left:20px}
    #mp-status{color:#7dffb2}
    #mp-back{margin-top:12px}
  `;
  document.head.append(style);
  const panel = document.createElement('section');
  panel.id = 'mp-panel';
  panel.setAttribute('aria-label', 'Salon multijoueur');
  panel.innerHTML = `
    <div id="mp-card"><h2>EXPLORATION EN ÉQUIPE</h2>
      <p>Crée un salon et partage son code avec ton ami, ou rejoins son salon.</p>
      <label for="mp-name">Nom du chercheur</label><input id="mp-name" maxlength="20" autocomplete="nickname" placeholder="Chercheur">
      <div id="mp-lobby-controls"><label for="mp-code">Code du salon</label><input id="mp-code" maxlength="5" autocomplete="off" placeholder="ABCDE" style="text-transform:uppercase">
        <div id="mp-actions"><button class="primary" id="mp-create">Créer un salon</button><button id="mp-join">Rejoindre</button><button id="mp-solo">Jouer seul</button></div>
      </div>
      <div id="mp-room-view" hidden><p>Code à partager</p><div id="mp-room"></div><p id="mp-status">En attente des joueurs…</p><ul id="mp-players"></ul>
        <div id="mp-actions"><button id="mp-ready">Je suis prêt</button><button class="primary" id="mp-start" hidden>Lancer la partie</button><button id="mp-copy">Copier le code</button></div>
      </div>
      <p id="mp-message" role="status" aria-live="polite"></p><button id="mp-back" hidden>Quitter le salon</button>
    </div>`;
  document.body.append(panel);

  const $ = id => document.getElementById(id);
  const originalMenu = document.getElementById('menu');
  let socket;
  let roomCode = '';
  let isHost = false;
  let ready = false;
  let launched = false;
  function showMessage(text) { $('mp-message').textContent = text || ''; }
  function connect() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${scheme}//${location.host}/ws`);
    socket.addEventListener('open', () => showMessage('Connecté au serveur de salons.'));
    socket.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type === 'error' || message.type === 'notice') { showMessage(message.message); return; }
      if (message.type === 'joined') {
        roomCode = message.room;
        isHost = message.host;
        $('mp-lobby-controls').hidden = true;
        $('mp-room-view').hidden = false;
        $('mp-back').hidden = false;
        $('mp-room').textContent = roomCode;
        $('mp-start').hidden = !isHost;
        renderPlayers(message.players);
        showMessage('Salon créé. Envoie le code à ton ami.');
      } else if (message.type === 'players') renderPlayers(message.players);
      else if (message.type === 'start') {
        launched = true;
        panel.hidden = true;
        if (originalMenu) originalMenu.hidden = false;
        const startButton = document.getElementById('start');
        if (startButton) startButton.click();
      } else if (message.type === 'left') resetLobby();
    });
    socket.addEventListener('close', () => { if (!launched && roomCode) showMessage('Connexion perdue. Recharge la page pour réessayer.'); });
  }
  function send(data) {
    if (socket && socket.readyState === WebSocket.OPEN) return socket.send(JSON.stringify(data));
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
    roomCode = '';
    ready = false;
    isHost = false;
    $('mp-room-view').hidden = true;
    $('mp-lobby-controls').hidden = false;
    $('mp-back').hidden = true;
    $('mp-ready').textContent = 'Je suis prêt';
    showMessage('Tu as quitté le salon.');
  }

  $('mp-create').addEventListener('click', () => { connect(); send({ type: 'create', name: $('mp-name').value }); });
  $('mp-join').addEventListener('click', () => {
    const code = $('mp-code').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(code)) return showMessage('Entre un code de salon de 5 caractères.');
    connect(); send({ type: 'join', room: code, name: $('mp-name').value });
  });
  $('mp-solo').addEventListener('click', () => {
    launched = true;
    panel.hidden = true;
    if (originalMenu) originalMenu.hidden = false;
  });
  $('mp-ready').addEventListener('click', () => {
    ready = !ready;
    $('mp-ready').textContent = ready ? 'Annuler « prêt »' : 'Je suis prêt';
    send({ type: 'ready', ready });
  });
  $('mp-start').addEventListener('click', () => send({ type: 'start' }));
  $('mp-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(roomCode); showMessage('Code copié !'); }
    catch { showMessage(`Partage ce code : ${roomCode}`); }
  });
  $('mp-back').addEventListener('click', () => send({ type: 'leave' }));
  if (originalMenu) originalMenu.hidden = true;
  connect();
})();
