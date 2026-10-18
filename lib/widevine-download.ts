import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { downloadAndExtractChrome, downloadFile, getDownloadDir, type DownloadOptions } from "./chrome-downloader";
import { crxToZip, extractZip } from "./zip";
import { getPlatform, type Platform } from "./paths";
import { readWidevine, type WidevineSource } from "./widevine";
import { formatError } from "./utils";

/**
 * Downloading Widevine when no browser or app on this computer has it.
 * Three routes, tried in order:
 *
 *  1. Google's component update server - the same server Chrome, Edge and
 *     Brave use to fetch Widevine. ~20 MB, always the newest version, and
 *     the only route for ARM64 Linux.
 *  2. Mozilla's update server - how Firefox gets Widevine (it points at the
 *     same Google packages, sometimes an older version).
 *  3. A full Chrome download, taking Widevine out of it (~500 MB on
 *     Windows, ~140 MB on Linux).
 */

const WIDEVINE_APP_ID = "oimompecagnajdejgnnjijobebaeigek";
const GOOGLE_UPDATE_URL = "https://update.googleapis.com/service/update2/json";
const MOZILLA_UPDATE_URL = "https://aus5.mozilla.org/update/3/GMP";
// Version of Chromium we present ourselves as (Widevine requires >= 68)
const PRODUCT_VERSION = "143.0.7499.170";

export type Arch = "x64" | "arm64";

interface ComponentPackage {
  version: string;
  urls: string[];
  hash: { algorithm: "sha256" | "sha512"; value: string };
  size: number;
}

const GOOGLE_OS: Record<Platform, { os: string; platform: string; version: string }> = {
  win32: { os: "win", platform: "Windows", version: "10.0.26100" },
  linux: { os: "linux", platform: "Linux", version: "6.8" },
  darwin: { os: "mac", platform: "Mac OS X", version: "14.0" },
};

/** Ask Google's component updater for the Widevine package for this OS/CPU. */
export async function queryGoogle(platform: Platform, arch: Arch): Promise<ComponentPackage> {
  const { os, platform: osName, version } = GOOGLE_OS[platform];
  const body = {
    request: {
      "@os": os,
      "@updater": "chrome",
      acceptformat: "crx3",
      app: [{ appid: WIDEVINE_APP_ID, updatecheck: {}, version: "0.0.0.0" }],
      arch,
      dedup: "cr",
      ismachine: false,
      os: { arch, platform: osName, version },
      prodversion: PRODUCT_VERSION,
      protocol: "3.1",
      requestid: `{${randomUUID()}}`,
      sessionid: `{${randomUUID()}}`,
      updaterversion: PRODUCT_VERSION,
    },
  };

  const res = await fetch(GOOGLE_UPDATE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(formatError("Google update server error", { status: res.status }));

  // The response starts with an anti-JSON-hijacking prefix: )]}'
  const text = (await res.text()).replace(/^\)\]\}'\s*/, "");
  const app = JSON.parse(text).response?.app?.[0];
  const check = app?.updatecheck;
  const pkg = check?.manifest?.packages?.package?.[0];
  if (check?.status !== "ok" || !pkg) {
    throw new Error(`Google has no Widevine for ${os}/${arch} (status: ${check?.status ?? app?.status})`);
  }

  const codebases: string[] = check.urls.url.map((u: { codebase: string }) => u.codebase);
  return {
    version: check.manifest.version,
    // https first
    urls: codebases
      .sort((a, b) => Number(b.startsWith("https:")) - Number(a.startsWith("https:")))
      .map((base) => base + pkg.name),
    hash: { algorithm: "sha256", value: pkg.hash_sha256 },
    size: pkg.size,
  };
}

const MOZILLA_TARGET: Record<string, string> = {
  "win32-x64": "WINNT_x86_64-msvc-x64",
  "win32-arm64": "WINNT_aarch64-msvc-aarch64",
  "linux-x64": "Linux_x86_64-gcc3",
  "linux-arm64": "Linux_aarch64-gcc3",
  "darwin-x64": "Darwin_x86_64-gcc3",
  "darwin-arm64": "Darwin_aarch64-gcc3",
};

