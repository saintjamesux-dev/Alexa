"use strict";

// ---------- Small helpers ----------
const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

const prefs = {
  handsFree: store.get("handsFree", false),
  speakText: store.get("speakText", false),
  voiceURI: store.get("voiceURI", ""),
  pitch: store.get("pitch", 0.85),
  rate: store.get("rate", 1.0),
};
const savePref = (k, v) => { prefs[k] = v; store.set(k, v); };

let code = store.get("code", "");
let cfg = { name: "Assistant", premium_voice: false };
let state = "idle";
let mode = "voice";
let pendingImages = [];

function setState(s, caption) {
  state = s;
  document.body.dataset.state = s;
  const labels = { idle: "Online", listening: "Listening", thinking: "Thinking", speaking: "Speaking" };
  $("status").textContent = labels[s] || s;
  if (caption !== undefined) $("caption").textContent = caption;
}

function setMode(m) {
  mode = m;
  document.body.dataset.mode = m;
  if (m === "text") { stopListening(); setTimeout(() => $("textInput").focus(), 50); }
  scrollLog();
}

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { "Content-Type": "application/json", "X-Access-Code": code, ...(opts.headers || {}) } });
  if (res.status === 401) { lock("Wrong access code."); throw new Error("locked"); }
  return res;
}

