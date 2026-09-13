/* ============================================================
 * TeslaStream — Free IPTV Player for Tesla, EV & Web Browsers
 * No signup, no subscription — completely free.
 * Layout matches EVStream / TeslaPlay design.
 * ============================================================ */
'use strict';

/* ---------- Helpers ---------- */
const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/* ---------- Tesla Detection ---------- */
function isTesla() {
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  return /tesla/i.test(ua) || 
         (/Linux/.test(platform) && /Chrome/.test(ua) && navigator.maxTouchPoints > 1) ||
         (platform === 'Linux x86_64' && /Chrome\/\d+/.test(ua) && screen.width >= 1920);
}

/* ---------- Splash Screen ---------- */
(function initSplash() {
  const splash = $('splash');
  const bar = $('splash-bar');
  const marker = $('splash-marker');
  const pct = $('splash-pct');
  const copy = $('splash-copy');
  const messages = ['Loading channels', 'Connecting to servers', 'Syncing playlists', 'Almost ready'];
  let progress = 0;
  const iv = setInterval(() => {
    progress += Math.random() * 15 + 5;
    if (progress >= 100) {
      progress = 100;
      clearInterval(iv);
      copy.textContent = 'Ready';
      setTimeout(() => {
        splash.classList.add('loaded');
        $('app').classList.add('visible');
        setTimeout(() => splash.remove(), 600);
      }, 400);
    }
    bar.style.width = progress + '%';
    marker.style.left = `calc(${progress}% - 4px)`;
    pct.textContent = String(Math.floor(progress)).padStart(3, '0') + '%';
    copy.textContent = messages[Math.min(Math.floor(progress / 26), messages.length - 1)];
  }, 200);
})();

/* ---------- Canvas HLS Player (Tesla Bypass) ---------- */
class CanvasHlsPlayer {
  constructor(videoEl, canvasEl) {
    this.video = videoEl;
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d', { willReadFrequently: false });
    this.hls = null;
    this.playing = false;
    this.frameId = null;
    this.audioCtx = null;
    this.audioSource = null;
    this.mediaStream = null;
  }
  async loadSource(url) {
    this.video.crossOrigin = 'anonymous';
    this.video.playsInline = true;
    this.video.muted = false;
    this.video.style.display = 'none';
    this.canvas.style.display = 'block';
    if (window.Hls && Hls.isSupported()) {
      this.hls = new Hls({ enableWorker: true, lowLatencyMode: true, capLevelToPlayerSize: true, startLevel: -1 });
      this.hls.loadSource(url);
      this.hls.attachMedia(this.video);
      return new Promise((resolve, reject) => {
        this.hls.once(Hls.Events.MANIFEST_PARSED, () => { this.setupCanvasLoop(); this.video.play().catch(() => {}); resolve(); });
        this.hls.once(Hls.Events.ERROR, (_, data) => { if (data.fatal) reject(new Error(data.details)); });
      });
    } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
      this.video.src = url;
      await new Promise((r, e) => { this.video.onloadedmetadata = r; this.video.onerror = e; });
      this.setupCanvasLoop();
      this.video.play().catch(() => {});
    } else { throw new Error('HLS not supported'); }
  }
  setupCanvasLoop() {
    const draw = () => {
      if (!this.playing || this.video.paused || this.video.ended) { this.frameId = requestAnimationFrame(draw); return; }
      if (this.video.readyState >= 2) {
        const cw = this.canvas.width = this.video.videoWidth;
        const ch = this.canvas.height = this.video.videoHeight;
        if (cw && ch) this.ctx.drawImage(this.video, 0, 0, cw, ch);
      }
      this.frameId = requestAnimationFrame(draw);
    };
    this.playing = true;
    this.frameId = requestAnimationFrame(draw);
    try {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      this.mediaStream = this.video.captureStream();
      this.audioSource = this.audioCtx.createMediaStreamSource(this.mediaStream);
      this.audioSource.connect(this.audioCtx.destination);
    } catch {}
  }
  play() { this.playing = true; return this.video.play(); }
  pause() { this.playing = false; this.video.pause(); }
  destroy() {
    this.playing = false;
    if (this.frameId) cancelAnimationFrame(this.frameId);
    if (this.hls) { try { this.hls.destroy(); } catch {} this.hls = null; }
    if (this.audioSource) { try { this.audioSource.disconnect(); } catch {} }
    if (this.audioCtx) { try { this.audioCtx.close(); } catch {} }
    if (this.mediaStream) { this.mediaStream.getTracks().forEach(t => t.stop()); }
    this.video.src = ''; this.video.load();
  }
}

