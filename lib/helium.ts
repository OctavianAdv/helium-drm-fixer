import { join, dirname, basename } from "node:path";
import { homedir } from "node:os";
import { readdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  findHeliumLinuxInstall,
  findHeliumUserDataDirs,
  findHeliumVersionPath,
  findHeliumWindowsAll,
  getArch,
  getDefaultHeliumUserDataDir,
  getPlatform,
  getSudoOwner,
  listVersionDirs,
} from "./paths";
import { detectLibraryArch, installWidevine, readWidevine, type WidevineSource } from "./widevine";
import { getLogger } from "./logger";

const execFileAsync = promisify(execFile);

/**
 * One Helium installation we can fix.
 *
 * - Windows/macOS: `dir` is the folder holding Helium's chrome.dll / framework
 *   libraries; Widevine goes in `<dir>/WidevineCdm`.
 * - Linux: `dir` is Helium's profile folder; Widevine goes in
 *   `<dir>/WidevineCdm/<version>/` plus a hint file (Chromium's component layout).
 */
export interface HeliumInstall {
  dir: string;
  /** Program to start Helium with (for --verify and reopening), if known */
  executable: string | null;
  /** CPU Helium is built for - the Widevine copy must match it */
  arch: "x64" | "arm64";
  /** Helium's version, if known (e.g. "0.19.4.1") */
  version: string | null;
  /** Linux: the profile doesn't exist yet and will be created */
  newProfile?: boolean;
  /** macOS: the Helium.app bundle (re-signed after changes) */
  appBundle?: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function heliumVersion(dir: string): Promise<string | null> {
  try {
    const manifest = (await readdir(dir)).find((f) => /^\d+\.\d+\.\d+\.\d+\.manifest$/.test(f));
    return manifest ? manifest.replace(/\.manifest$/, "") : null;
  } catch {
    return null;
  }
}

function asArch(arch: string | null): "x64" | "arm64" | null {
  return arch === "x64" || arch === "arm64" ? arch : null;
}

async function describeWindows(dir: string): Promise<HeliumInstall> {
  // Installed: ...\Application\<version>\chrome.dll, chrome.exe one level up
  const appRoot = /^\d+\.\d+\.\d+\.\d+$/.test(basename(dir)) ? dirname(dir) : dir;
  const executable = join(appRoot, "chrome.exe");
  return {
    dir,
    executable: (await exists(executable)) ? executable : null,
    arch: asArch(await detectLibraryArch(join(dir, "chrome.dll"))) ?? getArch(),
    version: (await heliumVersion(dir)) ?? (await heliumVersion(appRoot)),
  };
}

async function describeLinux(profileDir: string, newProfile = false): Promise<HeliumInstall> {
  const executable = await findHeliumLinuxInstall();
  return {
    dir: profileDir,
    executable,
    arch: (executable && asArch(await detectLibraryArch(executable))) || getArch(),
    version: null,
    newProfile,
  };
}

// ---------------------------------------------------------------------------
// macOS: Helium.app/Contents/Frameworks/Helium Framework.framework/Versions/<v>/Libraries
// ---------------------------------------------------------------------------

const MAC_BUNDLE_ID = "net.imput.helium";

async function findMacHeliumApps(): Promise<string[]> {
  const candidates = ["/Applications/Helium.app", join(homedir(), "Applications", "Helium.app")];

  // A running Helium, wherever it lives
  try {
    const { stdout } = await execFileAsync("ps", ["-axo", "comm="]);
    for (const line of stdout.split("\n")) {
      const match = line.trim().match(/^(.*\.app)\/Contents\/MacOS\/Helium$/);
      if (match) candidates.push(match[1]!);
    }
  } catch {
    // ps unavailable
  }

  // Spotlight: any app with Helium's bundle ID
  try {
    const { stdout } = await execFileAsync("mdfind", [`kMDItemCFBundleIdentifier == '${MAC_BUNDLE_ID}'`]);
    candidates.push(...stdout.split("\n").map((l) => l.trim()).filter((l) => l.endsWith(".app")));
  } catch {
    // Spotlight unavailable
  }

  const found: string[] = [];
  for (const app of candidates) {
    if (!found.includes(app) && (await exists(join(app, "Contents", "MacOS", "Helium")))) found.push(app);
  }
  return found;
}

async function describeMac(app: string): Promise<HeliumInstall | null> {
  const versions = join(app, "Contents", "Frameworks", "Helium Framework.framework", "Versions");
  const newest = (await listVersionDirs(versions))[0];
  if (!newest) return null;
  const executable = join(app, "Contents", "MacOS", "Helium");

  let version: string | null = null;
  try {
    const plist = await readFile(join(app, "Contents", "Info.plist"), "utf-8");
    version = plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)?.[1] ?? null;
  } catch {
    // no readable Info.plist
  }