// ---------- Conversation log ----------
function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function renderMarkdown(s) {
  return escapeHtml(s)
    .replace(/```([\s\S]*?)```/g, "<code>$1</code>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/^#{1,6}\s*(.+)$/gm, "<strong>$1</strong>");
}
function addMsg(role, text = "", images = []) {
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  for (const src of images) { const img = document.createElement("img"); img.src = src; el.appendChild(img); }
  const body = document.createElement("span");
  el.appendChild(body);
  el.setText = (t) => { body.innerHTML = role === "assistant" ? renderMarkdown(t) : escapeHtml(t); scrollLog(); };
  el.setText(text);
  $("log").appendChild(el);
  scrollLog();
  return el;
}
function scrollLog() { const log = $("log"); log.scrollTop = log.scrollHeight; }

// ---------- Speaking ----------
const player = $("player");
let voices = [];
const speakQueue = [];
let speaking = false;
let speechGen = 0; // bumps on interrupt so stale audio never plays

function loadVoices() {
  voices = (window.speechSynthesis?.getVoices() || []).filter((v) => v.lang.toLowerCase().startsWith("en"));
  const sel = $("voiceSelect");
  sel.innerHTML = voices.length ? "" : "<option>System default</option>";
  for (const v of voices) {
    const o = document.createElement("option");
    o.value = v.voiceURI; o.textContent = `${v.name} (${v.lang})`;
    sel.appendChild(o);
  }
  if (!prefs.voiceURI || !voices.find((v) => v.voiceURI === prefs.voiceURI)) {
    // Prefer a deep British or American male voice — closest to JARVIS on most devices.
    const wanted = [/daniel/i, /arthur/i, /google uk english male/i, /\bgeorge\b/i, /\boliver\b/i, /\bryan\b/i, /\bguy\b/i, /\baaron\b/i, /\bfred\b/i, /\balex\b/i, /\bmale\b/i];
    const pick = wanted.map((re) => voices.find((v) => re.test(v.name))).find(Boolean) || voices[0];
    if (pick) prefs.voiceURI = pick.voiceURI;
  }
  sel.value = prefs.voiceURI;
}
if ("speechSynthesis" in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}

function speakable(s) {
  return s
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_#`>~|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function browserSay(text, gen) {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window) || gen !== speechGen) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    const v = voices.find((x) => x.voiceURI === prefs.voiceURI);
    if (v) { u.voice = v; u.lang = v.lang; }
    u.pitch = prefs.pitch; u.rate = prefs.rate;
    u.onend = u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

function playUrl(url, gen) {
  return new Promise((resolve) => {
    if (gen !== speechGen) return resolve();
    player.src = url;
    player.onended = player.onerror = () => { URL.revokeObjectURL(url); resolve(); };
    player.play().catch(() => resolve());
  });
}

function fetchPremium(text) {
  if (!cfg.premium_voice) return Promise.resolve(null);
  return api("/api/speak", { method: "POST", body: JSON.stringify({ text }) })
    .then((r) => (r.status === 200 ? r.blob() : null))
    .then((b) => (b ? URL.createObjectURL(b) : null))
    .catch(() => null);
}

function say(sentence) {
  const text = speakable(sentence);
  if (!text) return;
  // Fetch premium audio right away so the next sentence is ready when this one ends.
  speakQueue.push({ text, audio: fetchPremium(text), gen: speechGen });
  if (!speaking) drainSpeech();
}

async function drainSpeech() {
  speaking = true;
  while (speakQueue.length) {
    const item = speakQueue.shift();
    if (item.gen !== speechGen) continue;
    setState("speaking");
    const url = await item.audio;
    if (url) await playUrl(url, item.gen);
    else await browserSay(item.text, item.gen);
  }
  speaking = false;
  onSpeechIdle();
}

function stopSpeaking() {
  speechGen++;
  speakQueue.length = 0;
  try { speechSynthesis.cancel(); } catch {}
  player.pause();
  if (player.onended) player.onended(); // pause() doesn't fire "ended"; release the waiting sentence
}

let replyInFlight = false;
let lastReplyMode = "voice";
let cancelled = false;
function onSpeechIdle() {
  if (replyInFlight || state === "listening") return; // more sentences are coming, or he already barged in
  if (cancelled) { cancelled = false; setState("idle", mode === "voice" ? "Tap to talk" : undefined); return; }
  if (lastReplyMode === "voice" && prefs.handsFree && mode === "voice") listen();
  else setState("idle", mode === "voice" ? "Tap to talk" : undefined);
}

// Splits streamed text into sentences so speech starts before the reply finishes.
function sentenceChunker(onSentence) {
  let buf = "";
  return {
    push(t) {
      buf += t;
      const re = /[.!?…:;](?=\s)|\n+/g;
      let m, cut = -1;
      while ((m = re.exec(buf))) cut = m.index + m[0].length;
      if (cut > 0 && buf.slice(0, cut).trim().length >= 12) { onSentence(buf.slice(0, cut)); buf = buf.slice(cut); }
    },
    flush() { if (buf.trim()) onSentence(buf); buf = ""; },
  };
}

// iOS and some browsers only allow audio after a user gesture — prime both engines on first tap.
let unlocked = false;
function unlockAudio() {
  if (unlocked) return;
  unlocked = true;
  try { speechSynthesis.speak(new SpeechSynthesisUtterance("")); } catch {}
  player.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
  player.play().catch(() => {});
}

// ---------- Listening ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null;

function listen() {
  if (!SR) { setMode("text"); addMsg("error", "Voice input isn't supported in this browser. Try Chrome or Safari."); return; }
  if (abortReply) abortReply.abort(); // barge-in: drop the rest of the current reply
  stopSpeaking();
  stopListening();
  rec = new SR();
  rec.lang = navigator.language || "en-US";
  rec.interimResults = true;
  rec.continuous = false;
  let finalText = "";
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
    }
    $("caption").textContent = (finalText + interim).trim() || "Listening…";
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed")
      addMsg("error", "Microphone access is blocked. Allow it in your browser settings (and make sure the page is on HTTPS).");
  };
  rec.onend = () => {
    rec = null;
    const text = finalText.trim();
    if (text) send(text, "voice");
    else if (state === "listening") setState("idle", "Tap to talk");
  };
  setState("listening", "Listening…");
  try { rec.start(); } catch { setState("idle", "Tap to talk"); }
}

function stopListening() {
  if (rec) { const r = rec; rec = null; r.onend = null; try { r.abort(); } catch {} }
}

// One button does the right thing for each state:
// idle → talk · listening → done talking · speaking → interrupt and talk · thinking → cancel.
function onTalkPress() {
  unlockAudio();
  if (state === "listening") { if (rec) rec.stop(); return; }
  if (state === "thinking") {
    cancelled = true;
    stopSpeaking();
    if (abortReply) abortReply.abort();
    setState("idle", "Tap to talk");
    return;
  }
  listen();
}

