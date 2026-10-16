import { pipeline, Readable } from 'stream';
import { promisify } from 'util';
import { crc32, createDeflateRaw, deflateRaw, deflateRawSync } from 'zlib';

/**
 * A ZIP archive written front to back as a stream of chunks, so an export of several GB never sits in memory.
 * Each file's CRC-32 and sizes go in a data descriptor after its data; ZIP64 records are added when an entry,
 * an offset or the entry count passes the classic 32/16-bit limits. Names are UTF-8 (flag bit 11).
 */

/** Content opened only when its entry is written (a file on disk). */
export interface ZipSource {
  /** Upper bound of the bytes `stream` yields; decides whether the entry needs ZIP64. */
  size: number;
  stream: AsyncIterable<Buffer>;
  close?: () => Promise<void>;
}

export interface ZipEntry {
  /** Forward slashes; a trailing "/" makes it a folder. */
  name: string;
  mtime?: Date;
  /** Deflate (default) or store as is (pictures, PDFs, archives: already compressed). */
  compress?: boolean;
  /** Small content known up front. */
  data?: Buffer | string;
  /** Large content; null skips the entry (e.g. the file vanished since it was listed). */
  open?: () => Promise<ZipSource | null>;
}

const MAX16 = 0xffff;
const MAX32 = 0xffffffff;
/** Entries this large get ZIP64 sizes up front: deflate can grow incompressible data a little. */
const ZIP64_AT = 0xf0000000;
const FLAG_DESCRIPTOR = 0x0008;
const FLAG_UTF8 = 0x0800;
const MADE_BY = (3 << 8) | 63; // Unix, spec 6.3: external attributes carry Unix modes
const CD_CHUNK = 64 * 1024;
const deflate = promisify(deflateRaw);
/** Fast deflate: an export of several GB should not hold a CPU for minutes; level 1 is 2-3x faster than 6 for a few % more bytes. */
const LEVEL = 1;
/** Inline content under this size is deflated synchronously (a thread-pool round trip costs more than the work). */
const SYNC_DEFLATE_BELOW = 64 * 1024;

interface Written {
  name: Buffer;
  flags: number;
  method: number;
  time: number;
  date: number;
  unixTime: number;
  crc: number;
  packed: number;
  raw: number;
  offset: number;
  zip64: boolean;
  dir: boolean;
}

