const savedNick = localStorage.getItem('diglive_nickname');



const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };



let ws;

let myNickname = savedNick || '';

let myRoom = null;          // sala que estou transmitindo (se for host)

let watchingRoom = null;    // sala que estou assistindo (se for viewer)

let localStream = null;

let latestQuality = { resolution: '1080p', fps: 60 };

const hostPeers = {};       // viewerId -> RTCPeerConnection, quando sou host

let viewerPc = null;        // RTCPeerConnection, quando sou espectador



const screens = {


  nickname: document.getElementById('screen-nickname'),

  home: document.getElementById('screen-home'),

  live: document.getElementById('screen-live'),

  watch: document.getElementById('screen-watch'),

};

function showScreen(name) {

  Object.values(screens).forEach(el => el.classList.add('hidden'));

  screens[name].classList.remove('hidden');

}



// --- conexão ---

function connectWS() {

  const proto = location.protocol === 'https:' ? 'wss' : 'ws';

  ws = new WebSocket(`${proto}://${location.host}`);



  ws.addEventListener('open', () => {
    if (myNickname) {
      ws.send(JSON.stringify({ type: 'set-nickname', nickname: myNickname }));
      document.getElementById('meLabel').textContent = myNickname;
      showScreen('home');
    } else {
      showScreen('nickname');
    }
  });

  ws.addEventListener('message', (ev) => handleMessage(JSON.parse(ev.data)));

  ws.addEventListener('close', () => setTimeout(connectWS, 2000));

}



function handleMessage(msg) {

  switch (msg.type) {

    case 'streams-list':

      renderStreams(msg.streams);

      break;



    case 'live-started':

      myRoom = msg.room;

      showScreen('live');

      break;



    case 'viewer-joined':

      addHostPeer(msg.viewerId);

      break;



    case 'viewer-left':

      if (hostPeers[msg.viewerId]) { hostPeers[msg.viewerId].close(); delete hostPeers[msg.viewerId]; }

      break;



    case 'answer':

      if (hostPeers[msg.viewerId]) hostPeers[msg.viewerId].setRemoteDescription(new RTCSessionDescription(msg.sdp));

      break;



    case 'ice':

      if (msg.from === 'viewer' && hostPeers[msg.viewerId]) hostPeers[msg.viewerId].addIceCandidate(new RTCIceCandidate(msg.candidate));

      if (msg.from === 'host' && viewerPc) viewerPc.addIceCandidate(new RTCIceCandidate(msg.candidate));

      break;



    case 'offer':

      startViewerPeer(msg.sdp);

      break;



    case 'host-left':

      showWatchMessage('A transmissão foi encerrada.');

      if (viewerPc) { viewerPc.close(); viewerPc = null; }

      break;



    case 'error':

      alert(msg.message);

      showScreen('home');

      break;

  }

}



// --- tela 1: nickname ---

document.getElementById('nicknameForm').addEventListener('submit', (e) => {

  e.preventDefault();

  const value = document.getElementById('nicknameInput').value.trim();

  if (!value) return;

  myNickname = value;

  localStorage.setItem('diglive_nickname', value);

  ws.send(JSON.stringify({ type: 'set-nickname', nickname: value }));

  document.getElementById('meLabel').textContent = value;

  showScreen('home');

});



// --- tela 3: home ---

function renderStreams(streams) {

  if (myRoom) {

    const mine = streams.find(s => s.room === myRoom);

    document.getElementById('liveViewerCount').textContent = mine ? `${mine.viewers} assistindo` : '0 assistindo';

  }



  const grid = document.getElementById('streamsGrid');

  const empty = document.getElementById('emptyState');

  const list = streams.filter(s => s.room !== myRoom); // não lista a própria live



  grid.innerHTML = '';

  if (list.length === 0) {

    empty.classList.remove('hidden');

  } else {

    empty.classList.add('hidden');

    list.forEach(s => grid.appendChild(buildTile(s)));

  }

}



