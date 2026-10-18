import { describe, it, expect } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getPlatform,
  getArch,
  getChromeAssetPattern,
  compareVersions,
  listVersionDirs,
} from './paths';

describe('paths', () => {
  describe('compareVersions', () => {
    it('should compare each part numerically', () => {
      expect(compareVersions('143.0.7499.170', '143.0.7499.40')).toBeGreaterThan(0);
      expect(compareVersions('99.0.0.0', '100.0.0.0')).toBeLessThan(0);
      expect(compareVersions('1.2.3.4', '1.2.3.4')).toBe(0);
    });
  });

  describe('listVersionDirs', () => {
    it('should list only version folders, newest first', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'helium-drm-versions-'));
      try {
        await mkdir(join(dir, '143.0.7499.40'));
        await mkdir(join(dir, '143.0.7499.170'));
        await mkdir(join(dir, '99.0.1.2'));
        await mkdir(join(dir, 'Dictionaries'));
        await writeFile(join(dir, '150.0.0.0'), 'not a folder');

        expect(await listVersionDirs(dir)).toEqual([
          '143.0.7499.170',
          '143.0.7499.40',
          '99.0.1.2',
        ]);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it('should return an empty list for a missing folder', async () => {
      expect(await listVersionDirs(join(tmpdir(), 'helium-drm-missing-dir'))).toEqual([]);
    });
  });

  describe('getPlatform', () => {
    it('should return the current platform', () => {
      const platform = getPlatform();
      expect(['win32', 'darwin', 'linux']).toContain(platform);
    });

    it('should throw error for unsupported platform', () => {
      // Mock process.platform to an unsupported value
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', {
        value: 'freebsd',
        writable: true,
      });

      expect(() => getPlatform()).toThrow('Unsupported platform: freebsd');

      // Restore original platform
      Object.defineProperty(process, 'platform', {
        value: originalPlatform,
        writable: true,
      });
    });
  });

  describe('getArch', () => {
    it('should return the current architecture', () => {
      const arch = getArch();
      expect(['x64', 'arm64']).toContain(arch);
    });

    it('should throw error for unsupported architecture', () => {
      // Mock process.arch to an unsupported value
      const originalArch = process.arch;
      Object.defineProperty(process, 'arch', {
        value: 'ia32',
        writable: true,
      });

      expect(() => getArch()).toThrow('Unsupported architecture: ia32');

      // Restore original arch
      Object.defineProperty(process, 'arch', {
        value: originalArch,
        writable: true,
      });
    });
  });

  describe('getChromeAssetPattern', () => {
    it('should return a regex pattern on Windows', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', writable: true });

      const pattern = getChromeAssetPattern();
      expect(pattern).toBeInstanceOf(RegExp);

      Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
    });

    it('should match Windows x64 asset names', () => {
      const originalPlatform = process.platform;
      const originalArch = process.arch;

      Object.defineProperty(process, 'platform', { value: 'win32', writable: true });
      Object.defineProperty(process, 'arch', { value: 'x64', writable: true });

      const pattern = getChromeAssetPattern();
      expect(pattern.test('x64_143.0.7499.170_chrome_installer_uncompressed.exe')).toBe(true);
      expect(pattern.test('arm64_143.0.7499.170_chrome_installer_uncompressed.exe')).toBe(false);

      Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
      Object.defineProperty(process, 'arch', { value: originalArch, writable: true });
    });

    it('should match Windows arm64 asset names', () => {
      const originalPlatform = process.platform;
      const originalArch = process.arch;

      Object.defineProperty(process, 'platform', { value: 'win32', writable: true });
      Object.defineProperty(process, 'arch', { value: 'arm64', writable: true });

      const pattern = getChromeAssetPattern();
      expect(pattern.test('arm64_143.0.7499.170_chrome_installer_uncompressed.exe')).toBe(true);
      expect(pattern.test('x64_143.0.7499.170_chrome_installer_uncompressed.exe')).toBe(false);

      Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
      Object.defineProperty(process, 'arch', { value: originalArch, writable: true });
    });

    it('should throw error for non-Windows platforms', () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'darwin', writable: true });

      expect(() => getChromeAssetPattern()).toThrow('Chrome download is only supported on Windows');

      Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
    });
  });
});
