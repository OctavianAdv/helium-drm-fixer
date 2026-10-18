import { join, basename, relative, sep } from "node:path";
import { homedir } from "node:os";
import { readdir, readFile, stat, realpath, mkdir, copyFile, writeFile, rm, open } from "node:fs/promises";
import { getLogger } from "./logger";
import {
  compareVersions,
  findChromeWidevinePath,
  getArch,
  getPlatform,
  getUserHome,
  listVersionDirs,
  type Platform,
} from "./paths";
import { copyDir } from "./utils";

export interface WidevineSource {
  /** Browser or app it came from, e.g. "Microsoft Edge" */
  name: string;
  /** Folder holding manifest.json */
  path: string;
  /** CDM version from manifest.json, e.g. "4.10.3112.0" */
  version: string;
  /** "chromium": _platform_specific/<os>_<arch>/ layout; "flat": library next to manifest (Firefox) */
  layout: "chromium" | "flat";
}

const LIBRARY: Record<Platform, string> = {
  win32: "widevinecdm.dll",
  linux: "libwidevinecdm.so",
  darwin: "libwidevinecdm.dylib",
};

const OS_NAME: Record<Platform, string> = { win32: "win", linux: "linux", darwin: "mac" };

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
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
 * CPU architecture a CDM library was built for, read from its PE (Windows)
 * or ELF (Linux) header. A CDM only works in a browser of the same architecture.
 */
export async function detectLibraryArch(libraryPath: string): Promise<"x64" | "arm64" | "x86" | null> {
  let file;
  try {
    file = await open(libraryPath, "r");
    const header = Buffer.alloc(512);
    await file.read(header, 0, 512, 0);

    if (header.toString("latin1", 0, 2) === "MZ") {
      const peOffset = header.readUInt32LE(0x3c);
      const peHeader = Buffer.alloc(6);
      await file.read(peHeader, 0, 6, peOffset);
      if (peHeader.toString("latin1", 0, 4) !== "PE\0\0") return null;
      const machine = peHeader.readUInt16LE(4);
      return machine === 0x8664 ? "x64" : machine === 0xaa64 ? "arm64" : machine === 0x14c ? "x86" : null;
    }

    if (header.toString("latin1", 0, 4) === "\x7fELF") {
      const machine = header.readUInt16LE(0x12);
      return machine === 62 ? "x64" : machine === 183 ? "arm64" : machine === 3 ? "x86" : null;
    }
  } catch {
    // unreadable - treat as unknown
  } finally {
    await file?.close();
  }
  return null;
}

/**
 * Path of the CDM library inside a Widevine folder, for either layout.
 */
export async function findWidevineLibrary(dir: string): Promise<string | null> {
  const library = LIBRARY[getPlatform()];
  for (const platformDir of await subDirs(join(dir, "_platform_specific"))) {
    if (await isFile(join(platformDir, library))) return join(platformDir, library);
  }
  return (await isFile(join(dir, library))) ? join(dir, library) : null;
}

/**
 * Read a Widevine folder. Returns null unless it has a manifest with a
 * version and a CDM library for this OS and CPU.
 */
export async function readWidevine(
  dir: string,
  name: string,
  targetArch: "x64" | "arm64" = getArch()
): Promise<WidevineSource | null> {
  let manifest: { version?: string };
  try {
    manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf-8"));
  } catch {
    return null;
  }
  if (!manifest.version) return null;

  const library = await findWidevineLibrary(dir);
  if (!library) return null;

  const arch = await detectLibraryArch(library);
  if (arch && arch !== targetArch) {
    getLogger().info(`✗ Skipping ${dir}: built for ${arch}, Helium is ${targetArch}`);
    return null;
  }

  return {
    name,
    path: dir,
    version: manifest.version,
    layout: library.includes("_platform_specific") ? "chromium" : "flat",
  };
}

// ---------------------------------------------------------------------------
// Where browsers and apps keep Widevine
// ---------------------------------------------------------------------------

/** <userData>/WidevineCdm/<version>/ - Chromium's component updater */
async function profileCopies(userDataDir: string): Promise<string[]> {
  const base = join(userDataDir, "WidevineCdm");
  return (await listVersionDirs(base)).map((v) => join(base, v));
}

