import { BrowserFinder } from "@agent-infra/browser-finder";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { readdir, stat, realpath } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { getLogger } from "./logger";
import { findAppPath, findInstallLocations, findRunningExecutables } from "./windows";

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

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

const WIDEVINE_LIBRARY: Record<Platform, string> = {
  win32: "widevinecdm.dll",
  linux: "libwidevinecdm.so",
  darwin: "libwidevinecdm.dylib",
};

/**
 * A usable WidevineCdm folder has a manifest.json and the CDM library for
 * this OS under _platform_specific/<os>_<arch>/. Browsers sometimes leave
 * empty WidevineCdm folders behind, so we check before copying.
 */
export async function isValidWidevine(dir: string): Promise<boolean> {
  if (!(await isFile(join(dir, "manifest.json")))) return false;

  const library = WIDEVINE_LIBRARY[getPlatform()];
  try {
    const platformDirs = await readdir(join(dir, "_platform_specific"));
    for (const platformDir of platformDirs) {
      if (await isFile(join(dir, "_platform_specific", platformDir, library))) {
        return true;
      }
    }
  } catch {
    // no _platform_specific folder (macOS .plugin layout) - manifest is enough
    return getPlatform() === "darwin";
  }
  return false;
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
    const found =
      subPath.at(-1) === "WidevineCdm"
        ? await isValidWidevine(candidate)
        : await isDirectory(candidate);
    if (found) {
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
  const appDirs = [
    ...(chromeExe ? [dirname(chromeExe)] : []),
    ...(await findAppPath("chrome.exe")).filter((dir) => !/helium/i.test(dir)),
    ...windowsProgramDirs("Google", "Chrome", "Application"),
  ];

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
    if (await isValidWidevine(directPath)) {
      log.info(`✓ Found WidevineCdm at: ${directPath}`);
      return directPath;
    }

    const found = await findInNewestVersion(chromeDir, "WidevineCdm");
    if (found) return found;
  }

  return null;
}

/**
 * Widevine that Chromium browsers downloaded into their profile folders
 * (<profile>/WidevineCdm/<version>/). Edge ships with every Windows install,
 * so this often saves downloading Chrome.
 */
async function findWidevineInBrowserProfiles(): Promise<string | null> {
  const home = getUserHome();
  const profiles =
    getPlatform() === "win32"
      ? [
          ["Google", "Chrome", "User Data"],
          ["Microsoft", "Edge", "User Data"],
          ["BraveSoftware", "Brave-Browser", "User Data"],
          ["Vivaldi", "User Data"],
          ["Chromium", "User Data"],
        ].map((p) =>
          join(process.env.LOCALAPPDATA || join(home, "AppData", "Local"), ...p)
        )
      : [
          join(home, ".config", "google-chrome"),
          join(home, ".config", "chromium"),
          join(home, ".config", "microsoft-edge"),
          join(home, ".config", "BraveSoftware", "Brave-Browser"),
          join(home, ".config", "vivaldi"),
          join(home, "snap", "chromium", "common", "chromium"),
          join(home, ".var", "app", "com.google.Chrome", "config", "google-chrome"),
          join(home, ".var", "app", "org.chromium.Chromium", "config", "chromium"),
        ];

  for (const profile of profiles) {
    const found = await findInNewestVersion(join(profile, "WidevineCdm"));
    if (found && (await isValidWidevine(found))) return found;
  }
  return null;
}

/**
 * Find a WidevineCdm folder on this machine: Chrome's own copy first, then
 * copies other Chromium browsers downloaded into their profiles.
 */
export async function findChromeWidevinePath(): Promise<string | null> {
  const chromeExe = findChromeExecutable();

  let found: string | null;
  switch (getPlatform()) {
    case "win32":
      found = await findChromeWidevineWindows(chromeExe);
      break;
    case "darwin":
      return findChromeWidevineMac(chromeExe);
    case "linux":
      found = await findChromeWidevineLinux(chromeExe);
      break;
  }

  return found ?? (await findWidevineInBrowserProfiles());
}

/**
 * The folder holding chrome.dll in a Helium install - that is where Chromium
 * looks for a bundled WidevineCdm. Installed Helium keeps it in
 * Application\<version>\, the portable zip keeps it next to chrome.exe.
 */