/* ---------- State ---------- */
let playlists = store.get('ts.playlists', []);
let openPlaylistId = store.get('ts.openPlaylist', null);
let pendingChannel = null;
let currentStream = null;
let hlsInstance = null;
let canvasPlayer = null;
const USE_CANVAS = store.get('ts.forceCanvas', false) || isTesla();

/* ---------- Navigation ---------- */
function showSection(id) {
  document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  const sec = $(id);
  if (sec) { sec.classList.remove('hidden'); sec.classList.add('active'); }
  document.querySelectorAll('.nav-link').forEach(b => b.classList.toggle('text-white', b.dataset.section === id));
  document.querySelectorAll('.nav-link').forEach(b => b.classList.toggle('text-gray-300', b.dataset.section !== id));
  if (id === 'iptv') renderPlaylists();
  if (id === 'home') renderRecent();
}
document.querySelectorAll('.nav-link').forEach(btn => {
  if (btn.dataset.section) btn.addEventListener('click', () => { showSection(btn.dataset.section); $('mobile-nav')?.classList.add('hidden'); });
});
function toggleMobileNav() { $('mobile-nav')?.classList.toggle('hidden'); }

/* Home form tabs */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.remove('border-red-500/50', 'bg-red-500/10', 'text-red-400');
      b.classList.add('border-white/10', 'bg-white/5', 'text-white/50');
    });
    btn.classList.add('border-red-500/50', 'bg-red-500/10', 'text-red-400');
    btn.classList.remove('border-white/10', 'bg-white/5', 'text-white/50');
    $('xtream-form').style.display = btn.dataset.tab === 'xtream' ? '' : 'none';
    $('m3u-form').style.display = btn.dataset.tab === 'm3u' ? '' : 'none';
  });
});

/* ---------- Player ---------- */
const playerEl = $('player');
const playerStage = $('player-stage');
const playerTitle = $('player-title');
const qualitySelect = $('player-quality');

function destroyPlayer() {
  if (hlsInstance) { try { hlsInstance.destroy(); } catch {} hlsInstance = null; }
  if (canvasPlayer) { canvasPlayer.destroy(); canvasPlayer = null; }
}
function openPlayer(title) {
  playerTitle.textContent = title || 'Player';
  playerEl.classList.add('active');
}
function closePlayer() {
  playerEl.classList.remove('active');
  destroyPlayer();
  playerStage.innerHTML = '';
  currentStream = null;
}
$('player-close').addEventListener('click', closePlayer);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && playerEl.classList.contains('active')) closePlayer(); });
$('player-fullscreen').addEventListener('click', () => {
  if (!document.fullscreenElement) playerEl.requestFullscreen().catch(() => {});
  else document.exitFullscreen().catch(() => {});
});