/** <appDir>/WidevineCdm or <appDir>/<version>/WidevineCdm - bundled with the browser */
async function installCopies(appDir: string): Promise<string[]> {
  return [
    join(appDir, "WidevineCdm"),
    ...(await listVersionDirs(appDir)).map((v) => join(appDir, v, "WidevineCdm")),
  ];
}

/** <profiles>/<profile>/gmp-widevinecdm/<version>/ - Firefox and its forks */
async function firefoxCopies(profilesRoot: string): Promise<string[]> {
  const copies: string[] = [];
  for (const profile of await subDirs(profilesRoot)) {
    const base = join(profile, "gmp-widevinecdm");
    copies.push(...(await listVersionDirs(base)).map((v) => join(base, v)));
  }
  return copies;
}

/** Folders matching a pattern, e.g. Windows Store app folders "Name_8wekyb3d8bbwe" */
async function matchingDirs(parent: string, pattern: RegExp): Promise<string[]> {
  return (await subDirs(parent)).filter((dir) => pattern.test(basename(dir)));
}

type Location = [name: string, find: () => Promise<string[]>];

function windowsLocations(): Location[] {
  const home = homedir();
  const local = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
  const roaming = process.env.APPDATA || join(home, "AppData", "Roaming");
  const programs = process.env.ProgramFiles || "C:\\Program Files";
  const programsX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const packages = join(local, "Packages");

  const chromium = (name: string, userData: string, ...appDirs: string[]): Location => [
    name,
    async () => [
      ...(await profileCopies(userData)),
      ...(await Promise.all(appDirs.map(installCopies))).flat(),
    ],
  ];
  const firefox = (name: string, ...roots: string[]): Location => [
    name,
    async () => (await Promise.all(roots.map(firefoxCopies))).flat(),
  ];
  const storeApp = async (pattern: RegExp, ...subPath: string[]) =>
    (await matchingDirs(packages, pattern)).map((dir) => join(dir, ...subPath));

  return [
    ["Google Chrome", async () => {
      const installed = await findChromeWidevinePath();
      return [...(installed ? [installed] : []), ...(await profileCopies(join(local, "Google", "Chrome", "User Data")))];
    }],
    chromium("Chrome Beta", join(local, "Google", "Chrome Beta", "User Data"), join(programs, "Google", "Chrome Beta", "Application"), join(local, "Google", "Chrome Beta", "Application")),
    chromium("Chrome Dev", join(local, "Google", "Chrome Dev", "User Data"), join(programs, "Google", "Chrome Dev", "Application"), join(local, "Google", "Chrome Dev", "Application")),
    chromium("Chrome Canary", join(local, "Google", "Chrome SxS", "User Data"), join(local, "Google", "Chrome SxS", "Application")),
    chromium("Microsoft Edge", join(local, "Microsoft", "Edge", "User Data"), join(programsX86, "Microsoft", "Edge", "Application")),
    chromium("Edge Beta", join(local, "Microsoft", "Edge Beta", "User Data")),
    chromium("Edge Dev", join(local, "Microsoft", "Edge Dev", "User Data")),
    chromium("Edge Canary", join(local, "Microsoft", "Edge SxS", "User Data")),
    chromium("Brave", join(local, "BraveSoftware", "Brave-Browser", "User Data"), join(programs, "BraveSoftware", "Brave-Browser", "Application"), join(local, "BraveSoftware", "Brave-Browser", "Application")),
    chromium("Brave Beta", join(local, "BraveSoftware", "Brave-Browser-Beta", "User Data")),
    chromium("Brave Nightly", join(local, "BraveSoftware", "Brave-Browser-Nightly", "User Data")),
    chromium("Vivaldi", join(local, "Vivaldi", "User Data"), join(local, "Vivaldi", "Application"), join(programs, "Vivaldi", "Application")),
    chromium("Opera", join(roaming, "Opera Software", "Opera Stable"), join(local, "Programs", "Opera")),
    chromium("Opera GX", join(roaming, "Opera Software", "Opera GX Stable"), join(local, "Programs", "Opera GX")),
    chromium("Opera Air", join(roaming, "Opera Software", "Opera Air Stable"), join(local, "Programs", "Opera Air")),
    chromium("Yandex Browser", join(local, "Yandex", "YandexBrowser", "User Data"), join(local, "Yandex", "YandexBrowser", "Application")),
    chromium("Chromium", join(local, "Chromium", "User Data"), join(local, "Chromium", "Application")),
    chromium("Thorium", join(local, "Thorium", "User Data"), join(local, "Thorium", "Application")),
    chromium("Supermium", join(local, "Supermium", "User Data"), join(programs, "Supermium")),
    chromium("Cent Browser", join(local, "CentBrowser", "User Data"), join(local, "CentBrowser", "Application")),
    ["Arc", async () => (await Promise.all(
      (await storeApp(/^TheBrowserCompany\.Arc_/, "LocalCache", "Local", "Arc", "User Data")).map(profileCopies)
    )).flat()],
    firefox("Firefox", join(roaming, "Mozilla", "Firefox", "Profiles")),
    firefox("LibreWolf", join(roaming, "librewolf", "Profiles")),
    firefox("Waterfox", join(roaming, "Waterfox", "Profiles")),
    firefox("Floorp", join(roaming, "Floorp", "Profiles")),
    firefox("Zen Browser", join(roaming, "zen", "Profiles")),
    ["Firefox (Microsoft Store)", async () => (await Promise.all(
      (await storeApp(/^Mozilla\.Firefox_/, "LocalCache", "Roaming", "Mozilla", "Firefox", "Profiles")).map(firefoxCopies)
    )).flat()],
    ["Spotify", async () => [
      ...(await profileCopies(join(local, "Spotify"))),
      ...(await Promise.all(
        (await storeApp(/^SpotifyAB\.SpotifyMusic_/, "LocalState", "Spotify")).map(profileCopies)
      )).flat(),
    ]],
  ];
}

