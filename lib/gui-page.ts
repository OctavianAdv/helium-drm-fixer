import { allMessages, getLanguage, LANGUAGE_NAMES } from "./i18n";

/**
 * The window version's page. Two hand-tuned themes:
 *  - Classic: warm paper, navy ink, gold hairlines, serif headings.
 *  - Midnight: deep night blue with soft glows and frosted-glass cards.
 * "Auto" follows the system: light -> Classic, dark -> Midnight.
 */

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const LOGO = `<svg viewBox="0 0 48 48" aria-hidden="true">
  <defs>
    <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="var(--logo-a)"/><stop offset="1" stop-color="var(--logo-b)"/>
    </linearGradient>
  </defs>
  <path d="M24 3.5 7 10v12.4c0 10.6 7.2 18.9 17 22.1 9.8-3.2 17-11.5 17-22.1V10L24 3.5Z" fill="url(#lg)"/>
  <rect x="16.5" y="21" width="15" height="12" rx="2.6" fill="var(--logo-ink)"/>
  <path d="M19.5 21v-3.2a4.5 4.5 0 0 1 9 0" fill="none" stroke="var(--logo-ink)" stroke-width="2.6" stroke-linecap="round"/>
  <circle cx="24" cy="26.6" r="1.9" fill="url(#lg)"/>
</svg>`;

