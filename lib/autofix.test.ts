import { describe, it, expect } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { makeWindowlessCopy } from './autofix';
import { compareVersions } from './paths';

describe('autofix', () => {
  it('should switch a Windows executable to the GUI subsystem', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'helium-drm-autofix-'));
    try {
      // Minimal PE: "MZ", e_lfanew at 0x3c -> "PE\0\0", optional header at +24
      const exe = Buffer.alloc(512);
      exe.write('MZ', 0, 'latin1');
      exe.writeUInt32LE(0x80, 0x3c);
      exe.write('PE\0\0', 0x80, 'latin1');
      exe.writeUInt16LE(3, 0x80 + 24 + 68); // console
      await writeFile(join(dir, 'in.exe'), exe);

      await makeWindowlessCopy(join(dir, 'in.exe'), join(dir, 'out.exe'));

      const out = Buffer.from(await Bun.file(join(dir, 'out.exe')).arrayBuffer());
      expect(out.readUInt16LE(0x80 + 24 + 68)).toBe(2); // GUI
      expect(out.length).toBe(exe.length);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('should reject files that are not executables', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'helium-drm-autofix-'));
    try {
      await writeFile(join(dir, 'text.exe'), Buffer.alloc(512));
      await expect(makeWindowlessCopy(join(dir, 'text.exe'), join(dir, 'out.exe'))).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('should compare fixer versions for the update notice', () => {
    expect(compareVersions('1.3.0', '1.2.9')).toBeGreaterThan(0);
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.2.0', '1.2.0')).toBe(0);
  });
});