function buildTile(s) {

  const el = document.createElement('button');

  el.className = 'tile';

  el.style.setProperty('--hue', hueFromString(s.nickname));

  el.innerHTML = `

    <div class="tile-thumb"><span class="tally on"></span></div>

    <div class="tile-meta">

      <span class="tile-nick">${escapeHtml(s.nickname)}</span>

      <span class="tile-tags">

        <span class="chip">${s.quality.resolution}${s.quality.fps}</span>

        <span class="chip">${s.viewers} assistindo</span>

      </span>

    </div>`;

  el.addEventListener('click', () => watchStream(s.room, s.nickname));

  return el;

}



function hueFromString(str) {

  let hash = 0;

  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);

  return Math.abs(hash) % 360;

}

function escapeHtml(str) {

  const div = document.createElement('div');

  div.textContent = str;

  return div.innerHTML;

}



// --- ir ao vivo: painel de qualidade ---

const qualityOverlay = document.getElementById('qualityOverlay');

document.getElementById('goLiveBtn').addEventListener('click', () => qualityOverlay.classList.remove('hidden'));

document.getElementById('cancelLiveBtn').addEventListener('click', () => qualityOverlay.classList.add('hidden'));



function setupSegmented(id, onChange) {

  const buttons = document.querySelectorAll(`#${id} .seg`);

  buttons.forEach(btn => btn.addEventListener('click', () => {

    buttons.forEach(b => b.classList.remove('active'));

    btn.classList.add('active');

    onChange(btn.dataset.value);

  }));

}

setupSegmented('resSegmented', (v) => (latestQuality.resolution = v));

setupSegmented('fpsSegmented', (v) => (latestQuality.fps = Number(v)));



document.getElementById('confirmLiveBtn').addEventListener('click', async () => {

  qualityOverlay.classList.add('hidden');



  const dims = latestQuality.resolution === '1080p' ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };



  try {

    localStream = await navigator.mediaDevices.getDisplayMedia({

      video: {

        displaySurface: 'monitor',

        frameRate: { ideal: latestQuality.fps, max: latestQuality.fps },

        width: { ideal: dims.width },

        height: { ideal: dims.height },

      },

      audio: true,

    });

  } catch (err) {

    alert('Não foi possível capturar a tela: ' + err.message);

    return;

  }



  const settings = localStream.getVideoTracks()[0].getSettings();

  if (settings.displaySurface && settings.displaySurface !== 'monitor') {

    const proceed = confirm(

      'Você escolheu compartilhar uma JANELA específica, não a tela inteira.\n\n' +

      'Se for jogar algo em tela cheia, a transmissão provavelmente vai travar em preto assim que o jogo entrar em fullscreen.\n\n' +

      'Recomendado: cancele e escolha "Ecrã inteiro".\n\nQuer continuar assim mesmo?'

    );

    if (!proceed) { localStream.getTracks().forEach(t => t.stop()); localStream = null; return; }

  }



  document.getElementById('localPreview').srcObject = localStream;

  localStream.getVideoTracks()[0].addEventListener('ended', stopLive);



  ws.send(JSON.stringify({ type: 'go-live', quality: latestQuality }));

});



document.getElementById('stopLiveBtn').addEventListener('click', stopLive);



function stopLive() {

  if (localStream) localStream.getTracks().forEach(t => t.stop());

  Object.values(hostPeers).forEach(pc => pc.close());

  Object.keys(hostPeers).forEach(k => delete hostPeers[k]);

  ws.send(JSON.stringify({ type: 'stop-live' }));

  myRoom = null;

  localStream = null;

  showScreen('home');

}



