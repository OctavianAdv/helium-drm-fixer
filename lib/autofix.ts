import { join, basename } from "node:path";
import { homedir, tmpdir } from "node:os";
import { mkdir, rm, writeFile, appendFile, readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { downloadFile } from "./chrome-downloader";
import { getLogger } from "./logger";

const execFileAsync = promisify(execFile);

/**
 * Automatic updates: every hour (and at login) a background copy of the fixer
 * re-applies the fix after Helium updates and installs newer Widevine
 * versions as Google releases them. No administrator rights are needed.
 *
 * - Windows: a hidden scheduled task runs a window-less copy of the fixer.
 * - macOS: a LaunchAgent.
 * - Linux: a systemd user timer (or a cron job where systemd isn't available).
 */

export const TASK_NAME = "Helium DRM Fixer";
const REPO = "OctavianAdv/helium-drm-fixer";

const MAC_LABEL = "com.octavianadv.helium-drm-fixer";
const macPlist = () => join(homedir(), "Library", "LaunchAgents", `${MAC_LABEL}.plist`);

const LINUX_UNIT = "helium-drm-fixer";
const systemdDir = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "systemd", "user");
const CRON_MARKER = "# helium-drm-fixer auto-update";

export function autoFixDir(): string {
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "helium-drm-fixer");
  if (process.platform === "linux") {
    return join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "helium-drm-fixer");
  }
  return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "helium-drm-fixer");
}

export const autoFixExe = () =>
  join(autoFixDir(), process.platform === "win32" ? "fix-helium-drm-auto.exe" : "fix-helium-drm");
export const autoFixLog = () => join(autoFixDir(), "auto-fix.log");

/** True when running as a compiled executable (not `bun cli.ts`). */
function isCompiled(): boolean {
  return !/^bun(\.exe)?$/i.test(basename(process.execPath));
}

/**
 * Copy an executable and switch it to the Windows GUI subsystem, so it runs
 * without opening a console window. (PE header: Subsystem field, 3 = console, 2 = GUI.)
 */
export async function makeWindowlessCopy(src: string, dest: string): Promise<void> {
  const bytes = new Uint8Array(await Bun.file(src).arrayBuffer());
  const view = new DataView(bytes.buffer);
  const pe = view.getUint32(0x3c, true);
  if (view.getUint32(pe, true) !== 0x00004550) throw new Error("Not a Windows executable");
  const optionalHeader = pe + 24;
  const subsystemOffset = optionalHeader + 68; // same offset for PE32 and PE32+
  view.setUint16(subsystemOffset, 2, true);
  await Bun.write(dest, bytes);
}