/** Yields the archive's bytes; destroying the consumer stops it and closes the open source. */
export async function* zipStream(entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>): AsyncGenerator<Buffer> {
  const written: Written[] = [];
  let offset = 0;
  const emit = (chunk: Buffer) => {
    offset += chunk.length;
    return chunk;
  };

  for await (const entry of entries) {
    const dir = entry.name.endsWith('/');
    const source = !dir && entry.open ? await entry.open() : null;
    if (entry.open && !dir && !source) continue;
    try {
      const inline = dir || entry.data === undefined ? null : typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : entry.data;
      const size = inline?.length ?? source?.size ?? 0;
      const zip64 = size >= ZIP64_AT;
      const method = dir || size === 0 || entry.compress === false ? 0 : 8;
      // Content known up front needs no data descriptor (friendlier to streaming readers).
      const known = !source;
      const flags = FLAG_UTF8 | (known ? 0 : FLAG_DESCRIPTOR);
      const mtime = entry.mtime ?? new Date();
      const w: Written = {
        name: Buffer.from(entry.name, 'utf8'),
        flags,
        method,
        ...dosDateTime(mtime),
        unixTime: unixSeconds(mtime),
        crc: 0,
        packed: 0,
        raw: 0,
        offset,
        zip64,
        dir,
      };
      if (w.name.length > MAX16) throw new Error('ZIP entry name is too long');

      if (known) {
        const body = inline ?? Buffer.alloc(0);
        const packed =
          method !== 8 ? body : body.length < SYNC_DEFLATE_BELOW ? deflateRawSync(body, { level: LEVEL }) : await deflate(body, { level: LEVEL });
        Object.assign(w, { crc: crc32(body), raw: body.length, packed: packed.length });
        yield emit(localHeader(w));
        if (packed.length) yield emit(packed);
      } else {
        yield emit(localHeader(w));
        const counted = async function* (input: AsyncIterable<Buffer>) {
          for await (const chunk of input) {
            w.crc = crc32(chunk, w.crc);
            w.raw += chunk.length;
            yield chunk;
          }
        };
        if (method === 8) {
          const deflater = createDeflateRaw({ level: LEVEL });
          // Errors (source or zlib) surface in the loop below; the callback only keeps them from going unhandled.
          const out = pipeline(Readable.from(counted(source!.stream)), deflater, () => undefined);
          try {
            for await (const chunk of out as AsyncIterable<Buffer>) {
              w.packed += chunk.length;
              yield emit(chunk);
            }
          } finally {
            deflater.destroy();
          }
        } else {
          for await (const chunk of counted(source!.stream)) {
            w.packed += chunk.length;
            yield emit(chunk);
          }
        }
        if (!zip64 && (w.raw >= MAX32 || w.packed >= MAX32)) throw new Error(`ZIP entry grew past its declared size: ${entry.name}`);
        yield emit(dataDescriptor(w));
      }
      written.push(w);
    } finally {
      await source?.close?.().catch(() => undefined);
    }
  }

  // Central directory, in chunks so a huge listing is not one buffer.
  const cdOffset = offset;
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  for (const w of written) {
    const record = centralRecord(w);
    pending.push(record);
    pendingBytes += record.length;
    if (pendingBytes >= CD_CHUNK) {
      yield emit(Buffer.concat(pending));
      pending = [];
      pendingBytes = 0;
    }
  }
  if (pending.length) yield emit(Buffer.concat(pending));
  const cdSize = offset - cdOffset;

  const count = written.length;
  const needs64 = count >= MAX16 || cdOffset >= MAX32 || cdSize >= MAX32;
  if (needs64) {
    const eocd64Offset = offset;
    const rec = Buffer.alloc(56);
    rec.writeUInt32LE(0x06064b50, 0);
    writeU64(rec, 44, 4); // size of the rest of this record
    rec.writeUInt16LE(MADE_BY, 12);
    rec.writeUInt16LE(45, 14);
    rec.writeUInt32LE(0, 16); // this disk
    rec.writeUInt32LE(0, 20); // disk with the central directory
    writeU64(rec, count, 24);
    writeU64(rec, count, 32);
    writeU64(rec, cdSize, 40);
    writeU64(rec, cdOffset, 48);
    yield emit(rec);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeUInt32LE(0, 4);
    writeU64(locator, eocd64Offset, 8);
    locator.writeUInt32LE(1, 16);
    yield emit(locator);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Math.min(count, MAX16), 8);
  end.writeUInt16LE(Math.min(count, MAX16), 10);
  end.writeUInt32LE(Math.min(cdSize, MAX32), 12);
  end.writeUInt32LE(Math.min(cdOffset, MAX32), 16);
  yield emit(end);
}

function localHeader(w: Written): Buffer {
  // ZIP64 local headers carry 0xFFFFFFFF sizes and a ZIP64 extra field (zeros: the real values follow in the descriptor).
  const z64 = w.zip64 ? zip64Extra([0, 0]) : Buffer.alloc(0);
  const extra = Buffer.concat([z64, timeExtra(w.unixTime)]);
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(versionNeeded(w), 4);
  h.writeUInt16LE(w.flags, 6);
  h.writeUInt16LE(w.method, 8);
  h.writeUInt16LE(w.time, 10);
  h.writeUInt16LE(w.date, 12);
  const known = !(w.flags & FLAG_DESCRIPTOR);
  h.writeUInt32LE(known ? w.crc : 0, 14);
  h.writeUInt32LE(w.zip64 ? MAX32 : known ? w.packed : 0, 18);
  h.writeUInt32LE(w.zip64 ? MAX32 : known ? w.raw : 0, 22);
  h.writeUInt16LE(w.name.length, 26);
  h.writeUInt16LE(extra.length, 28);
  return Buffer.concat([h, w.name, extra]);
}