async function playHls(url) {
  destroyPlayer();
  if (USE_CANVAS) {
    playerStage.innerHTML = `
      <video id="ts-video" playsinline muted style="display:none"></video>
      <canvas id="ts-canvas" style="width:100%;height:100%;background:#000;display:block"></canvas>
      <div id="ts-loading" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:rgba(255,255,255,0.5);text-align:center;z-index:10">
        <div class="spinner"></div><div>Loading stream...</div>
      </div>`;
    const video = $('ts-video');
    const canvas = $('ts-canvas');
    canvasPlayer = new CanvasHlsPlayer(video, canvas);
    try { await canvasPlayer.loadSource(url); $('ts-loading')?.remove(); canvasPlayer.play(); }
    catch (e) { const l = $('ts-loading'); if (l) l.innerHTML = `<div style="color:#ef4444">Failed: ${esc(e.message)}</div>`; }
    return;
  }
  playerStage.innerHTML = '<video id="ts-video" controls playsinline autoplay style="background:#000;width:100%;height:100%"></video>';
  const video = $('ts-video');
  video.muted = false;
  if (/\.mp4($|\?)/i.test(url) || /\.mov($|\?)/i.test(url)) { video.src = url; video.play().catch(() => {}); return; }
  if (window.Hls && Hls.isSupported()) {
    hlsInstance = new Hls({ enableWorker: true, lowLatencyMode: true, capLevelToPlayerSize: true });
    hlsInstance.loadSource(url);
    hlsInstance.attachMedia(video);
    hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
    hlsInstance.on(Hls.Events.ERROR, (_, data) => {
      if (!data?.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        const mixed = /^http:\/\//i.test(url) && window.location.protocol === 'https:';
        playerStage.innerHTML = `<div style="display:flex;height:100%;align-items:center;justify-content:center;text-align:center;padding:24px;color:rgba(255,255,255,0.5)">${mixed ? 'Plain-http stream blocked on secure page.' : 'Stream blocked by CORS or offline.'}</div>`;
      }
      destroyPlayer();
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url; video.addEventListener('loadedmetadata', () => video.play().catch(() => {}));
  } else {
    playerStage.innerHTML = '<div style="display:flex;height:100%;align-items:center;justify-content:center;color:rgba(255,255,255,0.5)">HLS not supported.</div>';
  }
}

/* ============================================================
 * IPTV — M3U / Xtream
 * ============================================================ */
const SAMPLE_M3U = `#EXTM3U
#EXTINF:-1 tvg-logo="" group-title="Demo",Red Bull TV
https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master_1660.m3u8
#EXTINF:-1 group-title="Demo",NASA TV (public)
https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8
#EXTINF:-1 group-title="Demo",Al Jazeera English
https://live-hls-web-aje.getaj.net/AJE/index.m3u8
#EXTINF:-1 group-title="Demo",France 24 English
https://stream.france24.com/hls/france24_en.m3u8
#EXTINF:-1 group-title="Demo",DW News
https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8`;

function parseM3U(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  let meta = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      const comma = line.lastIndexOf(',');
      const attrs = line.slice(8, comma > 8 ? comma : undefined);
      meta = {
        name: comma > 8 ? line.slice(comma + 1).trim() : 'Untitled',
        group: (/group-title="([^"]*)"/.exec(attrs) || [])[1] || '',
        logo: (/tvg-logo="([^"]*)"/.exec(attrs) || [])[1] || '',
      };
    } else if (!line.startsWith('#')) {
      if (meta && /^https?:\/\//i.test(line)) out.push({ ...meta, url: line });
      meta = null;
    }
  }
  return out;
}

const CORS_PROXIES = [
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  (u) => `https://api.cors.lol/?url=${encodeURIComponent(u)}`,
  (u) => `https://r.jina.ai/${u}`,
];