export function renderPage(version: string): string {
  const m = allMessages();
  const lang = getLanguage();
  const e = (key: keyof typeof m) => escapeHtml(m[key]);
  const langOptions = Object.entries(LANGUAGE_NAMES)
    .map(([code, name]) => `<option value="${code}"${code === lang ? " selected" : ""}>${escapeHtml(name)}</option>`)
    .join("");

  return `<!doctype html>
<html lang="${lang}" data-theme="auto">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e("guiTitle")}</title>
<style>
/* ---------- Themes ---------- */
:root, [data-theme="classic"] {
  --bg: #f4efe4;
  --bg-art:
    radial-gradient(1200px 500px at 50% -180px, #fffaf0 0%, transparent 70%),
    repeating-linear-gradient(0deg, rgba(120,95,50,.025) 0 1px, transparent 1px 3px);
  --surface: #fffdf8;
  --surface-2: #faf5ea;
  --border: #e3d8c3;
  --hairline: #c9ad7a;
  --text: #1c2740;
  --muted: #6d6a62;
  --accent: #1c2740;
  --accent-2: #2c3b5e;
  --accent-ink: #f7f0df;
  --gold: #b08d57;
  --ok: #2e7d4f;
  --warn: #a5690f;
  --bad: #a3332f;
  --glow: transparent;
  --shadow: 0 1px 0 rgba(255,255,255,.7) inset, 0 10px 30px -18px rgba(60,40,10,.35);
  --radius: 14px;
  --font-head: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif;
  --font-body: "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif;
  --logo-a: #2c3b5e; --logo-b: #1c2740; --logo-ink: #e8d3a6;
  --button-bg: linear-gradient(180deg, #2c3b5e, #1c2740);
  --button-border: 1px solid #b08d57;
  --button-shadow: 0 0 0 3px rgba(176,141,87,.18), 0 12px 24px -12px rgba(28,39,64,.6);
  --glass: none;
  color-scheme: light;
}
[data-theme="midnight"] {
  --bg: #090c18;
  --bg-art:
    radial-gradient(700px 420px at 12% -8%, rgba(110,92,255,.33), transparent 60%),
    radial-gradient(640px 420px at 100% 10%, rgba(44,140,255,.22), transparent 60%),
    radial-gradient(800px 500px at 50% 120%, rgba(176,90,255,.16), transparent 60%);
  --surface: rgba(255,255,255,.045);
  --surface-2: rgba(255,255,255,.03);
  --border: rgba(255,255,255,.09);
  --hairline: rgba(160,150,255,.35);
  --text: #eef0ff;
  --muted: #98a0c2;
  --accent: #8d7bff;
  --accent-2: #4f9dff;
  --accent-ink: #ffffff;
  --gold: #c9b8ff;
  --ok: #3ddc97;
  --warn: #f9c74f;
  --bad: #ff6b81;
  --glow: rgba(141,123,255,.55);
  --shadow: 0 1px 0 rgba(255,255,255,.06) inset, 0 20px 50px -25px rgba(0,0,0,.8);
  --radius: 18px;
  --font-head: "Segoe UI Variable Display", "SF Pro Display", "Segoe UI", system-ui, sans-serif;
  --font-body: "Segoe UI Variable Text", "SF Pro Text", "Segoe UI", system-ui, sans-serif;
  --logo-a: #8d7bff; --logo-b: #4f9dff; --logo-ink: #0b0e1d;
  --button-bg: linear-gradient(135deg, #8d7bff 0%, #6b8cff 55%, #4fb3ff 100%);
  --button-border: 1px solid rgba(255,255,255,.18);
  --button-shadow: 0 10px 30px -10px rgba(120,110,255,.75), 0 0 0 1px rgba(255,255,255,.04) inset;
  --glass: blur(18px) saturate(140%);
  color-scheme: dark;
}
@media (prefers-color-scheme: dark) {
  [data-theme="auto"] {
    --bg: #090c18;
    --bg-art:
      radial-gradient(700px 420px at 12% -8%, rgba(110,92,255,.33), transparent 60%),
      radial-gradient(640px 420px at 100% 10%, rgba(44,140,255,.22), transparent 60%),
      radial-gradient(800px 500px at 50% 120%, rgba(176,90,255,.16), transparent 60%);
    --surface: rgba(255,255,255,.045); --surface-2: rgba(255,255,255,.03);
    --border: rgba(255,255,255,.09); --hairline: rgba(160,150,255,.35);
    --text: #eef0ff; --muted: #98a0c2; --accent: #8d7bff; --accent-2: #4f9dff; --accent-ink: #fff;
    --gold: #c9b8ff; --ok: #3ddc97; --warn: #f9c74f; --bad: #ff6b81; --glow: rgba(141,123,255,.55);
    --shadow: 0 1px 0 rgba(255,255,255,.06) inset, 0 20px 50px -25px rgba(0,0,0,.8);
    --radius: 18px;
    --font-head: "Segoe UI Variable Display", "SF Pro Display", "Segoe UI", system-ui, sans-serif;
    --font-body: "Segoe UI Variable Text", "SF Pro Text", "Segoe UI", system-ui, sans-serif;
    --logo-a: #8d7bff; --logo-b: #4f9dff; --logo-ink: #0b0e1d;
    --button-bg: linear-gradient(135deg, #8d7bff 0%, #6b8cff 55%, #4fb3ff 100%);
    --button-border: 1px solid rgba(255,255,255,.18);
    --button-shadow: 0 10px 30px -10px rgba(120,110,255,.75), 0 0 0 1px rgba(255,255,255,.04) inset;
    --glass: blur(18px) saturate(140%);
    color-scheme: dark;
  }
}

/* ---------- Base ---------- */
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body {
  background: var(--bg-art), var(--bg);
  background-attachment: fixed;
  color: var(--text);
  font: 15px/1.5 var(--font-body);
  -webkit-font-smoothing: antialiased;
  transition: background-color .4s ease, color .4s ease;
}
main { max-width: 640px; margin: 0 auto; padding: 22px 20px 26px; }
h1, h2, .head { font-family: var(--font-head); letter-spacing: -.01em; }
button, select { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--accent-2); outline-offset: 2px; }

/* ---------- Top bar ---------- */
.top { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
.logo { width: 42px; height: 42px; flex: none; filter: drop-shadow(0 6px 14px var(--glow)); }
.brand h1 { font-size: 19px; margin: 0; line-height: 1.15; font-weight: 650; }
.brand .ver { font-size: 11.5px; color: var(--muted); letter-spacing: .04em; }
.top .spacer { flex: 1; }
.seg { display: inline-flex; padding: 3px; border-radius: 999px; background: var(--surface); border: 1px solid var(--border); backdrop-filter: var(--glass); }
.seg button { border: 0; background: transparent; padding: 5px 10px; border-radius: 999px; font-size: 12px; color: var(--muted); cursor: pointer; }
.seg button[aria-pressed="true"] { background: var(--accent); color: var(--accent-ink); }
.lang { padding: 6px 8px; border-radius: 10px; background: var(--surface); border: 1px solid var(--border); font-size: 12.5px; color: var(--text); }

/* ---------- Cards ---------- */
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  backdrop-filter: var(--glass);
  -webkit-backdrop-filter: var(--glass);
  padding: 18px;
  margin-bottom: 14px;
}
.hairline { height: 1px; background: linear-gradient(90deg, transparent, var(--hairline), transparent); margin: 14px 0; border: 0; }

/* ---------- Hero ---------- */
.hero { display: flex; gap: 18px; align-items: center; }
.emblem { width: 92px; height: 92px; flex: none; position: relative; border-radius: 50%; filter: drop-shadow(0 0 12px color-mix(in srgb, var(--state) 40%, transparent)); transition: filter .4s ease; }
.emblem svg { width: 100%; height: 100%; }
.emblem .ring-bg { stroke: var(--border); }
.emblem .ring { stroke: var(--state); transition: stroke .4s ease; }
.emblem .icon { stroke: var(--state); fill: none; stroke-width: 5; stroke-linecap: round; stroke-linejoin: round; }
.emblem.checking .ring { stroke-dasharray: 60 240; animation: spin 1.1s linear infinite; transform-origin: 50% 50%; }
@keyframes spin { to { transform: rotate(360deg); } }
.state-ok { --state: var(--ok); } .state-warn { --state: var(--warn); } .state-bad { --state: var(--bad); } .state-busy { --state: var(--accent-2); }
.hero h2 { margin: 0 0 6px; font-size: 22px; font-weight: 650; line-height: 1.2; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { font-size: 12px; padding: 3px 10px; border-radius: 999px; background: var(--surface-2); border: 1px solid var(--border); color: var(--muted); white-space: nowrap; }
.chip.ok { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 35%, transparent); background: color-mix(in srgb, var(--ok) 10%, transparent); }
.chip.accent { color: var(--accent-2); border-color: color-mix(in srgb, var(--accent-2) 40%, transparent); background: color-mix(in srgb, var(--accent-2) 10%, transparent); }
.path { font-size: 11.5px; color: var(--muted); margin-top: 6px; word-break: break-all; opacity: .85; }
.installs { margin-top: 10px; display: grid; gap: 8px; }
.install { display: flex; align-items: center; gap: 10px; font-size: 13px; padding: 8px 10px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--border); }
.dot { width: 9px; height: 9px; border-radius: 50%; background: var(--state); box-shadow: 0 0 10px var(--state); flex: none; }

/* ---------- Primary action ---------- */
.primary {
  position: relative; overflow: hidden;
  width: 100%; margin-top: 16px; padding: 15px 18px;
  border-radius: calc(var(--radius) - 4px);
  border: var(--button-border); background: var(--button-bg); color: var(--accent-ink);
  box-shadow: var(--button-shadow);
  font-size: 16.5px; font-weight: 650; letter-spacing: .01em; cursor: pointer;
  transition: transform .15s ease, box-shadow .2s ease, filter .2s ease;
}
[data-look="classic"] .primary { font-family: var(--font-head); font-size: 17.5px; letter-spacing: .03em; }
.primary:hover:not(:disabled) { transform: translateY(-1px); filter: brightness(1.06); }
.primary:active:not(:disabled) { transform: translateY(0); }
.primary::after {
  content: ""; position: absolute; inset: 0;
  background: linear-gradient(110deg, transparent 30%, rgba(255,255,255,.22) 50%, transparent 70%);
  transform: translateX(-120%); transition: transform .9s ease;
}
.primary:hover:not(:disabled)::after { transform: translateX(120%); }
.primary:disabled { cursor: default; opacity: .85; }
.note { color: var(--muted); font-size: 12.5px; text-align: center; margin: 10px 0 0; }

/* ---------- Steps ---------- */
.steps { display: none; grid-template-columns: repeat(4, 1fr); gap: 0; margin-top: 18px; }
.steps.show { display: grid; }
.step { position: relative; text-align: center; font-size: 12px; color: var(--muted); }
.step::before { content: ""; position: absolute; top: 14px; left: -50%; right: 50%; height: 2px; background: var(--border); }
.step:first-child::before { display: none; }
.step.done::before, .step.active::before { background: var(--accent-2); }
.step .bubble {
  position: relative; z-index: 1; width: 30px; height: 30px; margin: 0 auto 6px; border-radius: 50%;
  display: grid; place-items: center; background: var(--surface-2); border: 2px solid var(--border);
  font-size: 13px; font-weight: 700; transition: all .3s ease;
}
.step.active .bubble { border-color: var(--accent-2); color: var(--accent-2); box-shadow: 0 0 0 5px color-mix(in srgb, var(--accent-2) 16%, transparent); }
.step.active .bubble::after { content: ""; position: absolute; inset: -6px; border-radius: 50%; border: 2px solid transparent; border-top-color: var(--accent-2); animation: spin 1s linear infinite; }
.step.done .bubble { background: var(--ok); border-color: var(--ok); color: #fff; }
.step.fail .bubble { background: var(--bad); border-color: var(--bad); color: #fff; }
.step.active, .step.done { color: var(--text); }

/* ---------- Toast ---------- */
.toast { display: none; align-items: center; gap: 10px; padding: 12px 14px; border-radius: 12px; margin-bottom: 14px; font-weight: 600; font-size: 14px; border: 1px solid; animation: rise .35s ease; }
.toast.show { display: flex; }
.toast.ok { color: var(--ok); background: color-mix(in srgb, var(--ok) 11%, var(--surface)); border-color: color-mix(in srgb, var(--ok) 30%, transparent); }
.toast.warn { color: var(--warn); background: color-mix(in srgb, var(--warn) 12%, var(--surface)); border-color: color-mix(in srgb, var(--warn) 30%, transparent); }
.toast.bad { color: var(--bad); background: color-mix(in srgb, var(--bad) 11%, var(--surface)); border-color: color-mix(in srgb, var(--bad) 30%, transparent); }
@keyframes rise { from { opacity: 0; transform: translateY(6px); } }

/* ---------- Options ---------- */
.label { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin: 0 0 8px; }
[data-look="classic"] .label { color: var(--gold); }
.select { width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border); background: var(--surface-2); }
.row { display: flex; gap: 10px; margin-top: 12px; }
.ghost { flex: 1; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border); background: transparent; cursor: pointer; transition: border-color .2s, background .2s; }
.ghost:hover:not(:disabled) { border-color: var(--accent-2); background: color-mix(in srgb, var(--accent-2) 7%, transparent); }
.ghost:disabled, .select:disabled { opacity: .55; cursor: default; }

/* ---------- Switch ---------- */
.switch-row { display: flex; align-items: center; gap: 16px; }
.switch-row .text { flex: 1; }
.switch-row .title { font-weight: 650; }
.switch-row .desc { color: var(--muted); font-size: 12.5px; margin-top: 2px; }
.switch { position: relative; width: 50px; height: 28px; flex: none; }
.switch input { opacity: 0; width: 0; height: 0; }
.switch span { position: absolute; inset: 0; border-radius: 999px; background: var(--border); transition: background .25s; cursor: pointer; }
.switch span::before { content: ""; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%; background: #fff; box-shadow: 0 2px 6px rgba(0,0,0,.25); transition: transform .25s cubic-bezier(.3,1.4,.6,1); }
.switch input:checked + span { background: var(--button-bg); }
.switch input:checked + span::before { transform: translateX(22px); }
.switch input:disabled + span { opacity: .55; cursor: default; }

/* ---------- Activity ---------- */
details summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 13px; }
details summary::-webkit-details-marker { display: none; }
details summary::before { content: "▸"; transition: transform .2s; }
details[open] summary::before { transform: rotate(90deg); }
pre { margin: 12px 0 0; padding: 12px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--border); max-height: 220px; overflow: auto; white-space: pre-wrap; word-break: break-all; font: 12px/1.55 ui-monospace, "Cascadia Mono", Consolas, monospace; color: var(--muted); }
footer { text-align: center; font-size: 12px; color: var(--muted); margin-top: 6px; }
footer a { color: inherit; }
.ornament { text-align: center; color: var(--gold); letter-spacing: .6em; font-size: 10px; margin: 2px 0 12px; display: none; }
[data-look="classic"] .ornament { display: block; }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; } }
</style>
</head>
<body>
<main>
  <div class="top">
    <div class="logo">${LOGO}</div>
    <div class="brand">
      <h1>${e("guiTitle")}</h1>
      <div class="ver">v${escapeHtml(version)} · ${e("guiTagline")}</div>
    </div>
    <div class="spacer"></div>
    <div class="seg" role="group" aria-label="${e("guiTheme")}">
      <button data-theme-btn="auto">${e("guiThemeAuto")}</button>
      <button data-theme-btn="classic">${e("guiThemeClassic")}</button>
      <button data-theme-btn="midnight">${e("guiThemeMidnight")}</button>
    </div>
    <select class="lang" id="lang" aria-label="Language">${langOptions}</select>
  </div>

  <div class="ornament">◆ ◆ ◆</div>
  <div class="toast" id="toast" role="status"></div>

  <section class="card">
    <div class="hero">
      <div class="emblem checking state-busy" id="emblem">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle class="ring-bg" cx="50" cy="50" r="44" fill="none" stroke-width="6"/>
          <circle class="ring" cx="50" cy="50" r="44" fill="none" stroke-width="6" stroke-linecap="round"/>
          <g id="emblemIcon"></g>
        </svg>
      </div>
      <div style="min-width:0">
        <h2 id="headline">${e("guiHeroChecking")}</h2>
        <div class="chips" id="chips"></div>
        <div class="path" id="path"></div>
      </div>
    </div>
    <div class="installs" id="installs"></div>

    <button class="primary" id="fix">${e("guiFix")}</button>
    <p class="note">${e("guiCloseNote")}</p>

    <div class="steps" id="steps">
      <div class="step" data-step="helium"><div class="bubble">1</div>${e("guiStepHelium")}</div>
      <div class="step" data-step="widevine"><div class="bubble">2</div>${e("guiStepWidevine")}</div>
      <div class="step" data-step="install"><div class="bubble">3</div>${e("guiStepInstall")}</div>
      <div class="step" data-step="verify"><div class="bubble">4</div>${e("guiStepVerify")}</div>
    </div>
  </section>

  <section class="card">
    <p class="label">${e("guiOptions")}</p>
    <select class="select" id="source" aria-label="${e("guiSource")}">
      <option value="">${e("guiSourceBest")}</option>
      <option value="google">${e("guiSourceGoogle")}</option>
    </select>
    <div class="row">
      <button class="ghost" id="undo">${e("guiUndo")}</button>
      <button class="ghost" id="refresh">${e("guiRefresh")}</button>
    </div>
    <hr class="hairline">
    <div class="switch-row">
      <div class="text">
        <div class="title">${e("guiAuto")}</div>
        <div class="desc">${e("guiAutoDesc")}</div>
      </div>
      <label class="switch"><input type="checkbox" id="auto" aria-label="${e("guiAuto")}"><span></span></label>
    </div>
  </section>

  <section class="card">
    <details id="activity">
      <summary>${e("guiActivity")}</summary>
      <pre id="log"></pre>
    </details>
  </section>

  <footer><a href="https://github.com/OctavianAdv/helium-drm-fixer" target="_blank" rel="noreferrer">GitHub</a> · MIT</footer>
</main>

<script>
const M = ${JSON.stringify(m)};
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fill = (text, params) => text.replace(/\\{(\\w+)\\}/g, (m, k) => (k in params ? params[k] : m));
let busy = false;
let update = null;

/* Theme, remembered per viewer */
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.look = theme === "auto" ? (darkQuery.matches ? "midnight" : "classic") : theme;
  for (const b of document.querySelectorAll("[data-theme-btn]")) b.setAttribute("aria-pressed", String(b.dataset.themeBtn === theme));
  try { localStorage.setItem("hdf-theme", theme); } catch {}
}
let savedTheme = "auto";
try { savedTheme = localStorage.getItem("hdf-theme") || "auto"; } catch {}
const urlTheme = new URLSearchParams(location.search).get("theme");
if (urlTheme && ["auto", "classic", "midnight"].includes(urlTheme)) savedTheme = urlTheme;
setTheme(savedTheme);
darkQuery.addEventListener("change", () => setTheme(document.documentElement.dataset.theme));
for (const b of document.querySelectorAll("[data-theme-btn]")) b.onclick = () => setTheme(b.dataset.themeBtn);

setInterval(() => fetch("/api/heartbeat").catch(() => {}), 4000);
$("lang").onchange = () => { location.search = "?lang=" + $("lang").value + "&theme=" + document.documentElement.dataset.theme; };

const ICONS = {
  ok: '<path class="icon" d="M32 51 L45 64 L69 38"/>',
  warn: '<path class="icon" d="M50 31 V55"/><circle cx="50" cy="68" r="3.6" fill="var(--state)"/>',
  bad: '<path class="icon" d="M37 37 L63 63 M63 37 L37 63"/>',
  busy: "",
};

function emblem(kind) {
  const el = $("emblem");
  el.className = "emblem state-" + kind + (kind === "busy" ? " checking" : "");
  $("emblemIcon").innerHTML = ICONS[kind];
}

function toast(kind, text) {
  const t = $("toast");
  t.className = "toast" + (kind ? " show " + kind : "");
  t.textContent = text || "";
}

function setBusy(on) {
  busy = on;
  for (const id of ["fix", "undo", "refresh", "auto", "source"]) $(id).disabled = on;
  $("fix").textContent = on ? M.guiFixing : update ? fill(M.guiUpdateTo, { version: update }) : M.guiFix;
}

function chip(text, cls) { return '<span class="chip ' + (cls || "") + '">' + esc(text) + "</span>"; }

async function loadStatus() {
  emblem("busy");
  $("headline").textContent = M.guiHeroChecking;
  $("chips").innerHTML = "";
  $("path").textContent = "";
  const [status, sources] = await Promise.all([
    fetch("/api/status").then((r) => r.json()).catch(() => null),
    fetch("/api/sources").then((r) => r.json()).catch(() => []),
  ]);

  const list = (status && status.helium) || [];
  update = list.map((h) => h.update).find(Boolean) || null;
  if (!list.length) {
    emblem("bad");
    $("headline").textContent = M.guiHeroNoHelium;
    $("path").textContent = M.guiNoHelium;
  } else {
    const worst = list.find((h) => h.drm === "missing") || list.find((h) => h.drm === "unconfirmed") || list[0];
    const kind = worst.drm === "works" ? "ok" : "warn";
    emblem(kind);
    $("headline").textContent = worst.drm === "works" ? M.guiHeroWorks : worst.drm === "missing" ? M.guiHeroMissing : M.guiHeroUnconfirmed;
    const h = list[0];
    let chips = chip("Helium " + (h.version || "") + " · " + h.arch);
    if (h.widevine) chips += chip("Widevine " + h.widevine);
    if (h.widevine) chips += h.update ? chip(fill(M.guiUpdateTo, { version: h.update }), "accent") : chip(M.guiUpToDate, "ok");
    $("chips").innerHTML = chips;
    $("path").textContent = h.dir;
    $("installs").innerHTML = list.length < 2 ? "" : list.map((x) => {
      const k = x.drm === "works" ? "ok" : "warn";
      const label = x.drm === "works" ? M.guiDrmWorks : x.drm === "missing" ? M.guiDrmMissing : M.guiDrmUnconfirmed;
      return '<div class="install state-' + k + '"><span class="dot"></span><span style="flex:1;min-width:0;word-break:break-all">' +
        esc("Helium " + (x.version || "") + " · " + x.dir) + "</span><b>" + esc(label) + "</b></div>";
    }).join("");
  }

  const select = $("source");
  const keep = select.value;
  for (const opt of [...select.options].slice(2)) opt.remove();
  const seen = new Set();
  for (const s of sources) {
    if (seen.has(s.name)) continue;
    seen.add(s.name);
    const opt = document.createElement("option");
    opt.value = "from:" + s.name;
    opt.textContent = s.name + " — " + s.version;
    select.appendChild(opt);
  }
  select.value = [...select.options].some((o) => o.value === keep) ? keep : "";
  if (status && typeof status.auto === "boolean") $("auto").checked = status.auto;
  setBusy(false);
}

const ORDER = ["helium", "widevine", "install", "verify"];
function stepTo(name, failed) {
  const idx = name === "done" ? ORDER.length : ORDER.indexOf(name);
  document.querySelectorAll(".step").forEach((el, i) => {
    el.classList.toggle("done", i < idx);
    el.classList.toggle("active", i === idx && !failed);
    el.classList.toggle("fail", i === idx && !!failed);
  });
}

async function run(action, extra) {
  if (busy) return;
  setBusy(true);
  toast("", "");
  $("log").textContent = "";
  let code = 1;
  let lastStep = "helium";
  if (action === "fix") { $("steps").classList.add("show"); stepTo("helium"); emblem("busy"); }
  try {
    const res = await fetch("/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\\n\\n");
      buffer = events.pop();
      for (const ev of events) {
        const type = (ev.match(/^event: (.*)$/m) || [])[1];
        const data = JSON.parse((ev.match(/^data: (.*)$/m) || [])[1] || "null");
        if (type === "line") { $("log").textContent += data + "\\n"; $("log").scrollTop = 1e9; }
        if (type === "step") { lastStep = data; stepTo(data); }
        if (type === "exit") code = data;
      }
    }
  } catch (e) {
    $("log").textContent += String(e) + "\\n";
  }

  if (action === "fix") {
    if (code === 0) stepTo("done");
    else if (code === 2) stepTo("done");
    else stepTo(lastStep, true);
    toast(code === 0 ? "ok" : code === 2 ? "warn" : "bad", code === 0 ? M.guiSuccess : code === 2 ? M.guiUnverified : M.guiFailed);
  } else if (action === "undo") {
    toast(code === 0 ? "ok" : "bad", code === 0 ? M.guiUndone : M.guiFailed);
  } else {
    toast(code === 0 ? "ok" : "bad", code === 0 ? (action === "auto-on" ? M.guiAutoOnDone : M.guiAutoOffDone) : M.guiFailed);
  }
  if (code !== 0 && code !== 2) $("activity").open = true;
  busy = false;
  await loadStatus();
}

$("fix").onclick = () => {
  const v = $("source").value;
  run("fix", v === "google" ? { google: true } : v.startsWith("from:") ? { from: v.slice(5) } : update ? { latest: true } : {});
};
$("undo").onclick = () => run("undo");
$("refresh").onclick = () => loadStatus();
$("auto").onchange = () => run($("auto").checked ? "auto-on" : "auto-off");

loadStatus();
</script>
</body>
</html>`;
}
