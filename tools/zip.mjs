import { deflateRawSync } from 'node:zlib';

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

// Fixed timestamps and sorted names make release archives byte-for-byte repeatable.
// This small writer supports the flat, sub-4-GB extension package without ZIP64.
export function zipFiles(entries) {
  const records = [], directory = [];
  let offset = 0;
  for (const [name, input] of [...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new Error(`Unsafe archive filename: ${name}`);
    const filename = Buffer.from(name), data = Buffer.from(input);
    const compressed = deflateRawSync(data, { level: 9 }), crc = crc32(data);
    const local = Buffer.alloc(30), central = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0x2821, 12); // 2000-01-01, midnight.
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filename.length, 26);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0x2821, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    records.push(local, filename, compressed);
    directory.push(central, filename);
    offset += local.length + filename.length + compressed.length;
  }
  const centralData = Buffer.concat(directory), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralData.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...records, centralData, end]);
}