// ---------- Sending ----------
let abortReply = null;

async function send(text, how, images = []) {
  lastReplyMode = how;
  cancelled = false;
  addMsg("user", text, images.map((i) => `data:${i.media_type};base64,${i.data}`));
  setState("thinking", how === "voice" ? "…" : undefined);
  const reply = addMsg("assistant");
  let full = "";
  const willSpeak = how === "voice" || prefs.speakText;
  const chunker = sentenceChunker((s) => { if (willSpeak) say(s); });
  let statusEl = null;

  replyInFlight = true;
  abortReply = new AbortController();
  try {
    const res = await api("/api/chat", {
      method: "POST",
      signal: abortReply.signal,
      body: JSON.stringify({
        text, images, mode: how,
        local_time: `${new Date().toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" })} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Server error ${res.status}`);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (!line.startsWith("data: ")) continue;
        const ev = JSON.parse(line.slice(6));
        if (ev.type === "text") {
          if (statusEl) { statusEl.remove(); statusEl = null; }
          full += ev.text; reply.setText(full); chunker.push(ev.text);
          if (how === "voice" && !speaking) $("caption").textContent = full.slice(-140);
        } else if (ev.type === "status") {
          if (!statusEl) statusEl = addMsg("status", ev.text);
          if (how === "voice") $("caption").textContent = ev.text;
        } else if (ev.type === "error") {
          addMsg("error", ev.text);
          if (willSpeak) say(ev.text);
        }
      }
    }
    chunker.flush();
  } catch (e) {
    if (e.name !== "AbortError" && e.message !== "locked") addMsg("error", e.message || "Something went wrong.");
  } finally {
    if (statusEl) statusEl.remove();
    if (!full) reply.remove();
    replyInFlight = false;
    abortReply = null;
    if (!speaking) onSpeechIdle();
  }
}

// ---------- Text mode ----------
const textInput = $("textInput");
textInput.addEventListener("input", () => { textInput.style.height = "auto"; textInput.style.height = Math.min(textInput.scrollHeight, 160) + "px"; });
textInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(pointer: fine)").matches) { e.preventDefault(); $("textForm").requestSubmit(); }
});
$("textForm").addEventListener("submit", (e) => {
  e.preventDefault();
  unlockAudio();
  const text = textInput.value.trim();
  if ((!text && !pendingImages.length) || state === "thinking") return;
  const imgs = pendingImages; pendingImages = []; renderAttachments();
  textInput.value = ""; textInput.style.height = "auto";
  stopSpeaking();
  send(text, "text", imgs);
});

// Images are downscaled on-device: faster uploads, and plenty of detail for design critique.
function readImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const max = 1568, scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve({ media_type: "image/jpeg", data: c.toDataURL("image/jpeg", 0.88).split(",")[1] });
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
$("fileInput").addEventListener("change", async (e) => {
  for (const f of [...e.target.files].slice(0, 4 - pendingImages.length)) {
    try { pendingImages.push(await readImage(f)); } catch { addMsg("error", `Couldn't read ${f.name}.`); }
  }
  e.target.value = "";
  renderAttachments();
});
function renderAttachments() {
  const box = $("attachments");
  box.innerHTML = "";
  pendingImages.forEach((im, i) => {
    const d = document.createElement("div"); d.className = "thumb";
    d.innerHTML = `<img src="data:${im.media_type};base64,${im.data}" alt=""><button type="button" aria-label="Remove">✕</button>`;
    d.querySelector("button").onclick = () => { pendingImages.splice(i, 1); renderAttachments(); };
    box.appendChild(d);
  });
}