  return {
    dir: join(versions, newest, "Libraries"),
    executable,
    arch: asArch(await detectLibraryArch(executable)) ?? getArch(),
    version,
    appBundle: app,
  };
}

/**
 * Find Helium installs: the first one, or every one with `all`.
 * `heliumPath` overrides detection.
 */
export async function findHeliumInstalls(options: { heliumPath?: string; all?: boolean } = {}): Promise<HeliumInstall[]> {
  const platform = getPlatform();

  if (platform === "linux") {
    if (options.heliumPath) return [await describeLinux(options.heliumPath)];
    const profiles = await findHeliumUserDataDirs();
    if (profiles.length) {
      return Promise.all((options.all ? profiles : profiles.slice(0, 1)).map((p) => describeLinux(p)));
    }
    // Installed but never opened: we'll create the profile folder
    if (await findHeliumLinuxInstall()) return [await describeLinux(getDefaultHeliumUserDataDir(), true)];
    return [];
  }

  if (platform === "darwin") {
    if (options.heliumPath) {
      // Either Helium.app itself, or the Libraries folder inside it
      const app = options.heliumPath.match(/^(.*?\.app)(\/|$)/)?.[1];
      if (app && /\.app\/?$/.test(options.heliumPath)) {
        const install = await describeMac(app);
        return install ? [install] : [];
      }
      const described = app ? await describeMac(app) : null;
      return [{ ...(described ?? { executable: null, arch: getArch(), version: null }), dir: options.heliumPath, appBundle: app }];
    }
    const apps = await findMacHeliumApps();
    const installs = (await Promise.all((options.all ? apps : apps.slice(0, 1)).map(describeMac)))
      .filter((i): i is HeliumInstall => i !== null);
    return installs;
  }

  const dirs = options.heliumPath
    ? [options.heliumPath]
    : await findHeliumWindowsAll(!options.all);
  return Promise.all(dirs.map(describeWindows));
}

/** Where a given Widevine version goes in this Helium. */
export function widevineDestination(install: HeliumInstall, cdmVersion: string): string {
  return getPlatform() === "linux"
    ? join(install.dir, "WidevineCdm", cdmVersion)
    : join(install.dir, "WidevineCdm");
}

/** The Widevine currently installed in this Helium, if any. */
export async function installedWidevine(install: HeliumInstall): Promise<WidevineSource | null> {
  if (getPlatform() !== "linux") {
    return readWidevine(join(install.dir, "WidevineCdm"), "Helium", install.arch);
  }

  // Linux: the hint file says which version Chromium will load
  const root = join(install.dir, "WidevineCdm");
  try {
    const hint = JSON.parse(await readFile(join(root, "latest-component-updated-widevine-cdm"), "utf-8"));
    if (hint.Path) {
      const fromHint = await readWidevine(hint.Path, "Helium", install.arch);
      if (fromHint) return fromHint;
    }
  } catch {
    // no hint file
  }
  const newest = (await listVersionDirs(root))[0];
  return newest ? readWidevine(join(root, newest), "Helium", install.arch) : null;
}

/** Install a Widevine source into this Helium (including the Linux hint file and sudo ownership). */
export async function installIntoHelium(install: HeliumInstall, source: WidevineSource): Promise<string> {
  const log = getLogger();
  const dest = widevineDestination(install, source.version);
  await installWidevine(source, dest);

  if (getPlatform() === "linux") {
    const root = dirname(dest);
    const hintFile = join(root, "latest-component-updated-widevine-cdm");
    await writeFile(hintFile, JSON.stringify({ Path: dest }));
    log.info(`Wrote hint file: ${hintFile}`);

    // Remove older Widevine versions (Linux doesn't lock them, and only the hinted one is used)
    for (const old of await listVersionDirs(root)) {
      if (join(root, old) !== dest) await rm(join(root, old), { recursive: true, force: true }).catch(() => {});
    }

    // Under sudo, give the files back to the user so Helium can read them
    const owner = getSudoOwner();
    if (owner) {
      const ownerArg = `${owner.uid}:${owner.gid}`;
      await execFileAsync("chown", ["-R", ownerArg, root]);
      await execFileAsync("chown", [ownerArg, install.dir]);
      log.info(`Changed owner of ${root} to ${ownerArg}`);
    }
  }

  return dest;
}

/** Remove the fix from this Helium. Returns the folder removed, or null if there was nothing. */
export async function removeFromHelium(install: HeliumInstall): Promise<string | null> {
  const target = join(install.dir, "WidevineCdm");
  if (!(await exists(target))) return null;
  await rm(target, { recursive: true, force: false });
  return target;
}

/** Folder Helium runs from (to find its running processes). */
export function heliumAppRoot(install: HeliumInstall): string {
  if (install.appBundle) return install.appBundle;
  return /^\d+\.\d+\.\d+\.\d+$/.test(basename(install.dir)) ? dirname(install.dir) : install.dir;
}