function addHostPeer(viewerId) {

  const pc = new RTCPeerConnection(RTC_CONFIG);

  hostPeers[viewerId] = pc;



  localStream.getTracks().forEach(track => {

    const sender = pc.addTrack(track, localStream);

    if (track.kind === 'video') {

      const params = sender.getParameters();

      if (!params.encodings) params.encodings = [{}];

      params.encodings[0].maxBitrate = latestQuality.resolution === '1080p' ? 10_000_000 : 6_000_000;

      params.degradationPreference = 'maintain-resolution';

      sender.setParameters(params).catch(() => {});

    }

  });



  pc.onicecandidate = (e) => { if (e.candidate) ws.send(JSON.stringify({ type: 'ice', viewerId, candidate: e.candidate })); };

  pc.onconnectionstatechange = () => { if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) delete hostPeers[viewerId]; };



  pc.createOffer().then(offer => {

    pc.setLocalDescription(offer);

    ws.send(JSON.stringify({ type: 'offer', viewerId, sdp: offer }));

  });

}



// --- tela 5: assistindo ---

const watchVideo = document.getElementById('watchVideo');

const watchTapOverlay = document.getElementById('watchTapOverlay');

const watchMsg = document.getElementById('watchMsg');

const watchControls = document.getElementById('watchControls');



function watchStream(room, nickname) {

  watchingRoom = room;

  document.getElementById('watchNick').textContent = nickname;

  watchMsg.classList.add('hidden');

  watchTapOverlay.classList.add('hidden');

  showScreen('watch');

  ws.send(JSON.stringify({ type: 'watch', room }));

}



function startViewerPeer(sdp) {

  viewerPc = new RTCPeerConnection(RTC_CONFIG);

  viewerPc.ontrack = (e) => {

    if (watchVideo.srcObject !== e.streams[0]) { watchVideo.srcObject = e.streams[0]; tryPlayWatch(); }

  };

  viewerPc.onicecandidate = (e) => { if (e.candidate) ws.send(JSON.stringify({ type: 'ice', candidate: e.candidate })); };



  viewerPc.setRemoteDescription(new RTCSessionDescription(sdp))

    .then(() => viewerPc.createAnswer())

    .then(answer => {

      viewerPc.setLocalDescription(answer);

      ws.send(JSON.stringify({ type: 'answer', sdp: answer }));

    });

}



function tryPlayWatch() {

  watchVideo.play().then(() => watchTapOverlay.classList.add('hidden'))

    .catch(() => watchTapOverlay.classList.remove('hidden'));

}

document.getElementById('watchTapBtn').addEventListener('click', () => {

  watchVideo.muted = false;

  document.getElementById('watchMuteBtn').textContent = '🔊';

  watchVideo.play();

  watchTapOverlay.classList.add('hidden');

});



function showWatchMessage(text) { watchMsg.textContent = text; watchMsg.classList.remove('hidden'); }



function leaveWatch() {

  if (viewerPc) { viewerPc.close(); viewerPc = null; }

  watchVideo.srcObject = null;

  if (watchingRoom) ws.send(JSON.stringify({ type: 'leave-watch' }));

  watchingRoom = null;

  showScreen('home');

}

document.getElementById('watchBackBtn').addEventListener('click', leaveWatch);



document.getElementById('watchVolume').addEventListener('input', (e) => {

  watchVideo.volume = e.target.value; watchVideo.muted = false;

  document.getElementById('watchMuteBtn').textContent = '🔊';

});

document.getElementById('watchMuteBtn').addEventListener('click', () => {

  watchVideo.muted = !watchVideo.muted;

  document.getElementById('watchMuteBtn').textContent = watchVideo.muted ? '🔇' : '🔊';

});

document.getElementById('watchFsBtn').addEventListener('click', () => {

  if (!document.fullscreenElement) document.documentElement.requestFullscreen();

  else document.exitFullscreen();

});



let hideTimer;

function revealWatchControls() {

  watchControls.classList.add('show');

  clearTimeout(hideTimer);

  hideTimer = setTimeout(() => watchControls.classList.remove('show'), 2500);

}

document.addEventListener('mousemove', revealWatchControls);

document.addEventListener('touchstart', revealWatchControls);



// --- boot ---
if (myNickname) showScreen('home'); else showScreen('nickname');
connectWS();