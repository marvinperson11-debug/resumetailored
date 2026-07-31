#!/usr/bin/env node
/**
 * THE 2-MINUTE VIDEO CAP — enforced against a video's OWN duration, not its
 * file size, and proven against a REAL, parseable clip rather than a byte
 * count. Locked-in policy: 2 minutes max per video.
 *
 * A count cap and a size cap can both be satisfied by a video that is far too
 * long — a screen recording can be two hours and under 100 MB, and a
 * two-minute 4K clip can be well over it. So this reads the clip's own
 * container metadata (@remotion/media-parser) before accepting it, and this
 * file is what proves that mechanism actually rejects and actually accepts,
 * using two tiny checked-in fixtures under test/fixtures/ — real WebM/MP4
 * bytes recorded once via MediaRecorder in Chromium (see
 * test/fixtures/README.md for how to regenerate them), not garbage bytes.
 * Garbage bytes are exactly what test/media-limits.js uses for everything
 * that does NOT depend on the file being real, because the duration prober
 * fails OPEN on anything it cannot parse — proving that here would need a
 * THIRD kind of fixture (a corrupt-but-plausible container) for a claim
 * `server.js`'s own comment on _probeVideoDurationSeconds already states and
 * that test/media-upload-disk.js already depends on being true (its "100 MB
 * video" is `Buffer.alloc`, and it uploads successfully today).
 *
 * The production cap is 120s; recording a genuine 2-minute-plus clip on every
 * test run would make this the slowest file in the suite for no benefit, so
 * MEDIA_MAX_VIDEO_SEC lets the cap be shrunk for the test process only — see
 * the comment on it in server.js. `clip-long.*` (~0.9s) and `clip-short.webm`
 * (~0.15s) straddle a 0.5s test cap the same way any real clip straddles the
 * real one.
 *
 * Usage: node test/media-video-duration.js
 */
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-mvd-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';
process.env.MEDIA_MAX_VIDEO_SEC = '0.5';
const { app } = require('../server.js');
const Database = require('better-sqlite3');

const db = new Database(path.join(process.env.DATA_DIR, 'resumetailor.db'));
db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run('m@x.com', 'm', 'x');
db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('tokM', 'm@x.com');
db.prepare('INSERT INTO subscribers (email,customer_id) VALUES (?,?)').run('m@x.com', 'cM');

const FIX = path.join(__dirname, 'fixtures');
let fails = 0;
const check = (n, c, d) => { if (c) console.log('PASS  ' + n); else { fails++; console.error('FAIL  ' + n + (d ? ' — ' + d : '')); } };

const server = app.listen(0, async () => {
  const B = `http://127.0.0.1:${server.address().port}`;
  const H = { Authorization: 'Bearer tokM' };
  const upFile = async (fname, mime) => {
    const buf = fs.readFileSync(path.join(FIX, fname));
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type: mime }), fname);
    const r = await fetch(B + '/api/site-media', { method: 'POST', headers: H, body: fd });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  const usage0 = (await (await fetch(B + '/api/site-media', { headers: H })).json()).usage;
  check('the test process picked up the shrunk cap', usage0.limits.videoMaxDurationSec === 0.5, String(usage0.limits.videoMaxDurationSec));

  // ── A clip clearly UNDER the cap uploads. ─────────────────────────────
  const short = await upFile('clip-short.webm', 'video/webm');
  check('a ~0.15s real clip is accepted under a 0.5s cap', short.status === 200, JSON.stringify(short.body).slice(0, 200));

  const tmp = path.join(process.env.DATA_DIR, 'site-media', '.tmp');
  const tmpCount = () => { try { return fs.readdirSync(tmp).length; } catch (_) { return 0; } };

  // ── A clip clearly OVER the cap is refused, in both containers. ──────
  const longWebm = await upFile('clip-long.webm', 'video/webm');
  check('a ~0.9s real WebM is refused over a 0.5s cap', longWebm.status === 400, String(longWebm.status));
  check('the message states the actual length and the limit',
    /\d+s long/.test(longWebm.body.error || '') && /the limit is 1s/.test(longWebm.body.error || ''),
    longWebm.body.error);
  check('and leaves no temp file behind', tmpCount() === 0, 'left ' + tmpCount());

  const longMp4 = await upFile('clip-long.mp4', 'video/mp4');
  check('the same is true in MP4, not only WebM', longMp4.status === 400 && /long/.test(longMp4.body.error || ''), JSON.stringify(longMp4.body));
  check('and MP4 leaves no temp file either', tmpCount() === 0, 'left ' + tmpCount());

  // ── Rejected-for-length must not spend a count-cap slot. ──────────────
  const usageAfter = (await (await fetch(B + '/api/site-media', { headers: H })).json()).usage;
  check('only the accepted short clip counts — the two rejections do not',
    usageAfter.videoCount === 1, 'videoCount=' + usageAfter.videoCount);

  // ── Garbage bytes are duration-UNKNOWN, not duration-zero, and pass. ──
  // This is the fail-open path test/media-limits.js and
  // test/media-upload-disk.js both already rely on implicitly; asserted
  // directly here, once, where the duration cap is actually active.
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.alloc(2048, 9)], { type: 'video/mp4' }), 'garbage.mp4');
  const garbage = await fetch(B + '/api/site-media', { method: 'POST', headers: H, body: fd });
  check('an unparseable "video" is not rejected for length — duration unknown is not duration over',
    garbage.status === 200, String(garbage.status));

  server.close();
  if (fails) { console.error('\nFAILED (' + fails + ' failure' + (fails === 1 ? '' : 's') + ')'); process.exit(1); }
  console.log('\nALL PASS (0 failures)');
  process.exit(0);
});
