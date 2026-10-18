import { join, basename } from "node:path";
import { homedir, tmpdir } from "node:os";
import { mkdir, rm, writeFile, appendFile, readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { downloadFile } from "./chrome-downloader";
import { getLogger } from "./logger";

const execFileAsync = promisify(execFile);

/**
 * Windows auto-fix: Helium installs each update into a new version folder
 * without Widevine. A hidden scheduled task (at logon and every hour) runs a
 * window-less copy of the fixer, which re-applies the fix when needed.
 * No administrator rights are needed.
 */

export const TASK_NAME = "Helium DRM Fixer";
const REPO = "OctavianAdv/helium-drm-fixer";

export function autoFixDir(): string {
  return join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "helium-drm-fixer");
}

export const autoFixExe = () => join(autoFixDir(), "fix-helium-drm-auto.exe");
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
    <Description>Re-applies the Helium DRM fix after Helium updates. https://github.com/${REPO}</Description>
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

export async function isAutoFixEnabled(): Promise<boolean> {
  try {
    await execFileAsync("schtasks", ["/Query", "/TN", TASK_NAME], { windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

export async function enableAutoFix(): Promise<void> {
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
  await execFileAsync("schtasks", ["/Delete", "/TN", TASK_NAME, "/F"], { windowsHide: true }).catch(() => {});
  await rm(autoFixDir(), { recursive: true, force: true });
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
