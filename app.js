// ---- Edit these lists to add or remove tiles ----
const APPS = [
  ["▶️","YouTube","#youtube"],
  ["🟣","Twitch","#twitch"],
  ["🎬","Netflix","https://www.netflix.com"],
  ["📺","Disney+","https://www.disneyplus.com"],
  ["🎞️","Prime Video","https://www.primevideo.com"],
  ["🍿","Max","https://www.max.com"],
  ["📡","Hulu","https://www.hulu.com"],
  ["🎵","Spotify","https://open.spotify.com"],
  ["🎧","SoundCloud","https://soundcloud.com"],
  ["🌐","Kick","https://kick.com"],
  ["📰","Pluto TV","https://pluto.tv"],
  ["🆓","Tubi","https://tubitv.com"]
];
const GAMES = [
  ["🟢","GeForce NOW","https://play.geforcenow.com"],
  ["🎮","Xbox Cloud","https://www.xbox.com/play"],
  ["🕹️","Poki","https://poki.com"],
  ["🎯","CrazyGames","https://www.crazygames.com"],
  ["🧩","Y8 Games","https://www.y8.com"],
  ["♟️","Chess.com","https://www.chess.com/play"],
  ["🔤","Wordle","https://www.nytimes.com/games/wordle"],
  ["🚗","Miniclip","https://www.miniclip.com"]
];

const $ = s => document.querySelector(s);
const tile = ([i,n,u]) => u[0]=="#"
  ? `<a class="tile" href="${u}" data-go="${u.slice(1)}"><i>${i}</i>${n}</a>`
  : `<a class="tile" href="${u}" target="_blank" rel="noopener"><i>${i}</i>${n}</a>`;
$("#appGrid").innerHTML = APPS.map(tile).join("");
$("#gameGrid").innerHTML = GAMES.map(tile).join("");

// Tabs
function showTab(t){
  document.querySelectorAll("#tabs button,.tab").forEach(e => e.classList.remove("on"));
  document.querySelector(`#tabs [data-t=${t}]`).classList.add("on"); $("#" + t).classList.add("on");
}
document.querySelectorAll("#tabs button").forEach(b => b.onclick = () => showTab(b.dataset.t));
document.addEventListener("click", e => { const a = e.target.closest("[data-go]"); if (a) { e.preventDefault(); showTab(a.dataset.go); } });

// Full-screen in-app player (used by YouTube, Twitch and Live TV)
let hls;
function openPlayer(title, kind, src){
  $("#ovtitle").textContent = title; $("#ov").hidden = false;
  const body = $("#ovbody"); body.innerHTML = "";
  if (kind == "embed") {
    body.innerHTML = `<iframe allow="autoplay; fullscreen; encrypted-media" allowfullscreen src="${src}"></iframe>`;
  } else {
    const v = document.createElement("video"); v.controls = true; v.autoplay = true; v.playsInline = true; body.appendChild(v);
    if (window.Hls && Hls.isSupported()) { hls = new Hls(); hls.loadSource(src); hls.attachMedia(v); hls.on(Hls.Events.MANIFEST_PARSED, () => v.play()); }
    else { v.src = src; v.play(); }
  }
}
function closePlayer(){ if (hls) { hls.destroy(); hls = null; } $("#ovbody").innerHTML = ""; $("#ov").hidden = true; }
$("#back").onclick = closePlayer;
document.addEventListener("keydown", e => { if (e.key == "Escape") closePlayer(); });

