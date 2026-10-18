import { readdir, stat, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getLogger } from "./logger";
// Embedded into compiled executables, so extraction works without node_modules.
// The x64 build also runs on Windows on ARM through emulation.
import sevenZipWin from "7zip-bin/win/x64/7za.exe" with { type: "file" };

const execFileAsync = promisify(execFile);

export async function findWidevineInExtracted(
  baseDir: string
): Promise<string | null> {
  const log = getLogger();
  log.info(`Starting WidevineCdm search in: ${baseDir}`);

  async function searchDir(dir: string, depth: number = 0): Promise<string | null> {
    const indent = "  ".repeat(depth);

    try {
      const stats = await stat(dir);
      if (!stats.isDirectory()) {
        log.info(`${indent}✗ Not a directory: ${dir}`);
        return null;
      }
    } catch {
      log.info(`${indent}✗ Path does not exist: ${dir}`);
      return null;
    }

    log.info(`${indent}Scanning directory: ${dir}`);
    const entries = await readdir(dir, { withFileTypes: true });
    log.info(`${indent}Found ${entries.length} entries`);

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (
          entry.name === "WidevineCdm" ||
          entry.name === "WidevineCdm.plugin"
        ) {
          log.info(`${indent}✓ Found WidevineCdm at: ${fullPath}`);
          return fullPath;
        }

        const result = await searchDir(fullPath, depth + 1);
        if (result) return result;
      }
    }

    return null;
  }

  const result = await searchDir(baseDir);
  if (!result) {
    log.info(`✗ WidevineCdm not found in: ${baseDir}`);
  }
  return result;
}

/**
 * Extract an archive with 7-Zip (Windows only).
 * The embedded 7za.exe is copied next to the archive first, because a compiled
 * executable cannot spawn a binary straight from its internal file system.
 */
export async function extractArchive(
  archivePath: string,
  destDir: string
): Promise<void> {
  const binDir = join(destDir, "bin");
  const sevenZipPath = join(binDir, "7za.exe");
  await mkdir(binDir, { recursive: true });
  await Bun.write(sevenZipPath, Bun.file(sevenZipWin));

  await execFileAsync(sevenZipPath, ["x", archivePath, `-o${destDir}`, "-y"], {
    maxBuffer: 64 * 1024 * 1024,
  });
}