function linuxLocations(): Location[] {
  const home = getUserHome();
  const config = join(home, ".config");
  const flatpak = (...p: string[]) => join(home, ".var", "app", ...p);

  const chromium = (name: string, userDataDirs: string[], appDirs: string[] = []): Location => [
    name,
    async () => [
      ...(await Promise.all(userDataDirs.map(profileCopies))).flat(),
      ...(await Promise.all(appDirs.map(installCopies))).flat(),
    ],
  ];
  const firefox = (name: string, ...roots: string[]): Location => [
    name,
    async () => (await Promise.all(roots.map(firefoxCopies))).flat(),
  ];

  return [
    ["Google Chrome", async () => {
      const installed = await findChromeWidevinePath();
      return [
        ...(installed ? [installed] : []),
        ...(await profileCopies(join(config, "google-chrome"))),
        ...(await profileCopies(flatpak("com.google.Chrome", "config", "google-chrome"))),
      ];
    }],
    chromium("Chrome Beta", [join(config, "google-chrome-beta")], ["/opt/google/chrome-beta"]),
    chromium("Chrome Dev", [join(config, "google-chrome-unstable")], ["/opt/google/chrome-unstable"]),
    chromium("Microsoft Edge",
      [join(config, "microsoft-edge"), flatpak("com.microsoft.Edge", "config", "microsoft-edge")],
      ["/opt/microsoft/msedge"]),
    chromium("Edge Beta", [join(config, "microsoft-edge-beta")], ["/opt/microsoft/msedge-beta"]),
    chromium("Edge Dev", [join(config, "microsoft-edge-dev")], ["/opt/microsoft/msedge-dev"]),
    chromium("Brave",
      [
        join(config, "BraveSoftware", "Brave-Browser"),
        flatpak("com.brave.Browser", "config", "BraveSoftware", "Brave-Browser"),
        join(home, "snap", "brave", "current", ".config", "BraveSoftware", "Brave-Browser"),
      ],
      ["/opt/brave.com/brave"]),
    chromium("Brave Beta", [join(config, "BraveSoftware", "Brave-Browser-Beta")], ["/opt/brave.com/brave-beta"]),
    chromium("Brave Nightly", [join(config, "BraveSoftware", "Brave-Browser-Nightly")], ["/opt/brave.com/brave-nightly"]),
    chromium("Vivaldi",
      [join(config, "vivaldi"), join(config, "vivaldi-snapshot"), flatpak("com.vivaldi.Vivaldi", "config", "vivaldi")],
      ["/opt/vivaldi", "/opt/vivaldi-snapshot"]),
    chromium("Opera",
      [join(config, "opera"), join(config, "opera-beta"), join(config, "opera-developer"), flatpak("com.opera.Opera", "config", "opera")],
      ["/usr/lib/x86_64-linux-gnu/opera", "/usr/lib64/opera", "/usr/lib/opera"]),
    chromium("Yandex Browser", [join(config, "yandex-browser"), join(config, "yandex-browser-beta")], ["/opt/yandex/browser", "/opt/yandex/browser-beta"]),
    chromium("Chromium",
      [
        join(config, "chromium"),
        join(home, "snap", "chromium", "common", "chromium"),
        flatpak("org.chromium.Chromium", "config", "chromium"),
      ],
      ["/usr/lib/chromium", "/usr/lib/chromium-browser", "/usr/lib64/chromium-browser"]),
    chromium("Thorium", [join(config, "thorium")], ["/opt/chromium.org/thorium"]),
    firefox("Firefox",
      join(home, ".mozilla", "firefox"),
      join(home, "snap", "firefox", "common", ".mozilla", "firefox"),
      flatpak("org.mozilla.firefox", ".mozilla", "firefox")),
    firefox("LibreWolf", join(home, ".librewolf"), flatpak("io.gitlab.librewolf-community", ".librewolf")),
    firefox("Waterfox", join(home, ".waterfox")),
    firefox("Floorp", join(home, ".floorp"), flatpak("one.ablaze.floorp", ".floorp")),
    firefox("Zen Browser", join(home, ".zen"), flatpak("app.zen_browser.zen", ".zen")),
  ];
}