function dataDescriptor(w: Written): Buffer {
  if (w.zip64) {
    const d = Buffer.alloc(24);
    d.writeUInt32LE(0x08074b50, 0);
    d.writeUInt32LE(w.crc, 4);
    writeU64(d, w.packed, 8);
    writeU64(d, w.raw, 16);
    return d;
  }
  const d = Buffer.alloc(16);
  d.writeUInt32LE(0x08074b50, 0);
  d.writeUInt32LE(w.crc, 4);
  d.writeUInt32LE(w.packed, 8);
  d.writeUInt32LE(w.raw, 12);
  return d;
}

function centralRecord(w: Written): Buffer {
  // ZIP64 extra values, in the order the spec fixes: uncompressed, compressed, local header offset.
  const sizes64 = w.zip64 || w.raw >= MAX32 || w.packed >= MAX32;
  const offset64 = w.offset >= MAX32;
  const values: number[] = [];
  if (sizes64) values.push(w.raw, w.packed);
  if (offset64) values.push(w.offset);
  const extra = Buffer.concat([values.length ? zip64Extra(values) : Buffer.alloc(0), timeExtra(w.unixTime)]);
  const h = Buffer.alloc(46);
  h.writeUInt32LE(0x02014b50, 0);
  h.writeUInt16LE(MADE_BY, 4);
  h.writeUInt16LE(values.length ? 45 : versionNeeded(w), 6);
  h.writeUInt16LE(w.flags, 8);
  h.writeUInt16LE(w.method, 10);
  h.writeUInt16LE(w.time, 12);
  h.writeUInt16LE(w.date, 14);
  h.writeUInt32LE(w.crc, 16);
  h.writeUInt32LE(sizes64 ? MAX32 : w.packed, 20);
  h.writeUInt32LE(sizes64 ? MAX32 : w.raw, 24);
  h.writeUInt16LE(w.name.length, 28);
  h.writeUInt16LE(extra.length, 30);
  h.writeUInt16LE(0, 32); // comment
  h.writeUInt16LE(0, 34); // disk
  h.writeUInt16LE(0, 36); // internal attributes
  // Unix mode in the high half; the MS-DOS folder bit too, for Windows' own extractor.
  h.writeUInt32LE(w.dir ? ((0o40755 << 16) | 0x10) >>> 0 : (0o100644 << 16) >>> 0, 38);
  h.writeUInt32LE(offset64 ? MAX32 : w.offset, 42);
  return Buffer.concat([h, w.name, extra]);
}

function versionNeeded(w: Written): number {
  if (w.zip64) return 45;
  return w.dir ? 20 : w.method === 8 ? 20 : 10;
}

function zip64Extra(values: number[]): Buffer {
  const b = Buffer.alloc(4 + values.length * 8);
  b.writeUInt16LE(0x0001, 0);
  b.writeUInt16LE(values.length * 8, 2);
  values.forEach((v, i) => writeU64(b, v, 4 + i * 8));
  return b;
}

/** "UT" extended timestamp: the modification time in UTC seconds (DOS times have no zone). */
function timeExtra(seconds: number): Buffer {
  const b = Buffer.alloc(9);
  b.writeUInt16LE(0x5455, 0);
  b.writeUInt16LE(5, 2);
  b.writeUInt8(1, 4);
  b.writeUInt32LE(seconds, 5);
  return b;
}

function writeU64(b: Buffer, value: number, at: number): void {
  b.writeBigUInt64LE(BigInt(value), at);
}

function unixSeconds(d: Date): number {
  return Math.min(MAX32, Math.max(0, Math.floor(d.getTime() / 1000)));
}

/** MS-DOS date and time (local, 2-second steps), clamped to 1980-2107. */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = d.getFullYear();
  if (Number.isNaN(year) || year < 1980) return { time: 0, date: (1 << 5) | 1 };
  if (year > 2107) return { time: (23 << 11) | (59 << 5) | 29, date: (127 << 9) | (12 << 5) | 31 };
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}