async function findHeliumModuleDir(appDir: string): Promise<string | null> {
  if (await isFile(join(appDir, "chrome.dll"))) return appDir;

  const versions = await listVersionDirs(appDir);
  for (const version of versions) {
    if (await isFile(join(appDir, version, "chrome.dll"))) {
      return join(appDir, version);
    }
  }
  return versions[0] ? join(appDir, versions[0]) : null;
}

/**
 * Portable Helium unpacked into a common folder,
 * e.g. Downloads\helium_0.19.4.1_x64-windows\.
 */
async function findPortableHeliumDirs(): Promise<string[]> {
  const home = homedir();
  const roots = [
    join(home, "Downloads"),
    join(home, "Desktop"),
    join(home, "Documents"),
    home,
    join(process.env.LOCALAPPDATA || join(home, "AppData", "Local"), "Programs"),
    process.env.ProgramFiles || "C:\\Program Files",
    "C:\\",
  ];

  const dirs: string[] = [];
  for (const root of roots) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !/helium/i.test(entry.name)) continue;
      const dir = join(root, entry.name);
      // The zip may have been extracted into a folder of the same name
      for (const candidate of [dir, ...(await subDirs(dir))]) {
        if (await isFile(join(candidate, "chrome.exe"))) dirs.push(candidate);
      }
    }
  }
  return dirs;
}

async function subDirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => join(dir, e.name));
  } catch {
    return [];
  }
}

/**
 * Windows: find Helium from its usual install folders, the registry, a
 * running Helium window, or a portable copy - in that order.
 */
async function findHeliumWindows(): Promise<string | null> {
  const log = getLogger();

  const sources: Array<[string, () => Promise<string[]>]> = [
    ["install folders", async () => windowsProgramDirs("imput", "Helium", "Application")],
    ["registry", () => findInstallLocations(/^Helium\b/i)],
    [
      "running processes",
      async () =>
        (await findRunningExecutables("chrome.exe"))
          .filter((exe) => /helium/i.test(exe))
          .map((exe) => dirname(exe)),
    ],
    ["portable folders", findPortableHeliumDirs],
  ];

  const checked = new Set<string>();
  for (const [source, getDirs] of sources) {
    log.info(`Looking for Helium in ${source}`);
    for (const appDir of await getDirs()) {
      if (checked.has(appDir.toLowerCase())) continue;
      checked.add(appDir.toLowerCase());

      log.info(`Checking Helium folder: ${appDir}`);
      const moduleDir = await findHeliumModuleDir(appDir);
      if (moduleDir) {
        log.info(`✓ Found Helium at: ${moduleDir}`);
        return moduleDir;
      }
    }
  }

  return null;
}

/**
 * Find the Helium folder that receives WidevineCdm on Windows and macOS.
 * (Linux uses the profile folder instead - see findHeliumUserDataDir.)
 */
export async function findHeliumVersionPath(): Promise<string | null> {
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

  return findHeliumWindows();
}

/**
 * Linux: is Helium installed? Checks distro packages (/opt/helium), the
 * binary on PATH, and AppImages in the usual folders.
 */
export async function findHeliumLinuxInstall(): Promise<string | null> {
  const log = getLogger();
  const home = getUserHome();

  const binaries = [
    "/opt/helium/helium",
    "/opt/helium-browser-bin/helium",
    "/usr/bin/helium",
    "/usr/bin/helium-browser",
    join(home, ".local", "bin", "helium"),
    ...(process.env.PATH ?? "").split(":").map((dir) => join(dir, "helium")),
  ];
  for (const binary of binaries) {
    if (await isFile(binary)) {
      log.info(`✓ Found Helium binary: ${binary}`);
      return binary;
    }
  }

  for (const dir of ["Applications", "Downloads", "Desktop", ".local/bin", "bin", "AppImages"]) {
    try {
      const entries = await readdir(join(home, dir));
      const appImage = entries.find((name) => /helium.*\.appimage$/i.test(name));
      if (appImage) {
        log.info(`✓ Found Helium AppImage: ${join(home, dir, appImage)}`);
        return join(home, dir, appImage);
      }
    } catch {
      // folder doesn't exist
    }
  }

  return null;
}

/**
 * Helium's profile folder on Linux, used when Helium has never been opened.
 */
export function getDefaultHeliumUserDataDir(): string {
  return join(getUserHome(), ".config", "net.imput.helium");
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