// ---------------------------------------------------------------------------
// Apps that embed Chromium (Spotify, OBS, WebView2 apps, ...) keep their own
// WidevineCdm folders. We look for them only when no browser has Widevine.
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  "node_modules", "temp", "tmp", "cache", "caches", "code cache", "gpucache",
  "npm-cache", "pip", "inetcache", "crashpad", "logs", ".git", "service worker",
  "indexeddb", "local storage", "session storage", "extensions",
]);

async function scanForWidevineFolders(root: string, maxDepth: number, found: string[] = [], depth = 0): Promise<string[]> {
  if (depth > maxDepth) return found;
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    if (entry.name === "WidevineCdm" || entry.name === "gmp-widevinecdm") {
      found.push(dir);
    } else if (!SKIP_DIRS.has(entry.name.toLowerCase())) {
      await scanForWidevineFolders(dir, maxDepth, found, depth + 1);
    }
  }
  return found;
}

/** "C:\Users\me\AppData\Local\Packages\Microsoft.Windows.Photos_8wek...\..." -> "Microsoft.Windows.Photos" */
function appNameFromPath(root: string, dir: string): string {
  const parts = relative(root, dir).split(sep);
  const first = parts[0] === "Packages" && parts[1] ? parts[1] : parts[0] ?? dir;
  const name = first.replace(/_[a-z0-9]{13}$/i, "").replace(/^\./, "");
  return parts.includes("EBWebView") ? `${name} (WebView2)` : name;
}

async function appLocations(): Promise<Location[]> {
  const home = getUserHome();
  const roots =
    getPlatform() === "win32"
      ? [
          [process.env.LOCALAPPDATA || join(home, "AppData", "Local"), 5] as const,
          [process.env.APPDATA || join(home, "AppData", "Roaming"), 4] as const,
        ]
      : [
          [join(home, ".config"), 4] as const,
          [join(home, ".local", "share"), 4] as const,
          [join(home, ".var", "app"), 5] as const,
          [join(home, "snap"), 5] as const,
        ];

  const locations: Location[] = [];
  for (const [root, depth] of roots) {
    for (const dir of await scanForWidevineFolders(root, depth)) {
      locations.push([
        appNameFromPath(root, dir),
        async () => [dir, ...(await listVersionDirs(dir)).map((v) => join(dir, v))],
      ]);
    }
  }
  return locations;
}

