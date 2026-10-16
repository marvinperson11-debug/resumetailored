/**
 * Dependency-free helpers for the Craft sidecar: pull the uploaded file out of a multipart body, and pack page
 * PNGs into a store-only ZIP (PNGs are already deflated, so storing them is the right choice, not a shortcut).
 */
const zlib = require("zlib");

// zlib.crc32 is Node >= 20.15; the table version covers anything older.
let TABLE;
const crc32 = zlib.crc32 || ((buf) => {
  if (!TABLE) TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  let c = 0xffffffff;
  for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
});

/**
 * The bytes of the first file part (`name="file"`, or any part with a filename) of a multipart/form-data body,
 * or null. The caller has already capped the body size, so this works on a complete in-memory buffer.
 */
function multipartFile(body, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType || "");
  if (!m) return null;
  const delim = Buffer.from(`--${m[1] || m[2]}`);
  const next = Buffer.concat([Buffer.from("\r\n"), delim]);
  let pos = body.indexOf(delim);
  if (pos < 0) return null;
  for (;;) {
    pos += delim.length;
    if (body.subarray(pos, pos + 2).toString() === "--") return null; // closing delimiter: no file part
    pos += 2; // CRLF after the delimiter
    const headEnd = body.indexOf("\r\n\r\n", pos);
    if (headEnd < 0) return null;
    const headers = body.subarray(pos, headEnd).toString("utf8");
    const end = body.indexOf(next, headEnd + 4);
    if (end < 0) return null;
    if (/content-disposition:[^\r\n]*(\bname="file"|\bfilename=)/i.test(headers)) return body.subarray(headEnd + 4, end);
    pos = end + 2;
  }
}

/** A store-only ZIP of [{ name, data }]. */
function storedZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const fname = Buffer.from(name);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fname.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(fname.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, fname, data);
    centrals.push(central, fname);
    offset += 30 + fname.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

module.exports = { multipartFile, storedZip };
