/**
 * Minimal reader for Debian packages. A .deb is an `ar` archive holding
 * debian-binary, control.tar.* and data.tar.* (the installed files).
 */

const AR_MAGIC = "!<arch>\n";
const HEADER_SIZE = 60;

export interface ArMember {
  name: string;
  data: Uint8Array;
}

export function readArMembers(archive: Uint8Array): ArMember[] {
  const decoder = new TextDecoder();
  if (decoder.decode(archive.subarray(0, AR_MAGIC.length)) !== AR_MAGIC) {
    throw new Error("Not a valid .deb file (missing ar header)");
  }

  const members: ArMember[] = [];
  let offset = AR_MAGIC.length;

  while (offset + HEADER_SIZE <= archive.length) {
    const header = decoder.decode(archive.subarray(offset, offset + HEADER_SIZE));
    // GNU ar terminates names with "/", BSD ar pads with spaces
    const name = header.slice(0, 16).trim().replace(/\/$/, "");
    const size = Number.parseInt(header.slice(48, 58).trim(), 10);
    if (!Number.isFinite(size) || header.slice(58, 60) !== "`\n") {
      throw new Error(`Corrupt .deb file (bad member header at byte ${offset})`);
    }

    const start = offset + HEADER_SIZE;
    members.push({ name, data: archive.subarray(start, start + size) });
    // Member data is padded to an even length
    offset = start + size + (size % 2);
  }

  return members;
}

/**
 * Return the data.tar.* member (e.g. data.tar.xz) of a .deb package.
 */
export function findDebDataTar(archive: Uint8Array): ArMember {
  const member = readArMembers(archive).find((m) => m.name.startsWith("data.tar"));
  if (!member) {
    throw new Error("No data.tar found inside the .deb package");
  }
  return member;
}