async function fetchText(url, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try { const r = await fetch(url, { signal: ctrl.signal }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.text(); }
  finally { clearTimeout(t); }
}

async function loadM3UFromUrl(url, onStep) {
  const say = (m) => { try { onStep?.(m); } catch {} };
  const candidates = [url];
  if (/^http:\/\//i.test(url)) { const hv = url.replace(/^http:\/\//i, 'https://'); if (hv !== url) candidates.push(hv); }
  for (const c of candidates) { try { say('Trying direct...'); return await fetchText(c); } catch {} }
  let i = 0;
  const total = CORS_PROXIES.length * candidates.length;
  for (const wrap of CORS_PROXIES) {
    for (const c of candidates) {
      i++;
      try { say(`Fallback ${i}/${total}...`); const text = await fetchText(wrap(c)); if (text && /#EXTM3U/i.test(text)) return text; } catch {}
    }
  }
  throw new Error('All routes failed. Host may be offline.');
}

async function fetchPlaylistChannels(pl, onStep) {
  const text = await loadM3UFromUrl(pl.url, onStep);
  if (!/#EXTM3U/i.test(text)) throw new Error('Not a valid M3U playlist.');
  const chans = parseM3U(text);
  if (!chans.length) throw new Error('No channels found.');
  return chans;
}

function guessName(url) { try { return new URL(url).hostname.replace(/^www\./, '').split('.')[0].toUpperCase().slice(0, 18); } catch { return 'Playlist'; } }
function savePlaylists() { store.set('ts.playlists', playlists.map(p => ({ ...p, channels: (p.channels || []).slice(0, 2000) }))); store.set('ts.openPlaylist', openPlaylistId); }

function renderPlaylists() {
  const grid = $('pl-grid');
  const empty = $('pl-empty');
  if (!playlists.length) { grid.innerHTML = ''; empty.style.display = ''; return; }
  empty.style.display = 'none';
  grid.innerHTML = playlists.map(p => `
    <div class="pl-card ${p.id === openPlaylistId ? 'active' : ''}" data-id="${p.id}">
      <div class="text-lg font-bold">${esc(p.name)}</div>
      <div class="text-xs text-red-400 font-semibold">${p.channels ? `${p.channels.length} channels` : 'Tap to load'}</div>
      <div class="flex gap-2 mt-auto pt-3">
        <button class="flex-1 py-2 text-[11px] font-bold border border-white/10 bg-[#0d0d12] rounded-lg text-white/50 hover:text-red-400 hover:border-red-500" data-act="refresh">↻ Reload</button>
        <button class="flex-1 py-2 text-[11px] font-bold border border-white/10 bg-[#0d0d12] rounded-lg text-white/50 hover:text-red-400 hover:border-red-500" data-act="delete">✕ Remove</button>
      </div>
    </div>`).join('');
  grid.querySelectorAll('.pl-card').forEach(card => {
    card.addEventListener('click', e => {
      const act = e.target.dataset?.act;
      if (act === 'delete') { e.stopPropagation(); deletePlaylist(card.dataset.id); return; }
      if (act === 'refresh') { e.stopPropagation(); refreshPlaylist(card.dataset.id); return; }
      openPlaylist(card.dataset.id);
    });
  });
}

function openPlaylist(id) {
  const pl = playlists.find(p => p.id === id);
  if (!pl) return;
  openPlaylistId = id;
  savePlaylists();
  renderPlaylists();
  $('ch-section').classList.remove('hidden');
  $('ch-title').innerHTML = `Channels — <span class="bg-gradient-to-r from-red-400 to-orange-300 bg-clip-text text-transparent">${esc(pl.name)}</span>`;
  if (pl.channels) { renderChannels(''); return; }
  $('ch-grid').innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:rgba(255,255,255,0.3)"><div class="spinner"></div>Loading...</div>';
  fetchPlaylistChannels(pl, m => { $('ch-grid').innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:rgba(255,255,255,0.3)">${esc(m)}</div>`; })
    .then(ch => { pl.channels = ch; savePlaylists(); renderPlaylists(); renderChannels(''); })
    .catch(e => { $('ch-grid').innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:rgba(255,255,255,0.5)">Failed: ${esc(e.message)}</div>`; });
}

async function refreshPlaylist(id) {
  const pl = playlists.find(p => p.id === id);
  if (!pl) return;
  try { pl.channels = await fetchPlaylistChannels(pl); savePlaylists(); renderPlaylists(); if (id === openPlaylistId) renderChannels($('ch-filter')?.value); }
  catch (e) { alert(`Reload failed: ${e.message}`); }
}

function deletePlaylist(id) {
  playlists = playlists.filter(p => p.id !== id);
  if (openPlaylistId === id) { openPlaylistId = null; $('ch-section').classList.add('hidden'); }
  savePlaylists(); renderPlaylists();
}

function renderChannels(filter) {
  const pl = playlists.find(p => p.id === openPlaylistId);
  const grid = $('ch-grid');
  const empty = $('ch-empty');
  if (!pl?.channels) { grid.innerHTML = ''; return; }
  const q = String(filter || '').toLowerCase();
  const list = pl.channels.filter(c => !q || c.name.toLowerCase().includes(q) || (c.group || '').toLowerCase().includes(q));
  if (!list.length) { grid.innerHTML = ''; empty.style.display = ''; empty.textContent = q ? 'No channels match.' : 'No channels.'; return; }
  empty.style.display = 'none';
  grid.innerHTML = list.slice(0, 500).map((c, i) => `
    <div class="ch-tile" data-idx="${i}">
      <div class="ch-tile-logo">${c.logo ? `<span style="font-size:1.5rem;font-weight:800;color:#ef4444">${esc((c.name||'?').charAt(0))}</span><img loading="lazy" src="${esc(c.logo)}" alt="" onerror="this.remove()">` : `<span style="font-size:1.5rem;font-weight:800;color:#ef4444">${esc((c.name||'?').charAt(0).toUpperCase())}</span>`}</div>
      <div class="ch-tile-name">${esc(c.name)}</div>
    </div>`).join('');
  grid.querySelectorAll('.ch-tile').forEach(el => {
    el.addEventListener('click', () => openChannelModal(list[Number(el.dataset.idx)]));
  });
}

function openChannelModal(c) {
  pendingChannel = c;
  $('ch-modal-name').textContent = c.name;
  $('ch-modal-group').textContent = c.group || '';
  $('ch-modal-logo').innerHTML = c.logo ? `<img src="${esc(c.logo)}" alt="" style="max-width:180px;max-height:100px;object-fit:contain;background:#0d0d12;border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:8px;margin:0 auto 12px;display:block" onerror="this.style.display='none'">` : '';
  $('ch-modal').classList.add('open');
}

function playPendingChannel() {
  if (!pendingChannel) return;
  const c = pendingChannel;
  $('ch-modal').classList.remove('open');
  currentStream = { type: 'iptv', url: c.url };
  openPlayer(c.name);
  qualitySelect.innerHTML = '<option value="hls">Direct HLS</option>';
  playHls(c.url);
  addRecent(c);
}

$('ch-modal-play').addEventListener('click', playPendingChannel);
$('ch-modal-close').addEventListener('click', () => $('ch-modal').classList.remove('open'));
$('ch-modal').addEventListener('click', e => { if (e.target === $('ch-modal')) $('ch-modal').classList.remove('open'); });

$('iptv-add-btn').addEventListener('click', handleAddPlaylist);
$('iptv-xtream-btn').addEventListener('click', () => $('xtream-extra')?.classList.toggle('hidden'));
$('ch-filter')?.addEventListener('input', debounce(() => renderChannels($('ch-filter').value), 200));

function handleAddPlaylist() {
  let url = $('iptv-url').value.trim();
  const user = $('xt2-user')?.value.trim();
  const pass = $('xt2-pass')?.value.trim();
  let name = $('iptv-name').value.trim();
  if (!url) { alert('Paste an M3U link or Xtream host first.'); return; }
  if (user && pass && !/\.m3u8?($|\?)/i.test(url)) {
    url = `${url.replace(/\/$/, '')}/get.php?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}&type=m3u_plus&output=mpegts`;
  }
  if (!name) name = guessName($('iptv-url').value.trim());
  const pl = { id: `pl-${Date.now()}`, name, url, channels: null };
  playlists.push(pl);
  $('iptv-name').value = ''; $('iptv-url').value = '';
  savePlaylists();
  showSection('iptv');
  openPlaylist(pl.id);
}

function loadSample() {
  const pl = { id: `pl-${Date.now()}`, name: 'Sample Channels', url: 'built-in', channels: parseM3U(SAMPLE_M3U) };
  playlists.push(pl);
  savePlaylists();
  showSection('iptv');
  openPlaylist(pl.id);
}

/* Home connect */
$('connect-btn').addEventListener('click', () => {
  const isXtream = document.querySelector('.tab-btn')?.classList.contains('border-red-500/50');
  if (isXtream) {
    const server = $('xt-server').value.trim();
    const user = $('xt-user').value.trim();
    const pass = $('xt-pass').value.trim();
    if (!server) { alert('Enter a server URL.'); return; }
    let url = server;
    if (user && pass && !/\.m3u8?($|\?)/i.test(server)) {
      url = `${server.replace(/\/$/, '')}/get.php?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}&type=m3u_plus&output=mpegts`;
    }
    const pl = { id: `pl-${Date.now()}`, name: guessName(server), url, channels: null };
    playlists.push(pl); savePlaylists(); showSection('iptv'); openPlaylist(pl.id);
  } else {
    const url = $('m3u-url').value.trim();
    const name = $('m3u-name').value.trim() || guessName(url);
    if (!url) { alert('Paste an M3U link.'); return; }
    const pl = { id: `pl-${Date.now()}`, name, url, channels: null };
    playlists.push(pl); savePlaylists(); showSection('iptv'); openPlaylist(pl.id);
  }
});

/* Recently Watched */
function addRecent(channel) {
  let recent = store.get('ts.recent', []);
  recent = recent.filter(r => r.url !== channel.url);
  recent.unshift(channel);
  store.set('ts.recent', recent.slice(0, 20));
  renderRecent();
}
function renderRecent() {
  const recent = store.get('ts.recent', []);
  const grid = $('recent-channels');
  const empty = $('recent-empty');
  if (!recent.length || !grid) { if (grid) grid.innerHTML = ''; if (empty) empty.style.display = ''; return; }
  if (empty) empty.style.display = 'none';
  grid.innerHTML = recent.slice(0, 8).map((c, i) => `
    <div class="ch-tile" data-idx="${i}">
      <div class="ch-tile-logo">${c.logo ? `<span style="font-size:1.5rem;font-weight:800;color:#ef4444">${esc((c.name||'?').charAt(0))}</span><img loading="lazy" src="${esc(c.logo)}" alt="" onerror="this.remove()">` : `<span style="font-size:1.5rem;font-weight:800;color:#ef4444">${esc((c.name||'?').charAt(0).toUpperCase())}</span>`}</div>
      <div class="ch-tile-name">${esc(c.name)}</div>
    </div>`).join('');
  grid.querySelectorAll('.ch-tile').forEach(el => {
    el.addEventListener('click', () => {
      const c = recent[Number(el.dataset.idx)];
      currentStream = { type: 'iptv', url: c.url };
      openPlayer(c.name);
      qualitySelect.innerHTML = '<option value="hls">Direct HLS</option>';
      playHls(c.url);
    });
  });
}

/* ============================================================
 * YOUTUBE — privacy embed
 * ============================================================ */
const PIPED = ['https://pipedapi.kavin.rocks', 'https://pipedapi.adminforge.de', 'https://api.piped.private.coffee'];
const YT_SHORTS = [
  { id: 'aqz-KE-bpKQ', title: 'Big Buck Bunny (4K)', author: 'Blender Foundation' },
  { id: 'eRsGyueVLvQ', title: 'Sintel (4K)', author: 'Blender Foundation' },
  { id: 'jNQXAC9IVRw', title: 'Me at the zoo', author: 'jawed' },
];

function extractYTId(s) {
  s = String(s || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  const m = s.match(/(?:youtube\.com\/(?:watch\?[^#]*v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function openYTPlayer(id, title) {
  if (!id) return;
  currentStream = { type: 'youtube', videoId: id, title };
  openPlayer(title || 'YouTube');
  qualitySelect.innerHTML = '<option value="nocookie">YouTube embed</option><option value="inv">Invidious</option>';
  const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&controls=1&rel=0&playsinline=1`;
  playerStage.innerHTML = `<iframe src="${src}" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" allowfullscreen></iframe>`;
  qualitySelect.onchange = () => {
    const url = qualitySelect.value === 'inv' ? `https://yewtu.be/embed/${encodeURIComponent(id)}?autoplay=1` : src;
    playerStage.innerHTML = `<iframe src="${url}" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" allowfullscreen></iframe>`;
  };
}

function renderYTList(videos) {
  const grid = $('yt-grid');
  const empty = $('yt-empty');
  if (!videos.length) { grid.innerHTML = ''; empty.style.display = ''; return; }
  empty.style.display = 'none';
  grid.innerHTML = videos.map(v => `
    <div class="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden cursor-pointer hover:border-red-500 transition" data-id="${esc(v.id)}" data-title="${esc(v.title)}">
      <div class="aspect-video bg-[#0d0d12] relative"><img loading="lazy" src="https://i.ytimg.com/vi/${esc(v.id)}/hqdefault.jpg" alt="" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display='none'"></div>
      <div class="p-4"><div class="font-bold text-sm truncate">${esc(v.title)}</div><div class="text-xs text-white/40 mt-1">${esc(v.author || 'YouTube')}</div></div>
    </div>`).join('');
  grid.querySelectorAll('[data-id]').forEach(card => {
    card.addEventListener('click', () => openYTPlayer(card.dataset.id, card.dataset.title));
  });
}

async function ytSearch(q) {
  for (const base of PIPED) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 9000);
      const r = await fetch(`${base}/search?q=${encodeURIComponent(q)}&filter=videos`, { signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) continue;
      const j = await r.json();
      const items = (j.items || []).filter(x => x?.url?.includes('/watch?v='));
      if (items.length) return items.slice(0, 20).map(x => ({ id: String(x.url.split('v=')[1] || '').split('&')[0], title: x.title || 'Untitled', author: x.uploaderName || '' })).filter(x => x.id);
    } catch {}
  }
  throw new Error('Search failed');
}

$('yt-go').addEventListener('click', async () => {
  const q = $('yt-search').value.trim();
  if (!q) { renderYTList(YT_SHORTS); return; }
  const id = extractYTId(q);
  if (id) return openYTPlayer(id, 'YouTube video');
  $('yt-grid').innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:rgba(255,255,255,0.3)"><div class="spinner"></div>Searching...</div>';
  try { renderYTList(await ytSearch(q)); }
  catch { $('yt-grid').innerHTML = ''; $('yt-empty').style.display = ''; }
});
$('yt-search')?.addEventListener('keydown', e => { if (e.key === 'Enter') $('yt-go').click(); });
renderYTList(YT_SHORTS);

/* ---------- Settings ---------- */
function openSettings() {
  $('set-canvas').checked = store.get('ts.forceCanvas', false);
  $('tesla-status').textContent = isTesla() ? 'Tesla browser detected ✓' : 'Standard browser';
  $('settings-modal').classList.add('open');
}
$('settings-save').addEventListener('click', () => { store.set('ts.forceCanvas', $('set-canvas').checked); $('settings-modal').classList.remove('open'); location.reload(); });
$('settings-close').addEventListener('click', () => $('settings-modal').classList.remove('open'));
$('settings-modal').addEventListener('click', e => { if (e.target === $('settings-modal')) $('settings-modal').classList.remove('open'); });

/* ---------- Init ---------- */
renderPlaylists();
renderRecent();