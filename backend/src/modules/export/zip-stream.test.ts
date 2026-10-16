import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { after, test } from 'node:test';
import { crc32, createInflateRaw, inflateRawSync } from 'node:zlib';
import { zipStream, type ZipEntry } from './zip-stream.js';

const dirs: string[] = [];
after(() => Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true }))));

async function writeZip(entries: Iterable<ZipEntry> | AsyncIterable<ZipEntry>): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'studyhawk-zip-'));
  dirs.push(dir);
  const path = join(dir, 'test.zip');
  await pipeline(Readable.from(zipStream(entries), { objectMode: false }), createWriteStream(path));
  return path;
}

function* chunks(total: number, size: number, byte = 0): Generator<Buffer> {
  const block = Buffer.alloc(size, byte);
  for (let left = total; left > 0; left -= size) yield left >= size ? block : block.subarray(0, left);
}

interface ReadEntry {
  name: string;
  flags: number;
  method: number;
  crc: number;
  packed: number;
  raw: number;
  offset: number;
  dataStart: number;
  unixTime?: number;
}

/** A small reader that trusts nothing but the spec: end record (and ZIP64 one), central directory, local headers. */
async function readZip(path: string): Promise<ReadEntry[]> {
  // The archives in these tests are small on disk (the 4 GB one deflates to a few MB).
  const zip = await fs.readFile(path);
  const size = zip.length;
  const tail = zip.subarray(size - 22);
  assert.equal(tail.readUInt32LE(0), 0x06054b50, 'end of central directory record');
  let count = tail.readUInt16LE(10);
  let cdSize = tail.readUInt32LE(12);
  let cdOffset = tail.readUInt32LE(16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const locator = zip.subarray(size - 22 - 20);
    assert.equal(locator.readUInt32LE(0), 0x07064b50, 'ZIP64 locator');
    const rec = zip.subarray(Number(locator.readBigUInt64LE(8)));
    assert.equal(rec.readUInt32LE(0), 0x06064b50, 'ZIP64 end record');
    count = Number(rec.readBigUInt64LE(32));
    cdSize = Number(rec.readBigUInt64LE(40));
    cdOffset = Number(rec.readBigUInt64LE(48));
  }
  const cd = zip.subarray(cdOffset, cdOffset + cdSize);
  const out: ReadEntry[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    assert.equal(cd.readUInt32LE(p), 0x02014b50, 'central record');
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const e: ReadEntry = {
      name: cd.subarray(p + 46, p + 46 + nameLen).toString('utf8'),
      flags: cd.readUInt16LE(p + 8),
      method: cd.readUInt16LE(p + 10),
      crc: cd.readUInt32LE(p + 16),
      packed: cd.readUInt32LE(p + 20),
      raw: cd.readUInt32LE(p + 24),
      offset: cd.readUInt32LE(p + 42),
      dataStart: 0,
    };
    const extra = cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen);
    for (let x = 0; x < extra.length; ) {
      const id = extra.readUInt16LE(x);
      const len = extra.readUInt16LE(x + 2);
      let v = x + 4;
      if (id === 0x0001) {
        if (e.raw === 0xffffffff) (e.raw = Number(extra.readBigUInt64LE(v))), (v += 8);
        if (e.packed === 0xffffffff) (e.packed = Number(extra.readBigUInt64LE(v))), (v += 8);
        if (e.offset === 0xffffffff) e.offset = Number(extra.readBigUInt64LE(v));
      }
      if (id === 0x5455) e.unixTime = extra.readUInt32LE(x + 5);
      x += 4 + len;
    }
    assert.equal(zip.readUInt32LE(e.offset), 0x04034b50, `local header of ${e.name}`);
    assert.equal(zip.subarray(e.offset + 30, e.offset + 30 + nameLen).toString('utf8'), e.name);
    e.dataStart = e.offset + 30 + zip.readUInt16LE(e.offset + 26) + zip.readUInt16LE(e.offset + 28);
    out.push(e);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function contentOf(path: string, e: ReadEntry): Promise<Buffer> {
  const zip = await fs.readFile(path);
  const b = zip.subarray(e.dataStart, e.dataStart + e.packed);
  const data = e.method === 8 ? inflateRawSync(b) : b;
  assert.equal(data.length, e.raw, `size of ${e.name}`);
  assert.equal(crc32(data), e.crc, `CRC of ${e.name}`);
  return data;
}

/** Python's zipfile as a second, independent reader, when Python is installed. */
function python(script: string, zip: string): unknown {
  for (const bin of ['python3', 'python']) {
    try {
      return JSON.parse(execFileSync(bin, ['-I', '-c', script, zip], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT' || /not found/i.test(String((err as { stderr?: string }).stderr))) continue;
      throw err;
    }
  }
  return undefined;
}

const PY_LIST = `
import json, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    bad = z.testzip()
    print(json.dumps({"bad": bad, "entries": [[i.filename, i.file_size, z.read(i).decode("utf8", "replace")] for i in z.infolist()]}))
`;

test('files, folders, empty files and non-ASCII names read back intact', async () => {
  const mtime = new Date('2026-09-01T12:34:56Z');
  const text = 'Résumé de cours — 日本語 ✓\n'.repeat(500);
  const closed: string[] = [];
  const path = await writeZip([
    { name: 'README.txt', data: 'hello' },
    { name: 'files/Économie ñ/', mtime },
    { name: 'files/Économie ñ/notes 日本語.md', mtime, open: async () => ({ size: Buffer.byteLength(text), stream: Readable.from([Buffer.from(text)]), close: async () => void closed.push('notes') }) },
    { name: 'files/empty.txt', open: async () => ({ size: 0, stream: Readable.from([]), close: async () => void closed.push('empty') }) },
    { name: 'files/stored.bin', compress: false, open: async () => ({ size: 70_000, stream: Readable.from(chunks(70_000, 16_384, 7)) }) },
    { name: 'files/gone.txt', open: async () => null },
    { name: 'files/inline-empty.txt', data: '' },
  ]);
  const entries = await readZip(path);
  assert.deepEqual(
    entries.map((e) => e.name),
    ['README.txt', 'files/Économie ñ/', 'files/Économie ñ/notes 日本語.md', 'files/empty.txt', 'files/stored.bin', 'files/inline-empty.txt'],
  );
  for (const e of entries) assert.ok(e.flags & 0x0800, 'UTF-8 flag');
  const byName = Object.fromEntries(entries.map((e) => [e.name, e]));
  assert.equal((await contentOf(path, byName['README.txt']!)).toString(), 'hello');
  assert.equal((await contentOf(path, byName['files/Économie ñ/notes 日本語.md']!)).toString(), text);
  assert.equal(byName['files/Économie ñ/notes 日本語.md']!.method, 8);
  assert.ok(byName['files/Économie ñ/notes 日本語.md']!.packed < Buffer.byteLength(text) / 10, 'deflated');
  assert.equal(byName['files/Économie ñ/notes 日本語.md']!.unixTime, mtime.getTime() / 1000);
  assert.equal((await contentOf(path, byName['files/empty.txt']!)).length, 0);
  assert.equal(byName['files/stored.bin']!.method, 0);
  assert.deepEqual(await contentOf(path, byName['files/stored.bin']!), Buffer.alloc(70_000, 7));
  assert.deepEqual(closed.sort(), ['empty', 'notes']);

  const py = python(PY_LIST, path) as { bad: string | null; entries: [string, number, string][] } | undefined;
  if (py) {
    assert.equal(py.bad, null);
    assert.deepEqual(py.entries.map(([name, size]) => [name, size]), entries.map((e) => [e.name, e.raw]));
    assert.equal(py.entries[2]![2], text);
  }
});

test('more than 65,535 entries get a ZIP64 end record', async () => {
  const COUNT = 70_000;
  const path = await writeZip(
    (function* () {
      for (let i = 0; i < COUNT; i++) yield { name: `files/n/${i}.txt`, data: String(i) };
    })(),
  );
  const entries = await readZip(path);
  assert.equal(entries.length, COUNT);
  assert.equal((await contentOf(path, entries[COUNT - 1]!)).toString(), String(COUNT - 1));
  const py = python(
    'import json, sys, zipfile\nz = zipfile.ZipFile(sys.argv[1])\nprint(json.dumps([len(z.infolist()), z.read("files/n/69999.txt").decode()]))',
    path,
  );
  if (py) assert.deepEqual(py, [COUNT, '69999']);
});

test('an entry over 4 GB gets ZIP64 sizes and the archive still opens', { timeout: 120_000 }, async () => {
  // 4.3 GB of zeros deflate to a few MB, so the archive stays small on disk.
  const BIG = 4_300_000_000;
  const path = await writeZip([
    { name: 'files/big.bin', open: async () => ({ size: BIG, stream: Readable.from(chunks(BIG, 4 * 1024 * 1024)) }) },
    { name: 'files/after.txt', data: 'still here' },
  ]);
  const [big, after] = await readZip(path);
  assert.equal(big!.raw, BIG);
  assert.ok(big!.packed < 50 * 1024 * 1024);
  // Inflate the whole entry as a stream to check the CRC without holding it.
  let crc = 0;
  let bytes = 0;
  const inflate = createInflateRaw();
  inflate.on('data', (c: Buffer) => {
    crc = crc32(c, crc);
    bytes += c.length;
  });
  await pipeline(createReadStream(path, { start: big!.dataStart, end: big!.dataStart + big!.packed - 1 }), inflate);
  assert.equal(bytes, BIG);
  assert.equal(crc, big!.crc);
  assert.equal((await contentOf(path, after!)).toString(), 'still here');
  const py = python(
    'import json, sys, zipfile\nz = zipfile.ZipFile(sys.argv[1])\ni = z.getinfo("files/big.bin")\nf = z.open(i)\nhead = f.read(1 << 20)\nprint(json.dumps([i.file_size, len(head), head.count(0), z.read("files/after.txt").decode()]))',
    path,
  );
  if (py) assert.deepEqual(py, [BIG, 1 << 20, 1 << 20, 'still here']);
});

test('stopping the consumer closes the open source', async () => {
  let closed = false;
  const zip = zipStream([{ name: 'files/a.bin', open: async () => ({ size: 10 * 1024 * 1024, stream: Readable.from(chunks(10 * 1024 * 1024, 65_536, 1)), close: async () => void (closed = true) }) }]);
  let seen = 0;
  for await (const chunk of zip) {
    seen += chunk.length;
    if (seen > 1000) break;
  }
  assert.ok(closed);
});
