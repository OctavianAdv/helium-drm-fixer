import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectLibraryArch, installWidevine, readWidevine } from './widevine';
import { getArch } from './paths';

const LIBRARY = process.platform === 'win32' ? 'widevinecdm.dll' : 'libwidevinecdm.so';
const OS = process.platform === 'win32' ? 'win' : 'linux';

/** Minimal PE or ELF header for the given CPU. */
function fakeLibrary(arch: 'x64' | 'arm64', format: 'pe' | 'elf' = process.platform === 'win32' ? 'pe' : 'elf'): Buffer {
  const buf = Buffer.alloc(512);
  if (format === 'pe') {
    buf.write('MZ', 0, 'latin1');
    buf.writeUInt32LE(0x80, 0x3c);
    buf.write('PE\0\0', 0x80, 'latin1');
    buf.writeUInt16LE(arch === 'x64' ? 0x8664 : 0xaa64, 0x84);
  } else {
    buf.write('\x7fELF', 0, 'latin1');
    buf.writeUInt16LE(arch === 'x64' ? 62 : 183, 0x12);
  }
  return buf;
}

const otherArch = getArch() === 'x64' ? 'arm64' : 'x64';

describe('widevine', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'helium-drm-widevine-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('detectLibraryArch', () => {
    it('should read the CPU from PE and ELF headers', async () => {
      for (const [format, arch] of [['pe', 'x64'], ['pe', 'arm64'], ['elf', 'x64'], ['elf', 'arm64']] as const) {
        const file = join(dir, `${format}-${arch}`);
        await writeFile(file, fakeLibrary(arch, format));
        expect(await detectLibraryArch(file)).toBe(arch);
      }
    });

    it('should read the CPU from macOS Mach-O headers, thin and universal', async () => {
      const thin = Buffer.alloc(64);
      thin.writeUInt32LE(0xfeedfacf, 0);
      thin.writeUInt32LE(0x0100000c, 4); // arm64
      await writeFile(join(dir, 'thin'), thin);
      expect(await detectLibraryArch(join(dir, 'thin'))).toBe('arm64');

      const fat = Buffer.alloc(64);
      fat.writeUInt32BE(0xcafebabe, 0);
      fat.writeUInt32BE(1, 4); // one architecture
      fat.writeUInt32BE(0x01000007, 8); // x86_64
      await writeFile(join(dir, 'fat'), fat);
      expect(await detectLibraryArch(join(dir, 'fat'))).toBe('x64');
    });

    it('should return null for unknown files', async () => {
      await writeFile(join(dir, 'text'), 'hello');
      expect(await detectLibraryArch(join(dir, 'text'))).toBeNull();
    });
  });

  describe('readWidevine', () => {
    it('should read a Chromium-layout copy', async () => {
      await mkdir(join(dir, '_platform_specific', `${OS}_${getArch()}`), { recursive: true });
      await writeFile(join(dir, '_platform_specific', `${OS}_${getArch()}`, LIBRARY), fakeLibrary(getArch()));
      await writeFile(join(dir, 'manifest.json'), JSON.stringify({ version: '4.10.3112.0' }));

      expect(await readWidevine(dir, 'Test')).toEqual({
        name: 'Test',
        path: dir,
        version: '4.10.3112.0',
        layout: 'chromium',
      });
    });

    it('should read a Firefox-layout copy', async () => {
      await writeFile(join(dir, LIBRARY), fakeLibrary(getArch()));
      await writeFile(join(dir, 'manifest.json'), JSON.stringify({ version: '4.10.3050.0' }));

      expect((await readWidevine(dir, 'Firefox'))?.layout).toBe('flat');
    });

    it('should reject empty folders, missing versions and the wrong CPU', async () => {
      expect(await readWidevine(dir, 'Empty')).toBeNull();

      await writeFile(join(dir, 'manifest.json'), JSON.stringify({ name: 'WidevineCdm' }));
      await writeFile(join(dir, LIBRARY), fakeLibrary(getArch()));
      expect(await readWidevine(dir, 'No version')).toBeNull();

      await writeFile(join(dir, 'manifest.json'), JSON.stringify({ version: '4.10.3112.0' }));
      await writeFile(join(dir, LIBRARY), fakeLibrary(otherArch));
      expect(await readWidevine(dir, 'Wrong CPU')).toBeNull();
    });
  });

  describe('installWidevine', () => {
    it('should convert a Firefox copy to the Chromium layout', async () => {
      const src = join(dir, 'gmp-widevinecdm', '4.10.3050.0');
      const dest = join(dir, 'Helium', 'WidevineCdm');
      await mkdir(src, { recursive: true });
      await writeFile(join(src, LIBRARY), fakeLibrary(getArch()));
      await writeFile(join(src, `${LIBRARY}.sig`), 'signature');
      await writeFile(join(src, 'LICENSE.txt'), 'license');
      await writeFile(join(src, 'manifest.json'), JSON.stringify({ version: '4.10.3050.0' }));

      const source = (await readWidevine(src, 'Firefox'))!;
      await installWidevine(source, dest);

      const platformDir = join(dest, '_platform_specific', `${OS}_${getArch()}`);
      expect(await Bun.file(join(platformDir, LIBRARY)).exists()).toBe(true);
      expect(await Bun.file(join(platformDir, `${LIBRARY}.sig`)).text()).toBe('signature');
      expect(await Bun.file(join(dest, 'LICENSE')).text()).toBe('license');

      const manifest = JSON.parse(await readFile(join(dest, 'manifest.json'), 'utf-8'));
      expect(manifest.version).toBe('4.10.3050.0');
      expect(manifest['x-cdm-module-versions']).toBe('4');
      expect(manifest['x-cdm-interface-versions']).toBe('10');

      // The converted copy is itself a valid Chromium-layout source
      expect((await readWidevine(dest, 'Helium'))?.layout).toBe('chromium');
    });
  });
});