/** Ask Mozilla's update server (Firefox's route) for the Widevine package. */
export async function queryMozilla(platform: Platform, arch: Arch): Promise<ComponentPackage> {
  const target = MOZILLA_TARGET[`${platform}-${arch}`];
  const osVersion = platform === "win32" ? "Windows_NT%2010.0.0.0" : platform === "linux" ? "Linux%206.8" : "Darwin%2023.0.0";
  const url = `${MOZILLA_UPDATE_URL}/140.0/20250101000000/${target}/en-US/release/${osVersion}/default/default/update.xml`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(formatError("Mozilla update server error", { status: res.status }));
  const xml = await res.text();

  const addon = xml.match(/<addon\s+id="gmp-widevinecdm"[^>]*>/)?.[0];
  const attr = (name: string) => addon?.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
  const downloadUrl = attr("URL");
  const hashValue = attr("hashValue");
  const version = attr("version");
  if (!addon || !downloadUrl || !hashValue || !version) {
    throw new Error(`Mozilla has no Widevine for ${target}`);
  }

  return {
    version,
    urls: [downloadUrl],
    hash: { algorithm: attr("hashFunction") === "sha256" ? "sha256" : "sha512", value: hashValue },
    size: Number(attr("size") ?? 0),
  };
}

async function hashFile(path: string, algorithm: "sha256" | "sha512"): Promise<string> {
  return createHash(algorithm).update(await Bun.file(path).bytes()).digest("hex");
}

/**
 * Download a component package (cached), verify its hash, and unpack it.
 * Returns the folder holding manifest.json.
 */
async function downloadPackage(
  pkg: ComponentPackage,
  label: string,
  platform: Platform,
  arch: Arch,
  options: DownloadOptions
): Promise<string> {
  const { spinner, logger } = options;
  const dir = join(await getDownloadDir(), "widevine", `${pkg.version}-${platform}-${arch}`);
  const crxPath = `${dir}.crx3`;
  await mkdir(join(dir, ".."), { recursive: true });

  const cached = !options.forceDownload && (await Bun.file(crxPath).exists())
    && (await hashFile(crxPath, pkg.hash.algorithm)) === pkg.hash.value.toLowerCase();

  if (cached) {
    logger.info(`Using cached Widevine ${pkg.version} from ${label}`);
  } else {
    let lastError: unknown;
    for (const url of pkg.urls) {
      try {
        if (spinner) spinner.text = `Downloading Widevine ${pkg.version} from ${label}...`;
        logger.info(`Downloading ${url}`);
        await downloadFile(url, crxPath, options);
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        logger.warn(`Download failed from ${url}`, { error });
      }
    }
    if (lastError) throw lastError;

    const actual = await hashFile(crxPath, pkg.hash.algorithm);
    if (actual !== pkg.hash.value.toLowerCase()) {
      await rm(crxPath, { force: true });
      throw new Error(`Widevine download from ${label} failed its ${pkg.hash.algorithm} check`);
    }
    logger.info(`Verified ${pkg.hash.algorithm}: ${actual}`);
  }

  await rm(dir, { recursive: true, force: true });
  await extractZip(crxToZip(await Bun.file(crxPath).bytes()), dir);
  return dir;
}

/**
 * Download Widevine for Helium's OS and CPU, trying Google, then Mozilla,
 * then a full Chrome download.
 */
export async function downloadWidevine(arch: Arch, options: DownloadOptions): Promise<WidevineSource> {
  const { logger, spinner } = options;
  const platform = getPlatform();

  const routes: Array<[string, () => Promise<ComponentPackage>]> = [
    ["Google", () => queryGoogle(platform, arch)],
    ["Mozilla", () => queryMozilla(platform, arch)],
  ];

  for (const [label, query] of routes) {
    try {
      if (spinner) spinner.text = `Asking ${label} for Widevine...`;
      const pkg = await query();
      logger.info(`${label} offers Widevine ${pkg.version} (${(pkg.size / 1024 / 1024).toFixed(1)} MB)`);
      const dir = await downloadPackage(pkg, label, platform, arch, options);
      const source = await readWidevine(dir, `${label} (downloaded)`, arch);
      if (source) return source;
      logger.warn(`Package from ${label} has no usable Widevine`);
    } catch (error) {
      logger.warn(`Widevine from ${label} failed`, { error });
    }
  }

  // Last resort: the whole Chrome browser (x64 only on Linux)
  if (spinner) spinner.text = "Downloading Chrome to take Widevine from it...";
  const chromeDir = await downloadAndExtractChrome(options);
  const source = await readWidevine(chromeDir, "Google Chrome (downloaded)", arch);
  if (!source) throw new Error("The downloaded Chrome has no usable Widevine");
  return source;
}