// Twitch
$("#twgo").onclick = () => {
  const c = $("#tw").value.trim().replace(/^.*twitch\.tv\//, "");
  if (c) openPlayer(c + " on Twitch", "embed", `https://player.twitch.tv/?channel=${encodeURIComponent(c)}&parent=${location.hostname}&autoplay=true`);
};

// YouTube browse (needs a free YouTube Data API key; stored only in your browser)
const CATS = [["Trending",""],["Music",10],["Gaming",20],["News",25],["Sports",17],["Movies",1],["Live","live"],["Shorts","shorts"]];
$("#chips").innerHTML = CATS.map((c,i) => `<button data-c="${i}">${c[0]}</button>`).join("");
const ytPlay = (id,t) => openPlayer(t, "embed", `https://www.youtube.com/embed/${id}?autoplay=1&rel=0`);
function key(){ let k = localStorage.getItem("ytkey"); if (!k) { k = prompt("Paste your YouTube Data API v3 key (see README):") || ""; if (k) localStorage.setItem("ytkey", k); } return k; }
$("#ykey").onclick = () => { localStorage.removeItem("ytkey"); key(); };
async function yt(path, params){
  const k = key(); if (!k) { $("#ystatus").textContent = "Add an API key to browse. You can still paste a link."; return; }
  $("#ystatus").textContent = "Loading...";
  try {
    const r = await (await fetch(`https://www.googleapis.com/youtube/v3/${path}?part=snippet&maxResults=24&key=${k}&` + new URLSearchParams(params))).json();
    if (r.error) throw new Error(r.error.message);
    $("#ystatus").textContent = "";
    $("#vids").innerHTML = r.items.map(v => { const id = v.id.videoId || v.id, s = v.snippet;
      return `<button class="vid" data-id="${id}" data-t="${s.title.replace(/"/g,"&quot;")}"><img src="${s.thumbnails.medium.url}" alt=""><b>${s.title}</b><small>${s.channelTitle}</small></button>`; }).join("");
  } catch (e) { $("#ystatus").textContent = "Error: " + e.message; }
}
function loadCat(i){
  const c = CATS[i][1];
  if (c === "") yt("videos", {chart:"mostPopular", regionCode:"US"});
  else if (typeof c == "number") yt("videos", {chart:"mostPopular", regionCode:"US", videoCategoryId:c});
  else if (c == "live") yt("search", {type:"video", eventType:"live", q:"live"});
  else yt("search", {type:"video", videoDuration:"short", q:"#shorts"});
}
$("#chips").onclick = e => { const b = e.target.closest("button"); if (b) loadCat(b.dataset.c); };
$("#vids").onclick = e => { const b = e.target.closest(".vid"); if (b) ytPlay(b.dataset.id, b.dataset.t); };
$("#ysearch").onclick = () => {
  const q = $("#yq").value.trim(), m = q.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/);
  if (m) ytPlay(m[1], "YouTube"); else if (q) yt("search", {type:"video", q});
};
$("#yq").onkeydown = e => { if (e.key == "Enter") $("#ysearch").click(); };
if (localStorage.getItem("ytkey")) loadCat(0); else $("#ystatus").textContent = "Add an API key (Key button) to browse trending, categories and Shorts, or paste a link above.";

// IPTV
let all = [];
async function loadList() {
  const url = $("#custom").value.trim() || $("#list").value;
  $("#status").textContent = "Loading channels...";
  try {
    const txt = await (await fetch(url)).text();
    all = parseM3U(txt);
    $("#status").textContent = `${all.length} channels. Some streams may be offline.`;
    render();
  } catch (e) { $("#status").textContent = "Couldn't load that playlist (blocked or invalid)."; }
}
function parseM3U(t) {
  const out = [], L = t.split("\n");
  for (let i = 0; i < L.length; i++) {
    if (L[i].startsWith("#EXTINF")) {
      const name = L[i].split(",").pop().trim();
      const u = (L[i + 1] || "").trim();
      if (u.startsWith("http")) out.push({ name, u });
    }
  }
  return out;
}
function render() {
  const q = $("#search").value.toLowerCase();
  const list = all.filter(c => c.name.toLowerCase().includes(q)).slice(0, 300);
  $("#channels").innerHTML = list.map((c, i) => `<button class="ch" data-i="${all.indexOf(c)}">${c.name}</button>`).join("");
}
$("#channels").onclick = e => {
  const b = e.target.closest(".ch"); if (!b) return;
  const c = all[b.dataset.i]; openPlayer(c.name, "hls", c.u);
};
$("#load").onclick = loadList;
$("#list").onchange = () => { $("#custom").value = ""; loadList(); };
$("#search").oninput = render;
loadList();

// ---- Home greeting + clock ----
(function tick(){
  const d = new Date(), h = d.getHours();
  $("#clock").textContent = d.toLocaleTimeString([], {hour:"numeric", minute:"2-digit"});
  $("#date").textContent = d.toLocaleDateString([], {weekday:"long", month:"long", day:"numeric"});
  $("#greet").textContent = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  setTimeout(tick, 15000);
})();
