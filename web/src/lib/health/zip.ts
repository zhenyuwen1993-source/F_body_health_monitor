// Minimal ZIP reader for Apple Health export.zip.
//
// We only need to locate one entry and stream it out, so instead of pulling in
// a zip library we parse the central directory by hand and let the browser's
// native DecompressionStream do the inflating. Apple's export.xml routinely
// exceeds 4 GB uncompressed, so ZIP64 fields are handled.

const EOCD_SIG = 0x06054b50;
const EOCD64_SIG = 0x06064b50;
const EOCD64_LOC_SIG = 0x07064b50;
const CEN_SIG = 0x02014b50;

export interface ZipEntry {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  method: number;
}

async function readSlice(blob: Blob, start: number, end: number): Promise<DataView> {
  const buf = await blob.slice(start, end).arrayBuffer();
  return new DataView(buf);
}

/** List the entries in a zip's central directory. */
export async function listZipEntries(blob: Blob): Promise<ZipEntry[]> {
  const size = blob.size;
  // EOCD lives in the last 64 KiB (22 bytes + up to 64 KiB of comment).
  const tailLen = Math.min(size, 65_557);
  const tail = await readSlice(blob, size - tailLen, size);

  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("不是有效的 zip 文件（找不到中央目录）。");

  let cdOffset = tail.getUint32(eocd + 16, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let count = tail.getUint16(eocd + 10, true);

  // ZIP64 when any field is saturated.
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff || count === 0xffff) {
    let loc = -1;
    for (let i = eocd - 20; i >= 0; i--) {
      if (tail.getUint32(i, true) === EOCD64_LOC_SIG) {
        loc = i;
        break;
      }
    }
    if (loc < 0) throw new Error("zip 缺少 ZIP64 定位记录。");
    const eocd64Off = Number(tail.getBigUint64(loc + 8, true));
    const z = await readSlice(blob, eocd64Off, eocd64Off + 56);
    if (z.getUint32(0, true) !== EOCD64_SIG) throw new Error("ZIP64 中央目录无效。");
    count = Number(z.getBigUint64(32, true));
    cdSize = Number(z.getBigUint64(40, true));
    cdOffset = Number(z.getBigUint64(48, true));
  }

  const cd = await readSlice(blob, cdOffset, cdOffset + cdSize);
  const entries: ZipEntry[] = [];
  let p = 0;
  const dec = new TextDecoder("utf-8");

  for (let n = 0; n < count && p + 46 <= cd.byteLength; n++) {
    if (cd.getUint32(p, true) !== CEN_SIG) break;
    const method = cd.getUint16(p + 10, true);
    let compressedSize = cd.getUint32(p + 20, true);
    let uncompressedSize = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    let localHeaderOffset = cd.getUint32(p + 42, true);

    const nameBytes = new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen);
    const name = dec.decode(nameBytes);

    // Walk the extra field for a ZIP64 record (id 0x0001) filling saturated values.
    let e = p + 46 + nameLen;
    const extraEnd = e + extraLen;
    while (e + 4 <= extraEnd) {
      const id = cd.getUint16(e, true);
      const len = cd.getUint16(e + 2, true);
      if (id === 0x0001) {
        let q = e + 4;
        if (uncompressedSize === 0xffffffff) {
          uncompressedSize = Number(cd.getBigUint64(q, true));
          q += 8;
        }
        if (compressedSize === 0xffffffff) {
          compressedSize = Number(cd.getBigUint64(q, true));
          q += 8;
        }
        if (localHeaderOffset === 0xffffffff) {
          localHeaderOffset = Number(cd.getBigUint64(q, true));
        }
        break;
      }
      e += 4 + len;
    }

    entries.push({ name, compressedSize, uncompressedSize, localHeaderOffset, method });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Open one entry as a decompressed byte stream. */
export async function openZipEntry(
  blob: Blob,
  entry: ZipEntry,
): Promise<ReadableStream<Uint8Array>> {
  // The local header repeats the name/extra lengths; data follows it.
  const lh = await readSlice(blob, entry.localHeaderOffset, entry.localHeaderOffset + 30);
  const nameLen = lh.getUint16(26, true);
  const extraLen = lh.getUint16(28, true);
  const dataStart = entry.localHeaderOffset + 30 + nameLen + extraLen;
  const raw = blob.slice(dataStart, dataStart + entry.compressedSize).stream();

  if (entry.method === 0) return raw as ReadableStream<Uint8Array>;
  if (entry.method === 8) {
    if (typeof DecompressionStream === "undefined")
      throw new Error("当前浏览器不支持解压，请手动解压后上传 export.xml。");
    return (raw as ReadableStream<Uint8Array>).pipeThrough(
      new DecompressionStream("deflate-raw") as unknown as ReadableWritablePair<
        Uint8Array,
        Uint8Array
      >,
    );
  }
  throw new Error(`不支持的 zip 压缩方式 (${entry.method})，请手动解压后上传。`);
}

/**
 * Pick the health export out of a zip: the biggest `.xml` that isn't the
 * clinical-records file (`export_cda.xml`) and isn't a macOS metadata entry.
 */
export function pickHealthXml(entries: ZipEntry[]): ZipEntry | undefined {
  const candidates = entries.filter((e) => {
    const n = e.name.toLowerCase();
    return (
      n.endsWith(".xml") &&
      !n.includes("cda") &&
      !n.startsWith("__macosx/") &&
      !n.split("/").pop()!.startsWith(".")
    );
  });
  if (!candidates.length) return undefined;
  const exact = candidates.find((e) => e.name.split("/").pop()!.toLowerCase() === "export.xml");
  if (exact) return exact;
  return candidates.sort((a, b) => b.uncompressedSize - a.uncompressedSize)[0];
}
