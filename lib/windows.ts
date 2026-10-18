import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getLogger } from "./logger";

const execFileAsync = promisify(execFile);

const UNINSTALL_KEYS = [
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  "HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
];

/**
 * Parse `reg query` output into { keyPath: { valueName: data } }.
 */
export function parseRegQuery(output: string): Record<string, Record<string, string>> {
  const keys: Record<string, Record<string, string>> = {};
  let current: Record<string, string> | null = null;

  for (const line of output.split(/\r?\n/)) {
    if (/^HKEY_/.test(line)) {
      current = keys[line.trim()] = {};
      continue;
    }
    const match = line.match(/^\s+(.+?)\s{4}(REG_\w+)\s{4}(.*)$/);
    if (match && current) {
      current[match[1]!] = match[3]!.trim();
    }
  }

  return keys;
}

async function regQuery(args: string[]): Promise<Record<string, Record<string, string>>> {
  try {
    const { stdout } = await execFileAsync("reg", ["query", ...args], {
      windowsHide: true,
    });
    return parseRegQuery(stdout);
  } catch {
    // Key or value doesn't exist
    return {};
  }
}

/**
 * Folders from installed programs whose name matches `displayName`
 * (InstallLocation, or the folder of DisplayIcon).
 */
export async function findInstallLocations(displayName: RegExp): Promise<string[]> {
  const log = getLogger();
  const locations: string[] = [];

  for (const root of UNINSTALL_KEYS) {
    const programs = await regQuery([root, "/s", "/v", "DisplayName"]);
    for (const [key, values] of Object.entries(programs)) {
      if (!displayName.test(values.DisplayName ?? "")) continue;

      const details = Object.values(await regQuery([key]))[0] ?? {};
      const location =
        details.InstallLocation ||
        details.DisplayIcon?.replace(/^"|"?(,\s*-?\d+)?$/g, "").replace(/\\[^\\]+$/, "");
      if (location) {
        log.info(`Registry: ${values.DisplayName} installed at ${location}`);
        locations.push(location);
      }
    }
  }

  return locations;
}

/**
 * Folder registered for an executable under "App Paths" (e.g. chrome.exe).
 */
export async function findAppPath(exeName: string): Promise<string[]> {
  const dirs: string[] = [];
  for (const hive of ["HKCU", "HKLM"]) {
    const key = `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exeName}`;
    const values = Object.values(await regQuery([key]))[0];
    const dir = values?.Path || values?.["(Default)"]?.replace(/\\[^\\]+$/, "");
    if (dir) dirs.push(dir.replace(/^"|"$/g, ""));
  }
  return dirs;
}

export interface RunningProcess {
  pid: number;
  path: string;
  commandLine: string;
}

/**
 * Running processes with this executable name.
 */
export async function findRunningProcesses(exeName: string): Promise<RunningProcess[]> {
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `@(Get-CimInstance Win32_Process -Filter "Name='${exeName}'" | Select-Object ProcessId,ExecutablePath,CommandLine) | ConvertTo-Json -Compress`,
      ],
      { windowsHide: true }
    );
    if (!stdout.trim()) return [];
    const parsed = JSON.parse(stdout);
    return (Array.isArray(parsed) ? parsed : [parsed])
      .filter((p) => p.ExecutablePath)
      .map((p) => ({
        pid: p.ProcessId,
        path: p.ExecutablePath,
        commandLine: p.CommandLine ?? `"${p.ExecutablePath}"`,
      }));
  } catch {
    return [];
  }
}

/**
 * Full paths of running processes with this executable name.
 */
export async function findRunningExecutables(exeName: string): Promise<string[]> {
  return [...new Set((await findRunningProcesses(exeName)).map((p) => p.path))];
}

/**
 * Start a program from a full command line, owned by Windows rather than by
 * us (via WMI), so it keeps running when this tool and its terminal close.
 */
export async function startIndependentProcess(commandLine: string): Promise<void> {
  const quoted = commandLine.replace(/'/g, "''");
  const { stdout } = await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `(Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${quoted}' }).ReturnValue`,
    ],
    { windowsHide: true }
  );
  if (stdout.trim() !== "0") {
    throw new Error(`Win32_Process.Create returned ${stdout.trim()}`);
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Close processes the way clicking X would (so the browser saves its tabs),
 * and force-close whatever is still running after `timeoutMs`.
 */
export async function closeProcesses(pids: number[], timeoutMs = 10000): Promise<void> {
  const pidArgs = pids.flatMap((pid) => ["/PID", String(pid)]);
  await execFileAsync("taskkill", pidArgs, { windowsHide: true }).catch(() => {});

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && pids.some(isAlive)) {
    await Bun.sleep(250);
  }

  const remaining = pids.filter(isAlive);
  if (remaining.length) {
    await execFileAsync(
      "taskkill",
      ["/F", "/T", ...remaining.flatMap((pid) => ["/PID", String(pid)])],
      { windowsHide: true }
    ).catch(() => {});
    await Bun.sleep(500);
  }
}
