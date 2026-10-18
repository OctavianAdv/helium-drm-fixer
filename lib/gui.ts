import { spawn, execFile } from "node:child_process";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { stat } from "node:fs/promises";
import { allMessages, getLanguage, LANGUAGE_NAMES, LANGUAGES, setLanguage, t, type Lang } from "./i18n";

/**
 * The window version: a small local web page (127.0.0.1 only) shown in an
 * app-style window (no address bar), driving the same fixer underneath.
 * Each action runs this program again as a child process and streams its
 * output to the page. When the window is closed, the program exits.
 */

type Action = "fix" | "undo" | "auto-on" | "auto-off";

/** How to run this same program again (compiled exe, or `bun cli.ts`). */
function selfCommand(): string[] {
  const compiled = !/^bun(\.exe)?$/i.test(process.execPath.split(/[\\/]/).pop() ?? "");
  return compiled ? [process.execPath] : [process.execPath, process.argv[1]!];
}

function actionArgs(action: Action, body: { from?: string; google?: boolean }): string[] {
  switch (action) {
    case "fix": {
      const args = ["--yes"];
      if (body.google) args.push("--force-download");
      else if (body.from) args.push("--from", body.from);
      return args;
    }
    case "undo":
      return ["--undo", "--yes"];
    case "auto-on":
      return ["--auto"];
    case "auto-off":
      return ["--auto", "off"];
  }
}

function childEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    HELIUM_DRM_FIXER_NO_UPDATE_CHECK: "1",
    HELIUM_DRM_FIXER_LANG: getLanguage(),
  };
}

/** Run the fixer with these args and collect stdout (for the JSON calls). */
function runJson(args: string[]): Promise<unknown> {
  const [cmd, ...pre] = selfCommand();
  return new Promise((resolve, reject) => {
    execFile(cmd!, [...pre, ...args], { env: childEnv(), windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      const line = stdout.trim().split("\n").pop() ?? "";
      try {
        resolve(JSON.parse(line));
      } catch {
        reject(error ?? new Error("Unexpected output"));
      }
    });
  });
}