// ---------- Settings ----------
function openSettings() {
  $("settings").hidden = false;
  $("voiceNote").textContent = cfg.premium_voice
    ? "Premium voice (ElevenLabs) is on. The browser voice below is only a fallback."
    : "Using your device's built-in voice. Add an ElevenLabs key on the server for a cinematic one.";
  $("pitch").value = prefs.pitch; $("pitchVal").textContent = prefs.pitch;
  $("rate").value = prefs.rate; $("rateVal").textContent = prefs.rate;
  $("speakText").checked = prefs.speakText;
  loadFacts();
}
async function loadFacts() {
  const ul = $("facts");
  ul.innerHTML = "";
  try {
    const facts = await (await api("/api/memory")).json();
    if (!facts.length) { ul.innerHTML = `<li class="empty">Nothing yet. Tell it about your goals and projects.</li>`; return; }
    for (const f of facts) {
      const li = document.createElement("li");
      li.innerHTML = `<span>${escapeHtml(f.text)}</span><button aria-label="Forget">✕</button>`;
      li.querySelector("button").onclick = async () => { await api(`/api/memory/${f.id}`, { method: "DELETE" }); li.remove(); };
      ul.appendChild(li);
    }
  } catch {}
}
$("settingsBtn").onclick = openSettings;
$("closeSettings").onclick = () => ($("settings").hidden = true);
$("settings").addEventListener("click", (e) => { if (e.target.id === "settings") $("settings").hidden = true; });
$("voiceSelect").onchange = (e) => savePref("voiceURI", e.target.value);
$("pitch").oninput = (e) => { savePref("pitch", +e.target.value); $("pitchVal").textContent = e.target.value; };
$("rate").oninput = (e) => { savePref("rate", +e.target.value); $("rateVal").textContent = e.target.value; };
$("speakText").onchange = (e) => savePref("speakText", e.target.checked);
$("testVoice").onclick = () => { unlockAudio(); stopSpeaking(); say(`Good evening${cfg.user ? ", " + cfg.user : ""}. All systems are online.`); };
$("clearHistory").onclick = async () => {
  if (!confirm("Clear the conversation history? Saved memories stay.")) return;
  await api("/api/history", { method: "DELETE" });
  $("log").innerHTML = "";
};
$("lockBtn").onclick = () => { store.del("code"); code = ""; $("settings").hidden = true; lock(); };

// ---------- Access code ----------
function lock(message = "") {
  $("lock").hidden = false;
  $("lockError").textContent = message;
  $("codeInput").value = "";
  setTimeout(() => $("codeInput").focus(), 50);
}
$("lockForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  unlockAudio();
  code = $("codeInput").value;
  const res = await fetch("/api/auth", { method: "POST", headers: { "X-Access-Code": code } });
  if (res.ok) { store.set("code", code); $("lock").hidden = true; boot(); }
  else $("lockError").textContent = res.status === 503 ? "The server has no ACCESS_CODE set yet." : "That's not it.";
});

// ---------- Wiring ----------
$("orb").onclick = onTalkPress;
$("briefingBtn").onclick = () => {
  unlockAudio();
  if (state === "thinking") return;
  stopListening(); stopSpeaking();
  send("Give me my briefing.", mode);
};
$("micBtn").onclick = onTalkPress;
$("toTextBtn").onclick = () => setMode("text");
$("toVoiceBtn").onclick = () => setMode("voice");
const hf = $("handsFreeBtn");
hf.setAttribute("aria-pressed", prefs.handsFree);
hf.onclick = () => { savePref("handsFree", !prefs.handsFree); hf.setAttribute("aria-pressed", prefs.handsFree); };
document.addEventListener("keydown", (e) => {
  // Laptop: hold-free shortcut — press Space (outside text fields) to talk.
  if (e.code === "Space" && mode === "voice" && !e.target.closest("input, textarea, select, button")) { e.preventDefault(); onTalkPress(); }
});

async function boot() {
  try { cfg = await (await fetch("/api/config")).json(); } catch {}
  document.title = cfg.name;
  $("brandName").textContent = cfg.name;
  $("lockTitle").textContent = cfg.name;
  if (!code) return lock();
  try {
    const hist = await (await api("/api/history")).json();
    $("log").innerHTML = "";
    for (const m of hist.slice(-12)) addMsg(m.role, m.text);
  } catch { return; }
  if (!SR) setMode("text");
  setState("idle", SR ? "Tap to talk" : "Voice input isn't available in this browser");
}
boot();
