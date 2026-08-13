// Minimal zip reader: locate the health export XML inside Apple Health's
// export.zip and return a decompressed byte stream. Uses the browser-native
// DecompressionStream — no dependencies, nothing loaded fully into memory
// (Blob.slice is a zero-copy view; deflate runs as a stream).

const SIG_EOCD = 0x06054b50; // end of central directory
const SIG_CEN = 0x02014b50; // central directory file header
const SIG_LOC = 0x04034b50; // local file header

interface ZipEntry {
  name: string;
  method: number; // 0 = stored, 8 = deflate
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export interface ExtractedXml {
  stream: ReadableStream<Uint8Array>;
  /** Uncompressed size in bytes (0 if unknown). */
  totalBytes: number;
  entryName: string;
}

/** True when the blob starts with the zip local-file-header magic. */
export async function isZipFile(file: Blob): Promise<boolean> {
  if (file.size < 4) return false;
  const b = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  return b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}

async function readCentralDirectory(file: Blob): Promise<ZipEntry[]> {
  // EOCD sits at the very end, preceded by a comment of up to 65535 bytes.
  const tailLen = Math.min(file.size, 65558);
  const tail = new Uint8Array(
    await file.slice(file.size - tailLen).arrayBuffer(),
  );
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (
      tail[i] === 0x50 &&
      tail[i + 1] === 0x4b &&
      tail[i + 2] === 0x05 &&
      tail[i + 3] === 0x06
    ) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("不是有效的 zip 文件（找不到目录结尾）。");
  const dv = new DataView(tail.buffer, tail.byteOffset + eocd);
  if (dv.getUint32(0, true) !== SIG_EOCD)
    throw new Error("zip 目录结构异常。");
  const cdSize = dv.getUint32(12, true);
  const cdOffset = dv.getUint32(16, true);
  if (cdOffset === 0xffffffff)
    throw new Error("这个 zip 使用了 zip64 格式（超大文件）。请解压后拖入 export.xml。");

  const buf = new Uint8Array(
    await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer(),
  );
  const cdv = new DataView(buf.buffer, buf.byteOffset);
  const entries: ZipEntry[] = [];
  const utf8 = new TextDecoder("utf-8");
  let p = 0;
  while (p + 46 <= buf.length) {
    if (cdv.getUint32(p, true) !== SIG_CEN) break;
    const method = cdv.getUint16(p + 10, true);
    const compressedSize = cdv.getUint32(p + 20, true);
    const uncompressedSize = cdv.getUint32(p + 24, true);
    const nameLen = cdv.getUint16(p + 28, true);
    const extraLen = cdv.getUint16(p + 30, true);
    const commentLen = cdv.getUint16(p + 32, true);
    const localHeaderOffset = cdv.getUint32(p + 42, true);
    const name = utf8.decode(buf.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * Find the main health-export XML inside the zip. Apple localizes the file
 * name (`export.xml`, `导出.xml`, …), so instead of matching names we pick the
 * largest `.xml` entry that isn't the clinical-records (`_cda`) file.
 */
function pickExportEntry(entries: ZipEntry[]): ZipEntry {
  const xmls = entries.filter(
    (e) => e.name.toLowerCase().endsWith(".xml") && !/cda/i.test(e.name),
  );
  if (xmls.length === 0)
    throw new Error("zip 里没有找到 XML 数据文件。请确认这是健康 App 导出的压缩包。");
  return xmls.reduce((a, b) => (b.uncompressedSize > a.uncompressedSize ? b : a));
}

/** Extract the export XML from an Apple Health export.zip as a byte stream. */
export async function extractExportXml(file: Blob): Promise<ExtractedXml> {
  const entry = pickExportEntry(await readCentralDirectory(file));
  if (entry.compressedSize === 0xffffffff)
    throw new Error("这个 zip 条目超过 4GB，浏览器端暂不支持。请解压后拖入 export.xml。");
  if (entry.method !== 0 && entry.method !== 8)
    throw new Error("zip 使用了不支持的压缩方式。请解压后拖入 export.xml。");

  // Local header tells us where the actual data starts (its name/extra fields
  // can differ in length from the central directory's copy).
  const off = entry.localHeaderOffset;
  const lh = new DataView(await file.slice(off, off + 30).arrayBuffer());
  if (lh.getUint32(0, true) !== SIG_LOC)
    throw new Error("zip 本地文件头异常。");
  const nameLen = lh.getUint16(26, true);
  const extraLen = lh.getUint16(28, true);
  const dataStart = off + 30 + nameLen + extraLen;
  const compressed = file.slice(dataStart, dataStart + entry.compressedSize);

  let stream: ReadableStream<Uint8Array>;
  if (entry.method === 0) {
    stream = compressed.stream() as ReadableStream<Uint8Array>;
  } else {
    if (typeof DecompressionStream === "undefined")
      throw new Error("你的浏览器不支持在线解压。请解压 zip 后拖入 export.xml。");
    // `DecompressionStream` is typed with a `BufferSource` writable side, which
    // TypeScript won't unify with `ReadableStream<Uint8Array>` on its own.
    stream = (compressed.stream() as ReadableStream<Uint8Array>).pipeThrough(
      new DecompressionStream("deflate-raw") as unknown as ReadableWritablePair<
        Uint8Array,
        Uint8Array
      >,
    );
  }
  const totalBytes =
    entry.uncompressedSize === 0xffffffff ? 0 : entry.uncompressedSize;
  return { stream, totalBytes, entryName: entry.name };
}
