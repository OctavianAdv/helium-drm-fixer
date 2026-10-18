import { join, basename } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { getArch, getChromeAssetPattern, getPlatform } from "./paths";
import { findDebDataTar } from "./deb";
import { calculateChecksum, displayProgress, formatError } from "./utils";
import { extractArchive, findWidevineInExtracted } from "./extractor";
import type { GitHubRelease, GitHubAsset, VersionCache } from "./types";
import type { Logger } from "./logger";

const CHROME_REPO = "Bush2021/chrome_installer";
const GITHUB_API_URL = `https://api.github.com/repos/${CHROME_REPO}/releases/latest`;
const LINUX_CHROME_DEB_URL =
  "https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb";

const execFileAsync = promisify(execFile);

export interface DownloadOptions {
  forceDownload?: boolean;
  spinner?: { text: string };
  logger: Logger;
}

async function fetchLatestRelease(): Promise<GitHubRelease> {
  const response = await fetch(GITHUB_API_URL);
  if (!response.ok) {
    throw new Error(
      formatError("Failed to fetch latest Chrome release from GitHub", {
        status: response.status,
      })
    );
  }
  return (await response.json()) as GitHubRelease;
}

function findMatchingAsset(release: GitHubRelease): GitHubAsset {
  const assetPattern = getChromeAssetPattern();
  const asset = release.assets?.find((a: GitHubAsset) =>
    assetPattern.test(a.name)
  );

  if (!asset) {
    throw new Error(
      formatError(
        "Could not find Chrome asset matching pattern for your platform/arch",
        {
          platform: process.platform,
          arch: process.arch,
          pattern: assetPattern.source,
        }
      )
    );
  }

  return asset;
}

async function checkCachedVersion(
  filePath: string,
  versionFile: string,
  tag: string,
  options: DownloadOptions
): Promise<boolean> {
  const { spinner, logger } = options;

  if (options.forceDownload) {
    return false;
  }

  const existingFile = Bun.file(filePath);
  const versionCacheFile = Bun.file(versionFile);

  if (!(await existingFile.exists()) || !(await versionCacheFile.exists())) {
    return false;
  }

  try {
    const cachedData: VersionCache = await versionCacheFile.json();
    if (cachedData.tag !== tag || !cachedData.checksum) {
      if (spinner) spinner.text = `New version available: ${tag}`;
      logger.info(`New version available: ${tag} (cached: ${cachedData.tag})`);
      return false;
    }

    const currentChecksum = await calculateChecksum(filePath);
    if (currentChecksum !== cachedData.checksum) {
      if (spinner)
        spinner.text = "Cached file checksum mismatch, re-downloading...";
      logger.warn("Cached file checksum mismatch, re-downloading...");
      return false;
    }

    if (spinner) spinner.text = `Using cached ${cachedData.name} (${tag})`;
    logger.info(`Using cached ${cachedData.name} (${tag})`);
    return true;
  } catch {
    if (spinner) spinner.text = "Version file is corrupted, re-downloading...";
    logger.warn("Version file is corrupted, re-downloading...");
    return false;
  }
}

export async function downloadFile(
  url: string,
  destPath: string,
  options: DownloadOptions
): Promise<void> {
  const { logger } = options;

  // Ask for the raw bytes: with gzip, Content-Length is the compressed size
  const response = await fetch(url, { headers: { "Accept-Encoding": "identity" } });
  if (!response.ok) {
    throw new Error(
      formatError("Download failed", {
        status: response.status,
      })
    );
  }

  // Only trust Content-Length when the body isn't re-encoded on the way
  const contentLength = response.headers.get("content-encoding")
    ? 0
    : Number(response.headers.get("content-length")) || 0;

  const reader = response.body!.getReader();
  const writer = Bun.file(destPath).writer();
  let downloaded = 0;

  displayProgress({ downloaded, total: contentLength, percentage: 0 });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      writer.write(value);
      downloaded += value.length;
      const percentage = contentLength
        ? Math.min(100, Math.round((downloaded / contentLength) * 100))
        : 0;
      displayProgress({ downloaded, total: contentLength || downloaded, percentage });
    }
  } finally {
    await writer.end();
    process.stdout.write("\n");
  }

  if (contentLength && downloaded !== contentLength) {
    throw new Error(
      formatError("Download was incomplete", {
        downloaded,
        expected: contentLength,
      })
    );
  }
}

/**
 * Download `url` to `filePath`, unless the cached copy matches `tag` and its checksum.
 */
