import { BrowserFinder } from "@agent-infra/browser-finder";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { readdir, stat, realpath } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { getLogger } from "./logger";

export interface PlatformPaths {
  chromeWidevine: string;
  heliumWidevine: string;
}

export type Platform = "win32" | "darwin" | "linux";

const VERSION_DIR = /^\d+\.\d+\.\d+\.\d+$/;

export function getPlatform(): Platform {
  const platform = process.platform;
  if (platform === "win32" || platform === "darwin" || platform === "linux") {
    return platform;
  }
  throw new Error(`Unsupported platform: ${platform}`);
}

export function getArch(): "x64" | "arm64" {
  const arch = process.arch;
  if (arch === "x64" || arch === "arm64") {
    return arch;
  }
  throw new Error(`Unsupported architecture: ${arch}`);
}

/**
 * Compare two dotted version strings (e.g. "143.0.7499.170").
 * Returns a negative number if a < b, positive if a > b, 0 if equal.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * List version folders (e.g. "143.0.7499.170") inside a directory, newest first.
 */
export async function listVersionDirs(baseDir: string): Promise<string[]> {
  try {
    const entries = await readdir(baseDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && VERSION_DIR.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => compareVersions(b, a));
  } catch {
    return [];
  }
}

/**
 * Find `<baseDir>/<newest version>/<...subPath>` that exists as a directory.
 */
async function findInNewestVersion(
  baseDir: string,
  ...subPath: string[]
): Promise<string | null> {
  const log = getLogger();
  log.info(`Scanning for version folders in: ${baseDir}`);

  for (const version of await listVersionDirs(baseDir)) {
    const candidate = join(baseDir, version, ...subPath);
    log.info(`Checking path: ${candidate}`);
    if (await isDirectory(candidate)) {
      log.info(`✓ Found: ${candidate}`);
      return candidate;
    }
    log.info(`✗ Path does not exist: ${candidate}`);
  }

  return null;
}

/**
 * Home directory of the user we are fixing Helium for.
 * Under `sudo` on Linux this is the invoking user, not root.
 */
export function getUserHome(): string {
  const sudoUser = process.env.SUDO_USER;
  if (getPlatform() !== "linux" || process.getuid?.() !== 0 || !sudoUser) {
    return homedir();
  }

  try {
    const entry = execFileSync("getent", ["passwd", sudoUser], {
      encoding: "utf-8",
    });
    const home = entry.trim().split(":")[5];
    if (home) return home;
  } catch {
    // getent unavailable - fall back to the conventional location
  }
  return join("/home", sudoUser);
}

/**
 * uid/gid of the user who invoked `sudo`, so copied files can be handed back to them.
 */
export function getSudoOwner(): { uid: number; gid: number } | null {
  if (getPlatform() !== "linux" || process.getuid?.() !== 0) return null;
  const uid = Number(process.env.SUDO_UID);
  const gid = Number(process.env.SUDO_GID);
  if (!Number.isInteger(uid) || !Number.isInteger(gid)) return null;
  return { uid, gid };
}

function findChromeExecutable(): string | null {
  const log = getLogger();
  try {
    const chrome = new BrowserFinder().findBrowser("chrome");
    log.info(`Found Chrome executable at: ${chrome.path}`);
    return chrome.path;
  } catch {
    log.info("Chrome executable not found by browser-finder");
    return null;
  }
}

function windowsProgramDirs(...subPath: string[]): string[] {
  const roots = [
    process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"),
    process.env.ProgramFiles || "C:\\Program Files",
    process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
  ];
  return roots.map((root) => join(root, ...subPath));
}

async function findChromeWidevineWindows(
  chromeExe: string | null
): Promise<string | null> {
  const appDirs = windowsProgramDirs("Google", "Chrome", "Application");
  if (chromeExe) appDirs.unshift(dirname(chromeExe));

  for (const appDir of new Set(appDirs)) {
    const found = await findInNewestVersion(appDir, "WidevineCdm");
    if (found) return found;
  }
  return null;
}

async function findChromeWidevineMac(
  chromeExe: string | null
): Promise<string | null> {
  const contentsDir = chromeExe
    ? join(dirname(chromeExe), "..")
    : "/Applications/Google Chrome.app/Contents";
  const versionsPath = join(
    contentsDir,
    "Frameworks",
    "Google Chrome Framework.framework",
    "Versions"
  );
  return findInNewestVersion(versionsPath, "Libraries", "WidevineCdm");
}

