import { describe, it, expect } from 'bun:test';
import { deflateRawSync } from 'node:zlib';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readZip, extractZip, crxToZip } from './zip';

/** Build a small ZIP: one stored entry, one deflated entry, one folder. */
function buildZip(files: Array<[name: string, content: string, deflate: boolean]>): Uint8Array {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const [name, content, deflate] of files) {
    const nameBytes = Buffer.from(name);
    const raw = Buffer.from(content);
    const data = deflate ? deflateRawSync(raw) : raw;

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(deflate ? 8 : 0, 8);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(raw.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    local.push(header, nameBytes, data);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(deflate ? 8 : 0, 10);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(raw.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);

    offset += header.length + nameBytes.length + data.length;
  }

  const centralBytes = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, centralBytes, eocd]));
}

function wrapInCrx(zip: Uint8Array): Uint8Array {
  const header = Buffer.from('signed-header-bytes');
  const prefix = Buffer.alloc(12);
  prefix.write('Cr24', 0, 'latin1');
  prefix.writeUInt32LE(3, 4);
  prefix.writeUInt32LE(header.length, 8);
  return new Uint8Array(Buffer.concat([prefix, header, Buffer.from(zip)]));
}

describe('zip', () => {
  const zip = buildZip([
    ['manifest.json', '{"version":"4.10.3112.0"}', false],
    ['_platform_specific/win_x64/widevinecdm.dll', 'x'.repeat(5000), true],
    ['_metadata/', '', false],
  ]);

  it('should read stored and deflated entries and skip folders', () => {
    const entries = readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(['manifest.json', '_platform_specific/win_x64/widevinecdm.dll']);
    expect(new TextDecoder().decode(entries[1]!.data)).toBe('x'.repeat(5000));
  });

  it('should unwrap a CRX3 package', () => {
    expect(readZip(crxToZip(wrapInCrx(zip))).length).toBe(2);
    expect(() => crxToZip(zip)).toThrow('Not a CRX package');
  });

  it('should extract files into folders', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'helium-drm-zip-'));
    try {
      await extractZip(zip, dir);
      expect(await readFile(join(dir, 'manifest.json'), 'utf-8')).toBe('{"version":"4.10.3112.0"}');
      expect((await readFile(join(dir, '_platform_specific', 'win_x64', 'widevinecdm.dll'))).length).toBe(5000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('should refuse paths that escape the folder', async () => {
    const evil = buildZip([['../evil.txt', 'nope', false]]);
    const dir = await mkdtemp(join(tmpdir(), 'helium-drm-zip-'));
    try {
      await expect(extractZip(evil, dir)).rejects.toThrow('Unsafe path');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