async function downloadCached(
  url: string,
  filePath: string,
  versionFile: string,
  tag: string,
  options: DownloadOptions
): Promise<void> {
  const { spinner, logger } = options;
  const name = basename(filePath);

  if (await checkCachedVersion(filePath, versionFile, tag, options)) {
    return;
  }

  if (spinner) spinner.text = `Downloading ${name} (${tag})...`;
  logger.info(`Downloading ${name} (${tag})...`);

  try {
    await downloadFile(url, filePath, options);
  } catch (error) {
    logger.error("Failed to download Chrome installer", { error });
    throw error;
  }

  const cacheData: VersionCache = {
    tag,
    name,
    downloadedAt: Date.now(),
    checksum: await calculateChecksum(filePath),
  };
  await Bun.write(versionFile, JSON.stringify(cacheData));
}

export async function getDownloadDir(): Promise<string> {
  const tempDir = join(tmpdir(), "helium-drm-download");
  await mkdir(tempDir, { recursive: true });
  return tempDir;
}

/**
 * Windows: download Chrome's uncompressed installer from GitHub and unpack it with 7-Zip.
 */
async function downloadWindowsChrome(options: DownloadOptions): Promise<string> {
  const { spinner, logger } = options;

  logger.info("Chrome not found locally. Downloading from GitHub...");

  let release: GitHubRelease;
  try {
    release = await fetchLatestRelease();
  } catch (error) {
    logger.error("Failed to connect to GitHub API", { error });
    throw new Error(formatError("Failed to connect to GitHub API", { error }));
  }

  const asset = findMatchingAsset(release);
  const tempDir = await getDownloadDir();
  const exePath = join(tempDir, asset.name);

  await downloadCached(
    asset.browser_download_url,
    exePath,
    join(tempDir, "version.json"),
    release.tag_name,
    options
  );

  if (spinner) spinner.text = "Extracting WidevineCdm...";
  logger.info("Extracting WidevineCdm...");

  await extractArchive(exePath, tempDir);

  logger.info("Searching for WidevineCdm in extracted files...");
  const widevinePath = await findWidevineInExtracted(tempDir);

  if (!widevinePath) {
    logger.error("Could not find WidevineCdm in downloaded Chrome");
    throw new Error("Could not find WidevineCdm in downloaded Chrome");
  }

  logger.info("Chrome downloaded and extracted successfully.");
  return widevinePath;
}

/**
 * Linux: download Google's official Chrome .deb and pull WidevineCdm out of it.
 * Works on any distro - only `tar` (with xz support) is needed, not dpkg.
 */
async function downloadLinuxChrome(options: DownloadOptions): Promise<string> {
  const { spinner, logger } = options;

  if (getArch() !== "x64") {
    throw new Error(
      "Google does not publish Chrome for ARM Linux. Pass --chrome-path with the WidevineCdm folder of another Chromium browser."
    );
  }

  logger.info("Chrome not found locally. Downloading from Google...");

  const head = await fetch(LINUX_CHROME_DEB_URL, { method: "HEAD" });
  if (!head.ok) {
    throw new Error(
      formatError("Failed to reach Google's Chrome download server", {
        status: head.status,
      })
    );
  }
  const tag =
    head.headers.get("etag") ?? head.headers.get("last-modified") ?? "latest";

  const tempDir = await getDownloadDir();
  const debPath = join(tempDir, basename(LINUX_CHROME_DEB_URL));
  await downloadCached(
    LINUX_CHROME_DEB_URL,
    debPath,
    join(tempDir, "version-linux.json"),
    tag,
    options
  );

  if (spinner) spinner.text = "Extracting WidevineCdm...";
  logger.info("Extracting WidevineCdm...");

  const extractDir = join(tempDir, "chrome-linux");
  await rm(extractDir, { recursive: true, force: true });
  await mkdir(extractDir, { recursive: true });

  const dataTar = findDebDataTar(
    new Uint8Array(await Bun.file(debPath).arrayBuffer())
  );
  const tarPath = join(extractDir, dataTar.name);
  await Bun.write(tarPath, dataTar.data);

  try {
    await execFileAsync(
      "tar",
      ["-xf", dataTar.name, "./opt/google/chrome/WidevineCdm"],
      { cwd: extractDir }
    );
  } catch (error) {
    logger.error("Failed to extract Chrome package", { error });
    throw new Error(
      "Failed to extract the Chrome package. Make sure `tar` and `xz` are installed."
    );
  } finally {
    await rm(tarPath, { force: true });
  }

  const widevinePath = join(extractDir, "opt", "google", "chrome", "WidevineCdm");
  if (!(await Bun.file(join(widevinePath, "manifest.json")).exists())) {
    throw new Error("Could not find WidevineCdm in downloaded Chrome");
  }

  logger.info("Chrome downloaded and extracted successfully.");
  return widevinePath;
}

export async function downloadAndExtractChrome(
  options: DownloadOptions
): Promise<string> {
  switch (getPlatform()) {
    case "win32":
      return downloadWindowsChrome(options);
    case "linux":
      return downloadLinuxChrome(options);
    case "darwin":
      throw new Error(
        "Automatic Chrome download is not supported on macOS. Please install Google Chrome."
      );
  }
}
