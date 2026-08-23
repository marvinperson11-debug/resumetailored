#!/usr/bin/env node
/**
 * LARGE UPLOADS — streamed to disk, and nothing left behind.
 *
 * The per-file cap went from 25 MB to 100 MB, which is only safe because the
 * file no longer passes through memory: `multer.memoryStorage` buffers the
 * whole thing in the heap before the route sees it, so a handful of concurrent
 * 100 MB uploads is how a small container dies.
 *
 * Disk storage moves the risk rather than removing it. The file now exists
 * BEFORE any check runs, so every rejection — wrong type, too large for its
 * kind, quota full, not signed in, not Pro — has to delete it. A refused upload
 * that leaves 100 MB behind fills the volume with files no row points at, and
 * nothing would ever notice. That is what most of this measures.
 *
 * Usage: node test/media-upload-disk.js
 */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-updisk-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';
const { app } = require('../server.js');
const Database = require('better-sqlite3');

const db = new Database(path.join(process.env.DATA_DIR, 'resumetailor.db'));
db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run('m@x.com', 'm', 'x');
db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('tokM', 'm@x.com');
db.prepare('INSERT INTO subscribers (email,customer_id) VALUES (?,?)').run('m@x.com', 'cM');
db.prepare("INSERT INTO employer_subscribers (email,customer_id,tier,status) VALUES (?,?,'corporate','active')").run('m@x.com', 'ecM');
const _now = Date.now();
db.prepare('INSERT INTO personal_sites (subdomain,email,text,created_at,updated_at) VALUES (?,?,?,?,?)')
  .run('site-one', 'm@x.com', 'placeholder', _now, _now);
// A second account with no subscription: the Pro gate is a rejection path too.
db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run('f@x.com', 'f', 'x');
db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('tokF', 'f@x.com');

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const TMP = path.join(process.env.DATA_DIR, 'site-media', '.tmp');
const tmpCount = () => { try { return fs.readdirSync(TMP).length; } catch (_) { return 0; } };
const MB = 1024 * 1024;

