import { describe, it, expect } from 'bun:test';
import { readArMembers, findDebDataTar } from './deb';

function arHeader(name: string, size: number): string {
  return (
    name.padEnd(16) +
    '0'.padEnd(12) +
    '0'.padEnd(6) +
    '0'.padEnd(6) +
    '100644'.padEnd(8) +
    String(size).padEnd(10) +
    '`\n'
  );
}

function buildAr(members: Array<[string, string]>): Uint8Array {
  let out = '!<arch>\n';
  for (const [name, data] of members) {
    out += arHeader(name, data.length) + data + (data.length % 2 ? '\n' : '');
  }
  return new TextEncoder().encode(out);
}

describe('deb', () => {
  it('should read every ar member, including odd-sized ones', () => {
    const archive = buildAr([
      ['debian-binary', '2.0\n'],
      ['control.tar.xz/', 'abc'],
      ['data.tar.xz/', 'payload'],
    ]);

    const members = readArMembers(archive);
    expect(members.map((m) => m.name)).toEqual(['debian-binary', 'control.tar.xz', 'data.tar.xz']);
    expect(new TextDecoder().decode(members[1]!.data)).toBe('abc');
    expect(new TextDecoder().decode(members[2]!.data)).toBe('payload');
  });

  it('should find the data.tar member', () => {
    const archive = buildAr([
      ['debian-binary', '2.0\n'],
      ['data.tar.xz', 'files'],
    ]);
    expect(findDebDataTar(archive).name).toBe('data.tar.xz');
  });

  it('should reject files that are not ar archives', () => {
    expect(() => readArMembers(new TextEncoder().encode('PK\x03\x04 zip file'))).toThrow(
      'Not a valid .deb file'
    );
  });
});