/** Run an action and stream its output lines as server-sent events. */
function runStream(action: Action, body: { from?: string; google?: boolean }): Response {
  const [cmd, ...pre] = selfCommand();
  const child = spawn(cmd!, [...pre, ...actionArgs(action, body)], { env: childEnv(), windowsHide: true });
  const encoder = new TextEncoder();
  const clean = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\r/g, "");

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      let buffer = "";
      const onData = (chunk: Buffer) => {
        buffer += clean(chunk.toString("utf-8"));
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) send("line", line);
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.on("close", (code) => {
        if (buffer.trim()) send("line", buffer);
        send("exit", code ?? 1);
        controller.close();
      });
    },
    cancel() {
      child.kill();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Open `url` as an app window (Chromium --app), falling back to the default browser. */
async function openWindow(url: string): Promise<boolean> {
  const profile = join(tmpdir(), "helium-drm-fixer-window");
  const appArgs = [
    `--app=${url}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=620,820",
  ];

  const pf = process.env.ProgramFiles || "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const local = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  const candidates =
    process.platform === "win32"
      ? [
          join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
          join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
          join(pf, "Google", "Chrome", "Application", "chrome.exe"),
          join(local, "Google", "Chrome", "Application", "chrome.exe"),
          join(pf, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
        ]
      : process.platform === "darwin"
        ? [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
          ]
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/usr/bin/microsoft-edge",
            "/usr/bin/brave-browser",
            "/snap/bin/chromium",
          ];

  for (const browser of candidates) {
    if (!(await exists(browser))) continue;
    try {
      spawn(browser, appArgs, { detached: true, stdio: "ignore" }).unref();
      return true;
    } catch {
      // try the next one
    }
  }

  // Fallback: the default browser, as a normal tab
  const opener =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    spawn(opener[0] as string, opener[1] as string[], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    return true;
  } catch {
    return false;
  }
}

/** Windows: hide our own console window (when the window version was double-clicked). */
function hideConsoleWindow(): void {
  if (process.platform !== "win32") return;
  try {
    const { dlopen, FFIType } = require("bun:ffi") as typeof import("bun:ffi");
    const kernel32 = dlopen("kernel32.dll", { GetConsoleWindow: { args: [], returns: FFIType.ptr } });
    const user32 = dlopen("user32.dll", { ShowWindow: { args: [FFIType.ptr, FFIType.i32], returns: FFIType.bool } });
    const hwnd = kernel32.symbols.GetConsoleWindow();
    if (hwnd) user32.symbols.ShowWindow(hwnd, 0);
    kernel32.close();
    user32.close();
  } catch {
    // not critical
  }
}

export async function startGui(version: string, options: { hideConsole?: boolean } = {}): Promise<void> {
  let lastSeen = Date.now();
  let busy = false;

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    async fetch(req) {
      const url = new URL(req.url);
      lastSeen = Date.now();

      // Only our own page may talk to us (blocks other websites and DNS rebinding)
      const self = `127.0.0.1:${server.port}`;
      const origin = req.headers.get("origin");
      if (req.headers.get("host") !== self || (origin && origin !== `http://${self}`)) {
        return new Response("Forbidden", { status: 403 });
      }

      if (url.pathname === "/") {
        const lang = url.searchParams.get("lang");
        if (lang && lang in LANGUAGES) setLanguage(lang as Lang);
        return new Response(page(version), { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (url.pathname === "/api/heartbeat") return new Response("ok");
      if (url.pathname === "/api/status") {
        return Response.json(await runJson(["--status", "--json"]).catch((e) => ({ error: String(e) })));
      }
      if (url.pathname === "/api/sources") {
        return Response.json(await runJson(["--list-sources", "--json"]).catch(() => []));
      }
      if (url.pathname === "/api/run" && req.method === "POST") {
        if (busy) return new Response("Busy", { status: 409 });
        const body = (await req.json().catch(() => ({}))) as { action?: Action; from?: string; google?: boolean };
        if (!body.action || !["fix", "undo", "auto-on", "auto-off"].includes(body.action)) {
          return new Response("Bad action", { status: 400 });
        }
        busy = true;
        const response = runStream(body.action, body);
        // Unlock when the stream ends
        const [a, b] = response.body!.tee();
        (async () => {
          const reader = b.getReader();
          while (!(await reader.read()).done);
          busy = false;
        })();
        return new Response(a, { headers: response.headers });
      }
      return new Response("Not found", { status: 404 });
    },
  });

  const url = `http://127.0.0.1:${server.port}/`;
  // For tests and CI: serve only, don't open a window
  const headless = Boolean(process.env.HELIUM_DRM_FIXER_GUI_NO_WINDOW);
  if (headless) console.log(`GUI_URL=${url}`);
  else console.log(t("guiOpening"));
  const opened = headless ? false : await openWindow(url);
  if (!opened && !headless) {
    console.log(t("guiNoBrowser", { url }));
  } else if (options.hideConsole) {
    hideConsoleWindow();
  }

  // The page pings every few seconds; when it stops (window closed), exit
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      const quiet = Date.now() - lastSeen;
      if (!busy && quiet > (opened ? 20000 : 600000)) {
        clearInterval(timer);
        resolve();
      }
    }, 2000);
  });
  server.stop(true);
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function page(version: string): string {
  const messages = allMessages();
  const lang = getLanguage();
  const langOptions = Object.entries(LANGUAGE_NAMES)
    .map(([code, name]) => `<option value="${code}"${code === lang ? " selected" : ""}>${escapeHtml(name)}</option>`)
    .join("");

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(messages.guiTitle)}</title>
<style>
  :root {
    --bg: #f5f6f8; --card: #ffffff; --text: #16181d; --muted: #646b78; --line: #e3e6eb;
    --accent: #3b5bfd; --accent-text: #ffffff; --ok: #16a34a; --warn: #d97706; --bad: #dc2626;
    color-scheme: light;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #101216; --card: #191c22; --text: #eceef2; --muted: #9aa1ad; --line: #2a2f38;
      --accent: #6d84ff; --accent-text: #0b0d12; --ok: #22c55e; --warn: #f59e0b; --bad: #f87171;
      color-scheme: dark;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 620px; margin: 0 auto; padding: 22px 18px 28px; }
  header { display: flex; align-items: center; gap: 12px; margin-bottom: 18px; }
  .logo { width: 42px; height: 42px; border-radius: 12px; background: linear-gradient(135deg, var(--accent), #9b5cff); display: grid; place-items: center; font-size: 22px; flex: none; }
  h1 { font-size: 19px; margin: 0; }
  .tag { color: var(--muted); margin: 0; font-size: 13.5px; }
  select.lang { margin-left: auto; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px; margin-bottom: 14px; }
  .helium { display: flex; gap: 12px; align-items: flex-start; }
  .helium + .helium { border-top: 1px solid var(--line); margin-top: 12px; padding-top: 12px; }
  .helium .info { flex: 1; min-width: 0; }
  .helium .name { font-weight: 600; }
  .helium .path { color: var(--muted); font-size: 12px; word-break: break-all; }
  .badge { font-size: 12.5px; font-weight: 600; padding: 3px 10px; border-radius: 999px; white-space: nowrap; }
  .badge.works { background: color-mix(in srgb, var(--ok) 15%, transparent); color: var(--ok); }
  .badge.missing { background: color-mix(in srgb, var(--bad) 13%, transparent); color: var(--bad); }
  .badge.unconfirmed { background: color-mix(in srgb, var(--warn) 15%, transparent); color: var(--warn); }
  .muted { color: var(--muted); font-size: 13px; }
  label.field { display: block; font-size: 13px; color: var(--muted); margin-bottom: 6px; }
  select { width: 100%; padding: 9px 10px; border-radius: 10px; border: 1px solid var(--line); background: var(--card); color: var(--text); font: inherit; }
  select.lang { width: auto; padding: 6px 8px; font-size: 13px; }
  button { font: inherit; border-radius: 10px; border: 1px solid var(--line); background: var(--card); color: var(--text); padding: 9px 14px; cursor: pointer; }
  button:hover:not(:disabled) { border-color: var(--accent); }
  button:disabled { opacity: .55; cursor: default; }
  button.primary { width: 100%; background: var(--accent); color: var(--accent-text); border: none; font-size: 16.5px; font-weight: 650; padding: 13px; margin-top: 14px; }
  .row { display: flex; gap: 10px; margin-top: 10px; }
  .row button { flex: 1; }
  .switch { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .switch input { width: 42px; height: 24px; accent-color: var(--accent); }
  .banner { display: none; border-radius: 12px; padding: 12px 14px; margin-bottom: 14px; font-weight: 600; }
  .banner.ok { display: block; background: color-mix(in srgb, var(--ok) 14%, transparent); color: var(--ok); }
  .banner.warn { display: block; background: color-mix(in srgb, var(--warn) 15%, transparent); color: var(--warn); }
  .banner.bad { display: block; background: color-mix(in srgb, var(--bad) 13%, transparent); color: var(--bad); }
  details summary { cursor: pointer; color: var(--muted); font-size: 13px; }
  pre { white-space: pre-wrap; word-break: break-all; font: 12px/1.5 ui-monospace, Consolas, monospace; max-height: 240px; overflow: auto; margin: 10px 0 0; color: var(--muted); }
  .spin { display: inline-block; width: 14px; height: 14px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: s .8s linear infinite; vertical-align: -2px; margin-right: 8px; }
  @keyframes s { to { transform: rotate(360deg); } }
  footer { text-align: center; color: var(--muted); font-size: 12px; margin-top: 8px; }
  footer a { color: inherit; }
</style>
</head>
<body>
<main>
  <header>
    <div class="logo">🔓</div>
    <div>
      <h1>${escapeHtml(messages.guiTitle)}</h1>
      <p class="tag">${escapeHtml(messages.guiTagline)}</p>
    </div>
    <select class="lang" id="lang" aria-label="Language">${langOptions}</select>
  </header>

  <div class="banner" id="banner"></div>

  <section class="card" id="helium"><span class="spin"></span>${escapeHtml(messages.guiLoading)}</section>

  <section class="card">
    <label class="field" for="source">${escapeHtml(messages.guiSource)}</label>
    <select id="source">
      <option value="">${escapeHtml(messages.guiSourceBest)}</option>
      <option value="google">${escapeHtml(messages.guiSourceGoogle)}</option>
    </select>
    <button class="primary" id="fix">${escapeHtml(messages.guiFix)}</button>
    <p class="muted" style="margin:10px 0 0">${escapeHtml(messages.guiCloseNote)}</p>
    <div class="row">
      <button id="undo">${escapeHtml(messages.guiUndo)}</button>
      <button id="refresh">${escapeHtml(messages.guiRefresh)}</button>
    </div>
  </section>

  <section class="card switch" id="autoCard" hidden>
    <label for="auto">${escapeHtml(messages.guiAuto)}</label>
    <input type="checkbox" id="auto">
  </section>

  <section class="card">
    <details id="detailsBox">
      <summary>${escapeHtml(messages.guiDetails)}</summary>
      <pre id="log"></pre>
    </details>
  </section>

  <footer>v${escapeHtml(version)} · <a href="https://github.com/OctavianAdv/helium-drm-fixer" target="_blank" rel="noreferrer">GitHub</a></footer>
</main>
<script>
const M = ${JSON.stringify(messages)};
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
let busy = false;

setInterval(() => fetch("/api/heartbeat").catch(() => {}), 4000);
$("lang").onchange = () => { location.search = "?lang=" + $("lang").value; };

function banner(kind, text) {
  const b = $("banner");
  b.className = "banner " + (kind || "");
  b.textContent = text || "";
}

function setBusy(on, label) {
  busy = on;
  for (const id of ["fix", "undo", "refresh", "auto", "source"]) $(id).disabled = on;
  $("fix").innerHTML = on ? '<span class="spin"></span>' + esc(label || M.guiFixing) : esc(M.guiFix);
}

async function loadStatus() {
  $("helium").innerHTML = '<span class="spin"></span>' + esc(M.guiLoading);
  const [status, sources] = await Promise.all([
    fetch("/api/status").then((r) => r.json()).catch(() => null),
    fetch("/api/sources").then((r) => r.json()).catch(() => []),
  ]);

  if (!status || status.error || !status.helium.length) {
    $("helium").innerHTML = '<div class="muted">' + esc(M.guiNoHelium) + "</div>";
  } else {
    $("helium").innerHTML = status.helium.map((h) => {
      const badge = h.drm === "works" ? M.guiDrmWorks : h.drm === "missing" ? M.guiDrmMissing : M.guiDrmUnconfirmed;
      const name = "Helium" + (h.version ? " " + h.version : "") + " (" + h.arch + ")";
      const wv = h.widevine ? " · Widevine " + h.widevine : "";
      return '<div class="helium"><div class="info"><div class="name">' + esc(name) + '<span class="muted">' + esc(wv) +
        '</span></div><div class="path">' + esc(h.dir) + '</div></div><span class="badge ' + h.drm + '">' + esc(badge) + "</span></div>";
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

  if (status && status.auto !== null && status.auto !== undefined) {
    $("autoCard").hidden = false;
    $("auto").checked = !!status.auto;
  }
}

async function run(action, extra) {
  if (busy) return;
  setBusy(true);
  banner("", "");
  $("log").textContent = "";
  let code = 1;
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
        if (type === "exit") code = data;
      }
    }
  } catch (e) {
    $("log").textContent += String(e) + "\\n";
  }
  setBusy(false);

  if (action === "fix") banner(code === 0 ? "ok" : code === 2 ? "warn" : "bad", code === 0 ? M.guiSuccess : code === 2 ? M.guiUnverified : M.guiFailed);
  else if (action === "undo") banner(code === 0 ? "ok" : "bad", code === 0 ? M.guiUndone : M.guiFailed);
  else banner(code === 0 ? "ok" : "bad", code === 0 ? (action === "auto-on" ? M.guiAutoOnDone : M.guiAutoOffDone) : M.guiFailed);
  if (code !== 0 && code !== 2) $("detailsBox").open = true;
  await loadStatus();
}

$("fix").onclick = () => {
  const v = $("source").value;
  run("fix", v === "google" ? { google: true } : v.startsWith("from:") ? { from: v.slice(5) } : {});
};
$("undo").onclick = () => run("undo");
$("refresh").onclick = () => loadStatus();
$("auto").onchange = () => run($("auto").checked ? "auto-on" : "auto-off");

loadStatus();
</script>
</body>
</html>`;
}