const server = app.listen(0, async () => {
  const B = `http://127.0.0.1:${server.address().port}`;
  const SUB = 'site-one';
  const up = async (buf, name, mime, tok) => {
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type: mime }), name);
    fd.append('subdomain', SUB);
    const r = await fetch(B + '/api/site-media', {
      method: 'POST', headers: tok === null ? {} : { Authorization: 'Bearer ' + (tok || 'tokM') }, body: fd,
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const upStreamed = (bytes, name, mime) => new Promise((resolve, reject) => {
    const boundary = '----rtMediaLimitBoundary';
    const before = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`);
    const after = Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="subdomain"\r\n\r\n${SUB}\r\n--${boundary}--\r\n`);
    const target = new URL(B + '/api/site-media');
    const req = http.request({
      hostname: target.hostname, port: target.port, path: target.pathname, method: 'POST',
      headers: {
        Authorization: 'Bearer tokM',
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': before.length + bytes + after.length,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        let body = {}; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) {}
        resolve({ status: res.statusCode, body });
      });
    });
    req.on('error', reject);
    req.write(before);
    const chunk = Buffer.alloc(MB, 3);
    let remaining = bytes;
    const write = () => {
      while (remaining > 0) {
        const part = remaining >= chunk.length ? chunk : chunk.subarray(0, remaining);
        remaining -= part.length;
        if (!req.write(part)) { req.once('drain', write); return; }
      }
      req.end(after);
    };
    write();
  });

  try {
    const limits = (await (await fetch(B + '/api/site-media?subdomain=' + SUB, { headers: { Authorization: 'Bearer tokM' } })).json()).usage.limits;
    check('the per-file video cap is 100 MB', limits.perFile.video === 100 * MB, String(limits.perFile.video));
    check('and the pool is still 1 GB per user', limits.videoPool === 1024 * MB, String(limits.videoPool));
    check('images and audio keep their own, smaller caps',
      limits.perFile.image === 8 * MB && limits.perFile.audio === 25 * MB, JSON.stringify(limits.perFile));

    /* THE HEADLINE: a file far past the OLD 25 MB ceiling goes through. Really
       100 MB of bytes, not a claim about one — the point is that it never sits
       in the heap, and only a real file exercises that. */
    let big = Buffer.alloc(100 * MB - 1024, 9);
    const bigBytes = big.length;
    const r1 = await up(big, 'big.mp4', 'video/mp4');
    check('a 100 MB video uploads', r1.status === 200, JSON.stringify(r1.body).slice(0, 200));
    check('and is stored at its full size', r1.body.bytes === bigBytes, String(r1.body.bytes));
    const row = db.prepare('SELECT path, bytes FROM site_media WHERE id = ?').get(r1.body.id);
    check('the bytes really reached the disk',
      row && fs.existsSync(row.path) && fs.statSync(row.path).size === bigBytes,
      row ? String(fs.existsSync(row.path) && fs.statSync(row.path).size) : 'no row');
    check('and the temp directory is empty afterwards', tmpCount() === 0, 'left ' + tmpCount());
    // Do not retain two 100+ MB client fixtures simultaneously. Real browser
    // uploads are sequential too; keeping the first Buffer alive made undici
    // intermittently fail before the second request reached the server.
    big = null;

    /* EVERY REJECTION SWEEPS UP. Each of these writes a file to disk before the
       route can refuse it; each must leave the temp directory as it found it. */
    const leaks = [];
    const noLeak = async (label, fn) => {
      const r = await fn();
      // Windows may report the response a few milliseconds before antivirus or
      // the multipart reader releases its last directory handle. The server
      // has already scheduled synchronous cleanup; allow that release to land.
      for (let i = 0; i < 10 && tmpCount() !== 0; i++) await new Promise(resolve => setTimeout(resolve, 25));
      if (tmpCount() !== 0) leaks.push(label + ' (' + tmpCount() + ' left)');
      return r;
    };
    const tooBigImage = await noLeak('oversized image', () => up(Buffer.alloc(9 * MB, 1), 'x.png', 'image/png'));
    check('an image past its own 8 MB cap is refused even though multer allows 100 MB',
      tooBigImage.status === 400 && /too large/i.test(tooBigImage.body.error || ''), JSON.stringify(tooBigImage.body));

    const badType = await noLeak('unsupported type', () => up(Buffer.alloc(1024), 'x.exe', 'application/x-msdownload'));
    check('an unsupported type is refused', badType.status === 400, String(badType.status));

    const notPro = await noLeak('not a subscriber', () => up(Buffer.alloc(1024), 'x.png', 'image/png', 'tokF'));
    check('a non-subscriber is refused', notPro.status === 402, String(notPro.status));

    const noAuth = await noLeak('not signed in', () => up(Buffer.alloc(1024), 'x.png', 'image/png', null));
    check('a signed-out request is refused', noAuth.status === 401, String(noAuth.status));

    // Fill the video pool, then refuse — the last rejection path.
    db.prepare("UPDATE site_media SET bytes = ? WHERE kind = 'video' AND site_sub = ?").run(1024 * MB, SUB);
    const full = await noLeak('pool full', () => up(Buffer.alloc(2 * MB), 'y.mp4', 'video/mp4'));
    check('a full pool is refused', full.status === 400 && /storage is full/i.test(full.body.error || ''), JSON.stringify(full.body));

    check('NO rejection leaves its file behind on disk', leaks.length === 0, leaks.join('; '));

    /* Past multer's own ceiling the request dies mid-stream; the partial file
       still has to go. */
    // Stream this fixture in 1 MB chunks. Constructing another 101 MB Blob in
    // Node's experimental FormData client can fail locally before any request
    // reaches Express, which tests undici's heap rather than the upload route.
    const past = await upStreamed(101 * MB, 'huge.mp4', 'video/mp4');
    check('a file past 100 MB is refused with the right number',
      past.status === 400 && /100 MB/.test(past.body.error || ''), JSON.stringify(past.body));
    await new Promise((r) => setTimeout(r, 300));
    check('and its partial write is cleaned up too', tmpCount() === 0, 'left ' + tmpCount());

    // The client must show progress, or 100 MB looks like a hang.
    const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8');
    check('the uploader reports progress rather than a silent wait',
      /xhr\.upload\.onprogress/.test(appJs) && /new XMLHttpRequest\(\)/.test(appJs)
      && /lengthComputable/.test(appJs), 'app.html has no upload progress');
  } catch (e) {
    check('the run completed', false, e && e.message);
  }

  server.close();
  if (failures) { console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`); process.exit(1); }
  console.log('\nALL PASS (0 failures)');
  process.exit(0);
});
