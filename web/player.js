const $ = (id) => document.getElementById(id);
const video = $("video");
const stage = $("stage");
const viz = $("viz");
const vctx = viz.getContext("2d");

const state = {
  items: [],
  index: -1,
  loop: "off",
  shuffle: false,
  objectUrl: null,
  audioCtx: null,
  analyser: null,
  sourceNode: null,
  raf: 0,
  showInfo: false,
};

function fmt(t) {
  if (!isFinite(t) || t < 0) return "00:00";
  const s = Math.floor(t % 60).toString().padStart(2, "0");
  const m = Math.floor((t / 60) % 60).toString().padStart(2, "0");
  const h = Math.floor(t / 3600);
  return h ? `${h}:${m}:${s}` : `${m}:${s}`;
}

function persist() {
  localStorage.setItem("pulse-vol", String(video.volume));
  localStorage.setItem("pulse-speed", String(video.playbackRate));
  localStorage.setItem("pulse-loop", state.loop);
}

function restore() {
  const vol = parseFloat(localStorage.getItem("pulse-vol"));
  const speed = parseFloat(localStorage.getItem("pulse-speed"));
  const loop = localStorage.getItem("pulse-loop");
  if (!Number.isNaN(vol)) {
    video.volume = vol;
    $("vol").value = vol;
  }
  if (!Number.isNaN(speed)) {
    video.playbackRate = speed;
    $("speed").value = String(speed);
  }
  if (loop === "off" || loop === "one" || loop === "all") state.loop = loop;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&",
    "<": "<",
    ">": ">",
    '"': """,
    "'": "&#39;",
  }[c]));
}

function renderList() {
  $("plist").innerHTML = state.items.map((it, i) =>
    `<li data-i="${i}" class="${i === state.index ? "active" : ""}">
       <span class="idx">${i + 1}</span>
       <span class="name">${escapeHtml(it.name)}</span>
     </li>`
  ).join("");
}

function status() {
  $("st-state").textContent = video.paused ? (video.currentTime ? "Paused" : "Stopped") : "Playing";
  $("st-loop").textContent = "Loop: " + state.loop + (state.shuffle ? " · shuffle" : "");
  $("st-rate").textContent = video.playbackRate.toFixed(2) + "×";
  $("loopbtn").textContent = state.loop === "one" ? "🔂" : "🔁";
  $("playbtn").textContent = video.paused ? "▶" : "⏸";
  $("mutebtn").textContent = video.muted || video.volume === 0 ? "🔇" : "🔊";
}

function updateInfo() {
  const it = state.items[state.index];
  if (!it) {
    $("info").textContent = "No media";
    return;
  }
  const w = video.videoWidth;
  const h = video.videoHeight;
  $("info").innerHTML = [
    `<div><strong>${escapeHtml(it.name)}</strong></div>`,
    it.url ? `<div>URL: ${escapeHtml(it.url)}</div>` : "<div>Local file</div>",
    w && h ? `<div>Video: ${w}×${h}</div>` : "<div>Audio / no video track</div>",
    `<div>Duration: ${fmt(video.duration)}</div>`,
    `<div>Rate: ${video.playbackRate.toFixed(2)}× · Vol: ${Math.round(video.volume * 100)}%</div>`,
  ].join("");
}

function ensureAudioGraph() {
  if (state.sourceNode) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    const src = ctx.createMediaElementSource(video);
    src.connect(analyser);
    analyser.connect(ctx.destination);
    state.audioCtx = ctx;
    state.analyser = analyser;
    state.sourceNode = src;
  } catch (_) {}
}

function drawViz() {
  const hasVideo = video.videoWidth > 0;
  viz.style.display = hasVideo ? "none" : "block";
  video.style.display = hasVideo ? "block" : "none";
  if (hasVideo || !state.analyser) {
    state.raf = requestAnimationFrame(drawViz);
    return;
  }
  const { width, height } = viz;
  const data = new Uint8Array(state.analyser.frequencyBinCount);
  state.analyser.getByteFrequencyData(data);
  vctx.fillStyle = "#000";
  vctx.fillRect(0, 0, width, height);
  const bw = width / data.length;
  for (let i = 0; i < data.length; i++) {
    const bh = (data[i] / 255) * height * 0.85;
    vctx.fillStyle = `hsl(${28 + i * 0.4}, 100%, 50%)`;
    vctx.fillRect(i * bw, height - bh, bw - 1, bh);
  }
  state.raf = requestAnimationFrame(drawViz);
}

function loadIndex(i, autoplay = true) {
  if (i < 0 || i >= state.items.length) return;
  state.index = i;
  const it = state.items[i];
  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = null;
  }
  if (it.file) {
    state.objectUrl = URL.createObjectURL(it.file);
    video.src = state.objectUrl;
  } else {
    video.src = it.url;
  }
  video.loop = state.loop === "one";
  $("now").textContent = it.name;
  stage.classList.add("playing");
  renderList();
  updateInfo();
  status();
  if (autoplay) {
    video.play().then(() => {
      ensureAudioGraph();
      state.audioCtx && state.audioCtx.resume();
    }).catch(() => {});
  }
}

function addFiles(fileList) {
  const files = [...fileList].filter((f) =>
    /audio|video/i.test(f.type) ||
    /\.(mp4|webm|mkv|avi|mov|mp3|wav|ogg|flac|m4a)$/i.test(f.name)
  );
  if (!files.length) return;
  const start = state.items.length;
  files.forEach((f) => state.items.push({ name: f.name, file: f }));
  renderList();
  if (state.index < 0) loadIndex(start);
}

function addUrl(url) {
  url = url.trim();
  if (!url) return;
  state.items.push({ name: url.split("/").pop() || url, url });
  renderList();
  loadIndex(state.items.length - 1);
}

function next(force) {
  if (!state.items.length) return;
  if (state.loop === "one" && !force) {
    video.currentTime = 0;
    video.play();
    return;
  }
  let n;
  if (state.shuffle) {
    if (state.items.length === 1) n = 0;
    else {
      do { n = Math.floor(Math.random() * state.items.length); }
      while (n === state.index);
    }
  } else {
    n = state.index + 1;
    if (n >= state.items.length) {
      if (state.loop === "all") n = 0;
      else return;
    }
  }
  loadIndex(n);
}

function prev() {
  if (!state.items.length) return;
  if (video.currentTime > 3) {
    video.currentTime = 0;
    return;
  }
  let n = state.index - 1;
  if (n < 0) n = state.loop === "all" ? state.items.length - 1 : 0;
  loadIndex(n);
}

function stop() {
  video.pause();
  video.currentTime = 0;
  status();
}

function cycleLoop() {
  state.loop = state.loop === "off" ? "one" : state.loop === "one" ? "all" : "off";
  video.loop = state.loop === "one";
  persist();
  status();
}

function snapshot() {
  if (!video.videoWidth) return alert("No video frame to capture.");
  const c = document.createElement("canvas");
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  c.getContext("2d").drawImage(video, 0, 0);
  const a = document.createElement("a");
  a.href = c.toDataURL("image/png");
  a.download = "pulse-snapshot.png";
  a.click();
}

function act(name) {
  switch (name) {
    case "open": $("filepick").click(); break;
    case "url": {
      const u = prompt("Network stream or direct media URL:");
      if (u) addUrl(u);
      break;
    }
    case "clear":
      state.items = [];
      state.index = -1;
      stop();
      video.removeAttribute("src");
      video.load();
      stage.classList.remove("playing");
      $("now").textContent = "No media";
      renderList();
      break;
    case "quit":
      if (document.fullscreenElement) document.exitFullscreen();
      stop();
      break;
    case "toggle":
      if (!video.src) { $("filepick").click(); break; }
      if (video.paused) video.play(); else video.pause();
      break;
    case "stop": stop(); break;
    case "prev": prev(); break;
    case "next": next(true); break;
    case "loop": cycleLoop(); break;
    case "shuffle": state.shuffle = !state.shuffle; status(); break;
    case "slower":
      video.playbackRate = Math.max(0.25, Math.round((video.playbackRate - 0.25) * 100) / 100);
      $("speed").value = String(video.playbackRate);
      persist(); status();
      break;
    case "faster":
      video.playbackRate = Math.min(3, Math.round((video.playbackRate + 0.25) * 100) / 100);
      $("speed").value = String(video.playbackRate);
      persist(); status();
      break;
    case "speed1":
      video.playbackRate = 1;
      $("speed").value = "1";
      persist(); status();
      break;
    case "fs":
      if (!document.fullscreenElement) document.documentElement.requestFullscreen();
      else document.exitFullscreen();
      break;
    case "pip":
      if (document.pictureInPictureElement) document.exitPictureInPicture();
      else video.requestPictureInPicture?.();
      break;
    case "snap": snapshot(); break;
    case "info":
      state.showInfo = !state.showInfo;
      $("info").classList.toggle("show", state.showInfo);
      updateInfo();
      break;
    case "mute": video.muted = !video.muted; status(); break;
    case "keys":
      alert("Space play/pause · S stop · F fullscreen · M mute\n←/→ seek · ↑/↓ volume · N/P next/prev\nL loop · [ ] speed · I info");
      break;
    case "about":
      alert("Pulse is an original VLC-inspired player.\nIt is not affiliated with VideoLAN.\nVLC itself is open source: https://github.com/videolan/vlc");
      break;
  }
}

document.querySelectorAll("[data-act]").forEach((el) => {
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    act(el.dataset.act);
    document.querySelectorAll(".menu").forEach((m) => m.classList.remove("open"));
  });
});
document.querySelectorAll(".menu > button").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const menu = btn.parentElement;
    const open = menu.classList.contains("open");
    document.querySelectorAll(".menu").forEach((m) => m.classList.remove("open"));
    if (!open) menu.classList.add("open");
  });
});
document.addEventListener("click", () => {
  document.querySelectorAll(".menu").forEach((m) => m.classList.remove("open"));
});

$("filepick").addEventListener("change", (e) => addFiles(e.target.files));
$("plist").addEventListener("click", (e) => {
  const li = e.target.closest("li");
  if (li) loadIndex(Number(li.dataset.i));
});
$("hide-pl").addEventListener("click", () => {
  document.querySelector(".playlist").style.display = "none";
});

$("seek").addEventListener("input", () => {
  if (isFinite(video.duration)) video.currentTime = (Number($("seek").value) / 1000) * video.duration;
});
$("vol").addEventListener("input", () => {
  video.volume = Number($("vol").value);
  video.muted = video.volume === 0;
  persist();
  status();
});
$("speed").addEventListener("change", () => {
  video.playbackRate = Number($("speed").value);
  persist();
  status();
});

video.addEventListener("timeupdate", () => {
  $("tcur").textContent = fmt(video.currentTime);
  $("tdur").textContent = fmt(video.duration);
  if (isFinite(video.duration) && video.duration > 0) {
    $("seek").value = String(Math.round((video.currentTime / video.duration) * 1000));
  }
});
video.addEventListener("play", status);
video.addEventListener("pause", status);
video.addEventListener("ended", () => next(false));
video.addEventListener("loadedmetadata", () => {
  updateInfo();
  $("st-extra").textContent = video.videoWidth
    ? `${video.videoWidth}×${video.videoHeight}`
    : "Audio";
  viz.width = stage.clientWidth;
  viz.height = stage.clientHeight;
});
video.addEventListener("error", () => {
  $("st-extra").textContent = "Cannot decode this file in the browser. Try the Python player for more formats.";
});

stage.addEventListener("dragover", (e) => { e.preventDefault(); stage.classList.add("dragover"); });
stage.addEventListener("dragleave", () => stage.classList.remove("dragover"));
stage.addEventListener("drop", (e) => {
  e.preventDefault();
  stage.classList.remove("dragover");
  addFiles(e.dataTransfer.files);
});
stage.addEventListener("dblclick", () => act("fs"));
stage.addEventListener("click", (e) => {
  if (e.target === video || e.target === viz || e.target === stage) act("toggle");
});

document.addEventListener("fullscreenchange", () => {
  document.body.classList.toggle("fs", Boolean(document.fullscreenElement));
});

window.addEventListener("keydown", (e) => {
  if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
  const k = e.key;
  if (k === " ") { e.preventDefault(); act("toggle"); }
  else if (k === "s" || k === "S") act("stop");
  else if (k === "f" || k === "F") act("fs");
  else if (k === "m" || k === "M") act("mute");
  else if (k === "n" || k === "N") act("next");
  else if (k === "p" || k === "P") act("prev");
  else if (k === "l" || k === "L") act("loop");
  else if (k === "i" || k === "I") act("info");
  else if (k === "[") act("slower");
  else if (k === "]") act("faster");
  else if (k === "=") act("speed1");
  else if (k === "ArrowLeft") video.currentTime = Math.max(0, video.currentTime - (e.shiftKey ? 10 : 5));
  else if (k === "ArrowRight") video.currentTime += (e.shiftKey ? 10 : 5);
  else if (k === "ArrowUp") {
    e.preventDefault();
    video.volume = Math.min(1, video.volume + 0.05);
    $("vol").value = video.volume;
    persist(); status();
  } else if (k === "ArrowDown") {
    e.preventDefault();
    video.volume = Math.max(0, video.volume - 0.05);
    $("vol").value = video.volume;
    persist(); status();
  } else if (e.ctrlKey && (k === "o" || k === "O")) { e.preventDefault(); act("open"); }
  else if (e.ctrlKey && (k === "n" || k === "N")) { e.preventDefault(); act("url"); }
});

restore();
status();
drawViz();
window.addEventListener("resize", () => {
  viz.width = stage.clientWidth;
  viz.height = stage.clientHeight;
});