// ---------------------------------------------------------------------------

function isHeliumPath(path: string): boolean {
  return /helium|net\.imput/i.test(path);
}

async function collect(
  locations: Location[],
  sources: WidevineSource[],
  seen: Set<string>,
  arch: "x64" | "arm64"
) {
  const log = getLogger();
  for (const [name, find] of locations) {
    for (const dir of await find()) {
      if (isHeliumPath(dir)) continue;
      let key: string;
      try {
        key = (await realpath(dir)).toLowerCase();
      } catch {
        continue; // doesn't exist
      }
      if (seen.has(key)) continue;
      seen.add(key);

      const source = await readWidevine(dir, name, arch);
      if (source) {
        log.info(`✓ Widevine ${source.version} from ${name}: ${dir}`);
        sources.push(source);
      }
    }
  }
}

/**
 * Every usable Widevine copy on this machine, best first: newest version,
 * then browsers in the order listed (Chrome first).
 */
export async function findWidevineSources(
  options: { includeApps?: boolean; arch?: "x64" | "arm64" } = {}
): Promise<WidevineSource[]> {
  const arch = options.arch ?? getArch();
  const sources: WidevineSource[] = [];
  const seen = new Set<string>();

  if (getPlatform() === "darwin") {
    const chrome = await findChromeWidevinePath();
    const source = chrome ? await readWidevine(chrome, "Google Chrome", arch) : null;
    return source ? [source] : [];
  }

  await collect(getPlatform() === "win32" ? windowsLocations() : linuxLocations(), sources, seen, arch);
  if (options.includeApps || sources.length === 0) {
    await collect(await appLocations(), sources, seen, arch);
  }

  // Array.sort is stable, so equal versions keep the browser order above
  return sources.sort((a, b) => compareVersions(b.version, a.version));
}

// ---------------------------------------------------------------------------
// Installing into Helium
// ---------------------------------------------------------------------------

/** Manifest fields Chromium needs to register a CDM. Firefox's copy may lack them. */
const CHROMIUM_CDM_DEFAULTS = {
  "x-cdm-module-versions": "4",
  "x-cdm-interface-versions": "10",
  "x-cdm-host-versions": "10,11",
  "x-cdm-codecs": "vp8,vp09,avc1,av01",
  "x-cdm-persistent-license-support": false,
  "x-cdm-supported-encryption-schemes": ["cenc", "cbcs"],
};

/**
 * Copy a Widevine source to `dest` in the layout Chromium (Helium) expects.
 * Firefox-style flat folders are converted to WidevineCdm/_platform_specific/<os>_<arch>/.
 */
export async function installWidevine(source: WidevineSource, dest: string): Promise<void> {
  if (source.layout === "chromium") {
    await copyDir(source.path, dest);
    return;
  }

  const library = (await findWidevineLibrary(source.path))!;
  const arch = (await detectLibraryArch(library)) ?? getArch();
  const platformDir = join(dest, "_platform_specific", `${OS_NAME[getPlatform()]}_${arch}`);

  await rm(dest, { recursive: true, force: true });
  await mkdir(platformDir, { recursive: true });

  await copyFile(library, join(platformDir, basename(library)));
  if (await isFile(`${library}.sig`)) {
    await copyFile(`${library}.sig`, join(platformDir, `${basename(library)}.sig`));
  }
  for (const license of ["LICENSE", "LICENSE.txt"]) {
    if (await isFile(join(source.path, license))) {
      await copyFile(join(source.path, license), join(dest, "LICENSE"));
      break;
    }
  }

  const manifest = JSON.parse(await readFile(join(source.path, "manifest.json"), "utf-8"));
  await writeFile(
    join(dest, "manifest.json"),
    JSON.stringify({ name: "WidevineCdm", ...CHROMIUM_CDM_DEFAULTS, ...manifest }, null, 2)
  );
}