async function findChromeWidevineLinux(
  chromeExe: string | null
): Promise<string | null> {
  const log = getLogger();
  const chromeDirs: string[] = [];

  if (chromeExe) {
    // chromeExe is often a wrapper script or symlink in /usr/bin -
    // resolve it to find the real install directory.
    try {
      const resolved = await realpath(chromeExe);
      if (resolved !== chromeExe) {
        log.info(`Resolved Chrome symlink to: ${resolved}`);
      }
      chromeDirs.push(dirname(resolved));
    } catch {
      chromeDirs.push(dirname(chromeExe));
    }
  }

  // Well-known Linux Chrome/Chromium installation directories
  chromeDirs.push(
    "/opt/google/chrome",
    "/opt/google/chrome-beta",
    "/opt/google/chrome-unstable",
    "/usr/lib/chromium",
    "/usr/lib/chromium-browser",
    "/usr/lib64/chromium-browser"
  );

  for (const chromeDir of new Set(chromeDirs)) {
    const directPath = join(chromeDir, "WidevineCdm");
    log.info(`Checking path: ${directPath}`);
    if (await isDirectory(directPath)) {
      log.info(`✓ Found WidevineCdm at: ${directPath}`);
      return directPath;
    }

    const found = await findInNewestVersion(chromeDir, "WidevineCdm");
    if (found) return found;
  }

  return null;
}

/**
 * Find Chrome's WidevineCdm directory on this machine.
 */
export async function findChromeWidevinePath(): Promise<string | null> {
  const chromeExe = findChromeExecutable();

  switch (getPlatform()) {
    case "win32":
      return findChromeWidevineWindows(chromeExe);
    case "darwin":
      return findChromeWidevineMac(chromeExe);
    case "linux":
      return findChromeWidevineLinux(chromeExe);
  }
}

/**
 * Find the newest Helium version folder, which receives WidevineCdm on
 * Windows and macOS. (Linux uses the profile folder instead - see
 * findHeliumUserDataDir.)
 */
export async function findHeliumVersionPath(): Promise<string | null> {
  const log = getLogger();

  if (getPlatform() === "darwin") {
    const versionsPath = join(
      "/Applications",
      "Helium.app",
      "Contents",
      "Frameworks",
      "Helium Framework.framework",
      "Versions"
    );
    return findInNewestVersion(versionsPath, "Libraries");
  }

  // Windows: per-user install first, then an install for all users
  for (const appDir of windowsProgramDirs("imput", "Helium", "Application")) {
    log.info(`Checking Helium base path: ${appDir}`);
    const newest = (await listVersionDirs(appDir))[0];
    if (newest) {
      const versionPath = join(appDir, newest);
      log.info(`✓ Found Helium version folder: ${versionPath}`);
      return versionPath;
    }
    log.info(`✗ No Helium version folder in: ${appDir}`);
  }

  return null;
}

/**
 * Find Helium's user data (profile) directory on Linux.
 * Chromium on Linux loads WidevineCdm from here using the component updater
 * layout, which works for every install type (AppImage, tarball, distro package).
 */
export async function findHeliumUserDataDir(): Promise<string | null> {
  const log = getLogger();
  const home = getUserHome();
  const configHome =
    (home === homedir() && process.env.XDG_CONFIG_HOME) || join(home, ".config");

  const candidates = [
    join(configHome, "net.imput.helium"),
    join(configHome, "Helium"),
    join(configHome, "helium"),
  ];

  for (const dir of candidates) {
    log.info(`Checking Helium user data dir: ${dir}`);
    if (await isDirectory(dir)) {
      log.info(`✓ Found Helium user data dir: ${dir}`);
      return dir;
    }
    log.info(`✗ Path does not exist: ${dir}`);
  }

  return null;
}

/**
 * Get download asset pattern for Chrome installer
 * Returns a regex pattern to match the correct asset (version is dynamic)
 */
export function getChromeAssetPattern(): RegExp {
  const platform = getPlatform();
  const arch = getArch();

  if (platform === "win32") {
    // Pattern: x64_143.0.7499.170_chrome_installer_uncompressed.exe
    const archPrefix = arch === "arm64" ? "arm64" : "x64";
    return new RegExp(
      `^${archPrefix}_[\\d.]+_chrome_installer_uncompressed\\.exe$`
    );
  }

  // This GitHub repo only has Windows builds
  throw new Error(
    "Chrome download is only supported on Windows. Linux uses Google's .deb package instead."
  );
}