function taskXml(command: string): string {
  const user = `${process.env.USERDOMAIN ?? ""}\\${process.env.USERNAME ?? ""}`;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Keeps Widevine DRM installed and up to date in Helium. https://github.com/${REPO}</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled><UserId>${esc(user)}</UserId><Delay>PT1M</Delay></LogonTrigger>
    <TimeTrigger>
      <Repetition><Interval>PT1H</Interval></Repetition>
      <StartBoundary>2026-01-01T00:00:00</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author"><UserId>${esc(user)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT10M</ExecutionTimeLimit>
    <Hidden>true</Hidden>
  </Settings>
  <Actions Context="Author">
    <Exec><Command>${esc(command)}</Command><Arguments>--auto-run</Arguments></Exec>
  </Actions>
</Task>
`;
}

async function readCrontab(): Promise<string> {
  try {
    return (await execFileAsync("crontab", ["-l"])).stdout;
  } catch {
    return "";
  }
}

async function writeCrontab(content: string): Promise<void> {
  const file = join(tmpdir(), `helium-drm-fixer-cron-${process.pid}`);
  await writeFile(file, content.endsWith("\n") || !content ? content : content + "\n");
  try {
    await execFileAsync("crontab", [file]);
  } finally {
    await rm(file, { force: true });
  }
}

export async function isAutoFixEnabled(): Promise<boolean> {
  if (process.platform === "darwin") return Bun.file(macPlist()).exists();
  if (process.platform === "linux") {
    return (await Bun.file(join(systemdDir(), `${LINUX_UNIT}.timer`)).exists()) || (await readCrontab()).includes(CRON_MARKER);
  }
  try {
    await execFileAsync("schtasks", ["/Query", "/TN", TASK_NAME], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

async function enableMac(): Promise<void> {
  const log = getLogger();
  await mkdir(autoFixDir(), { recursive: true });
  let source = process.execPath;
  if (!isCompiled()) {
    const asset = `fix-helium-drm-macos-${process.arch === "arm64" ? "arm64" : "x64"}`;
    source = join(tmpdir(), asset);
    await downloadFile(`https://github.com/${REPO}/releases/latest/download/${asset}`, source, { logger: log });
  }
  await Bun.write(autoFixExe(), Bun.file(source));
  await execFileAsync("chmod", ["+x", autoFixExe()]);
  await execFileAsync("codesign", ["--force", "--sign", "-", autoFixExe()]).catch(() => {});

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${MAC_LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${autoFixExe()}</string><string>--auto-run</string></array>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>3600</integer>
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
</dict>
</plist>
`;
  await mkdir(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
  await writeFile(macPlist(), plist);
  const domain = `gui/${process.getuid?.() ?? 501}`;
  await execFileAsync("launchctl", ["bootout", `${domain}/${MAC_LABEL}`]).catch(() => {});
  await execFileAsync("launchctl", ["bootstrap", domain, macPlist()]).catch(() =>
    execFileAsync("launchctl", ["load", "-w", macPlist()])
  );
}

/** Linux: copy ourselves (or the latest release) to ~/.local/share/helium-drm-fixer. */
async function installLinuxCopy(): Promise<void> {
  const log = getLogger();
  await mkdir(autoFixDir(), { recursive: true });
  let source = process.execPath;
  if (!isCompiled()) {
    const asset = `fix-helium-drm-linux-${process.arch === "arm64" ? "arm64" : "x64"}`;
    source = join(tmpdir(), asset);
    await downloadFile(`https://github.com/${REPO}/releases/latest/download/${asset}`, source, { logger: log });
  }
  await Bun.write(autoFixExe(), Bun.file(source));
  await execFileAsync("chmod", ["+x", autoFixExe()]);
}

async function enableLinux(): Promise<void> {
  await installLinuxCopy();
  const exe = autoFixExe();

  try {
    await mkdir(systemdDir(), { recursive: true });
    await writeFile(
      join(systemdDir(), `${LINUX_UNIT}.service`),
      `[Unit]
Description=Helium DRM Fixer: keep Widevine installed and up to date
Documentation=https://github.com/${REPO}

[Service]
Type=oneshot
ExecStart="${exe}" --auto-run
Nice=10
`
    );
    await writeFile(
      join(systemdDir(), `${LINUX_UNIT}.timer`),
      `[Unit]
Description=Run Helium DRM Fixer every hour

[Timer]
OnBootSec=2min
OnUnitActiveSec=1h
Persistent=true

[Install]
WantedBy=timers.target
`
    );
    await execFileAsync("systemctl", ["--user", "daemon-reload"]);
    await execFileAsync("systemctl", ["--user", "enable", "--now", `${LINUX_UNIT}.timer`]);
  } catch (error) {
    // No systemd user session: use cron instead
    await rm(join(systemdDir(), `${LINUX_UNIT}.service`), { force: true });
    await rm(join(systemdDir(), `${LINUX_UNIT}.timer`), { force: true });
    const current = (await readCrontab()).split("\n").filter((l) => !l.includes(CRON_MARKER)).join("\n").trim();
    const line = `@hourly "${exe}" --auto-run >/dev/null 2>&1 ${CRON_MARKER}`;
    try {
      await writeCrontab([current, `@reboot sleep 120; "${exe}" --auto-run >/dev/null 2>&1 ${CRON_MARKER}`, line].filter(Boolean).join("\n"));
    } catch {
      throw error;
    }
  }
}

