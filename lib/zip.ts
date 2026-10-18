import { inflateRawSync } from "node:zlib";
import { mkdir } from "node:fs/promises";
import { dirname, join, normalize, isAbsolute } from "node:path";

/**
 * Minimal ZIP reader (stored and deflate entries), so extracting needs no
 * `unzip` or 7-Zip. Enough for Widevine packages from Google.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

export function readZip(zip: Uint8Array): ZipEntry[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);

  // The end-of-central-directory record is in the last 64 KB + 22 bytes
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a valid ZIP file");

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];

  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw new Error("Corrupt ZIP central directory");
    }
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(zip.subarray(offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith("/")) continue; // folder

    if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) {
      throw new Error(`Corrupt ZIP entry: ${name}`);
    }
    const dataStart =
      localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    const raw = zip.subarray(dataStart, dataStart + compressedSize);

    let data: Uint8Array;
    if (method === 0) data = raw;
    else if (method === 8) data = inflateRawSync(raw);
    else throw new Error(`Unsupported ZIP compression method ${method} for ${name}`);

    entries.push({ name, data });
  }

  return entries;
}

/**
 * Extract a ZIP into `destDir`. Refuses paths that would escape it.
 */
export async function extractZip(zip: Uint8Array, destDir: string): Promise<void> {
  for (const entry of readZip(zip)) {
    const relativePath = normalize(entry.name);
    if (isAbsolute(relativePath) || relativePath.startsWith("..")) {
      throw new Error(`Unsafe path in ZIP: ${entry.name}`);
    }
    const target = join(destDir, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await Bun.write(target, entry.data);
  }
}

/**
 * The ZIP inside a Chrome extension/component package (CRX3):
 * "Cr24", version 3, header length, signed header, then the ZIP.
 */
export function crxToZip(crx: Uint8Array): Uint8Array {
  const view = new DataView(crx.buffer, crx.byteOffset, crx.byteLength);
  const magic = new TextDecoder().decode(crx.subarray(0, 4));
  if (magic !== "Cr24") throw new Error("Not a CRX package");
  const version = view.getUint32(4, true);
  if (version !== 3) throw new Error(`Unsupported CRX version ${version}`);
  const headerSize = view.getUint32(8, true);
  return crx.subarray(12 + headerSize);
}
