import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn, execFile } from "node:child_process";
import { getPlatform } from "./paths";
import { installedWidevine, type HeliumInstall } from "./helium";
import { installWidevine } from "./widevine";
import { getLogger } from "./logger";

/**
 * Prove the fix works: start Helium invisibly with a throw-away profile,
 * open a local page (127.0.0.1 counts as a secure context, so no internet
 * is needed) and ask Helium itself whether Widevine is available - the same
 * check a streaming site makes.
 */

export interface VerifyResult {
  ok: boolean;
  message: string;
}

const PROBE = `navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{
  initDataTypes: ['cenc'],
  videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }]
}]).then(a => 'ok:' + a.keySystem, e => 'error:' + e.message)`;

async function waitForDevTools(profile: string, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const port = Number((await Bun.file(join(profile, "DevToolsActivePort")).text()).split("\n")[0]);
      if (port) return port;
    } catch {
      // not written yet
    }
    await Bun.sleep(200);
  }
  throw new Error("Helium did not start in time");
}

async function evaluate(wsUrl: string, expression: string, timeoutMs: number): Promise<string> {
  const ws = new WebSocket(wsUrl);
  try {
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("Could not connect to Helium"));
    });
    return await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Helium did not answer in time")), timeoutMs);
      ws.onmessage = (event) => {
        const msg = JSON.parse(String(event.data));
        if (msg.id !== 1) return;
        clearTimeout(timer);
        resolve(String(msg.result?.result?.value ?? msg.result?.exceptionDetails?.text ?? "no answer"));
      };
      ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, awaitPromise: true } }));
    });
  } finally {
    ws.close();
  }
}

function killTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (getPlatform() === "win32") {
      execFile("taskkill", ["/F", "/T", "/PID", String(pid)], { windowsHide: true }, () => resolve());
    } else {
      try {
        process.kill(-pid, "SIGKILL"); // whole process group
      } catch {
        // already gone
      }
      resolve();
    }
  });
}

async function removeWithRetry(dir: string): Promise<void> {
  for (let i = 0; i < 10; i++) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch {
      await Bun.sleep(300); // Windows may still hold files for a moment
    }
  }
}

export async function verifyWidevine(install: HeliumInstall): Promise<VerifyResult> {
  const log = getLogger();
  if (!install.executable) {
    return { ok: false, message: "Couldn't find Helium's program file to start it" };
  }

  const profile = await mkdtemp(join(tmpdir(), "helium-drm-verify-"));
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("<!doctype html><title>Helium DRM check</title>", { headers: { "content-type": "text/html" } }),
  });
  let pid: number | undefined;

  try {
    // On Linux, Widevine lives in the profile - give the test profile a copy
    if (getPlatform() === "linux") {
      const current = await installedWidevine(install);
      if (!current) return { ok: false, message: "No Widevine installed in this Helium profile" };
      const dest = join(profile, "WidevineCdm", current.version);
      await installWidevine(current, dest);
      await writeFile(join(profile, "WidevineCdm", "latest-component-updated-widevine-cdm"), JSON.stringify({ Path: dest }));
    }

    const child = spawn(
      install.executable,
      [
        `--user-data-dir=${profile}`,
        "--headless=new",
        "--remote-debugging-port=0",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        `http://127.0.0.1:${server.port}/`,
      ],
      { stdio: "ignore", detached: getPlatform() !== "win32", windowsHide: true }
    );
    pid = child.pid;
    log.info(`Started Helium for verification (pid ${pid})`);

    const port = await waitForDevTools(profile, 30000);
    const pages = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>;
    const page = pages.find((p) => p.type === "page" && p.url.startsWith("http://127.0.0.1"));
    if (!page) throw new Error("Helium opened no test page");

    const answer = await evaluate(page.webSocketDebuggerUrl, PROBE, 15000);
    log.info(`Helium answered: ${answer}`);
    return answer.startsWith("ok:")
      ? { ok: true, message: "Helium confirms Widevine DRM is available" }
      : { ok: false, message: `Helium says: ${answer.replace(/^error:/, "")}` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  } finally {
    if (pid) await killTree(pid);
    server.stop(true);
    await removeWithRetry(profile);
  }
}