async function disableLinux(): Promise<void> {
  await execFileAsync("systemctl", ["--user", "disable", "--now", `${LINUX_UNIT}.timer`]).catch(() => {});
  await rm(join(systemdDir(), `${LINUX_UNIT}.service`), { force: true });
  await rm(join(systemdDir(), `${LINUX_UNIT}.timer`), { force: true });
  await execFileAsync("systemctl", ["--user", "daemon-reload"]).catch(() => {});
  const crontab = await readCrontab();
  if (crontab.includes(CRON_MARKER)) {
    await writeCrontab(crontab.split("\n").filter((l) => !l.includes(CRON_MARKER)).join("\n").trim()).catch(() => {});
  }
  await rm(autoFixDir(), { recursive: true, force: true });
}

export async function enableAutoFix(): Promise<void> {
  if (process.platform === "darwin") return enableMac();
  if (process.platform === "linux") return enableLinux();
  const log = getLogger();
  await mkdir(autoFixDir(), { recursive: true });

  // Get an executable to install: ourselves, or the latest release when running from source
  let source = process.execPath;
  if (!isCompiled()) {
    source = join(tmpdir(), "fix-helium-drm-windows-x64.exe");
    await downloadFile(
      `https://github.com/${REPO}/releases/latest/download/fix-helium-drm-windows-x64.exe`,
      source,
      { logger: log }
    );
  }
  await makeWindowlessCopy(source, autoFixExe());
  log.info(`Installed window-less fixer at ${autoFixExe()}`);

  const xmlPath = join(autoFixDir(), "task.xml");
  // schtasks expects UTF-16 with a byte order mark
  const xml = taskXml(autoFixExe());
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, "utf16le")]);
  await writeFile(xmlPath, utf16);
  try {
    await execFileAsync("schtasks", ["/Create", "/TN", TASK_NAME, "/XML", xmlPath, "/F"], { windowsHide: true });
  } finally {
    await rm(xmlPath, { force: true });
  }
}

export async function disableAutoFix(): Promise<void> {
  if (process.platform === "linux") return disableLinux();
  if (process.platform === "darwin") {
    await execFileAsync("launchctl", ["bootout", `gui/${process.getuid?.() ?? 501}/${MAC_LABEL}`]).catch(() =>
      execFileAsync("launchctl", ["unload", "-w", macPlist()]).catch(() => {})
    );
    await rm(macPlist(), { force: true });
    await rm(autoFixDir(), { recursive: true, force: true });
    return;
  }
  await execFileAsync("schtasks", ["/Delete", "/TN", TASK_NAME, "/F"], { windowsHide: true }).catch(() => {});
  await rm(autoFixDir(), { recursive: true, force: true });
}

interface AutoState {
  /** When Google was last asked for the newest Widevine (ms since epoch) */
  lastGoogleCheck?: number;
}

const stateFile = () => join(autoFixDir(), "state.json");

export async function readAutoState(): Promise<AutoState> {
  try {
    return JSON.parse(await readFile(stateFile(), "utf-8"));
  } catch {
    return {};
  }
}

export async function writeAutoState(state: AutoState): Promise<void> {
  await mkdir(autoFixDir(), { recursive: true });
  await writeFile(stateFile(), JSON.stringify(state));
}

/** Append a line to the auto-fix log, keeping it short. */
export async function autoLog(message: string): Promise<void> {
  const file = autoFixLog();
  await mkdir(autoFixDir(), { recursive: true });
  await appendFile(file, `${new Date().toISOString()}  ${message}\n`);
  try {
    if ((await stat(file)).size > 200_000) {
      const lines = (await readFile(file, "utf-8")).split("\n");
      await writeFile(file, lines.slice(-500).join("\n"));
    }
  } catch {
    // ignore
  }
}
