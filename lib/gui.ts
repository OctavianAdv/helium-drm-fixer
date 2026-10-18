import { spawn, execFile } from "node:child_process";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { stat } from "node:fs/promises";
import { getLanguage, LANGUAGES, setLanguage, t, type Lang } from "./i18n";
import { renderPage } from "./gui-page";

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

interface RunBody {
  from?: string;
  google?: boolean;
  latest?: boolean;
}

function actionArgs(action: Action, body: RunBody): string[] {
  switch (action) {
    case "fix": {
      const args = ["--yes"];
      if (body.google) args.push("--force-download");
      // Picking a specific copy means "use exactly this one", even if Helium has a newer one
      else if (body.from) args.push("--from", body.from, "--reinstall");
      else if (body.latest) args.push("--latest");
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
    HELIUM_DRM_FIXER_PROGRESS: "1",
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
function runStream(action: Action, body: RunBody): Response {
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
        for (const line of lines) {
          const marker = line.match(/^@@step:(\w+)/);
          if (marker) send("step", marker[1]);
          else if (line.trim()) send("line", line);
        }
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
    "--window-size=680,900",
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
        return new Response(renderPage(version), { headers: { "content-type": "text/html; charset=utf-8" } });
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
        const body = (await req.json().catch(() => ({}))) as RunBody & { action?: Action };
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
