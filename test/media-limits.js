#!/usr/bin/env node
/**
 * MEDIA LIMITS — the video count cap, storage, and the owner alert.
 *
 * Locked-in policy, from the account owner directly: 5 videos per SITE, 1 GB
 * total storage per site, an email when someone hits the 5-video wall. This
 * REVERSES the immediately preceding round's "remove the count cap entirely"
 * decision — on purpose, at the owner's explicit instruction, not by drift.
 * See the comment on MEDIA_LIMITS in server.js for the full reasoning; this
 * file exists to prove the reinstated cap actually behaves the way that
 * decision assumes it does.
 *
 * PER SITE, not per account — added after the account-wide version of this
 * cap shipped and was reported directly: "I hit my limit and I haven't
 * uploaded anything," because a video from a template tried once, months
 * earlier, was still sitting in a pool shared across every site the account
 * had ever built. `site_media.site_sub` ties each row to the one site it
 * belongs to; this file's user owns two sites specifically to prove a video
 * on one never spends the other's slot.
 *
 * What made the ORIGINAL cap a bad experience wasn't the number 5 — it's that
 * hitting it was a dead end ("Delete one first" with no way to delete) and
 * that the count included videos the user never chose to upload (the
 * text-video generator's own output). The second point is deliberately NOT
 * fixed here — every video-kind row counts, generated or uploaded, because no
 * exemption was asked for. The first point WAS already fixed, in the previous
 * round: the Uploads panel has a real delete button. So this file also proves
 * that hitting 5 is recoverable, not just that it happens.
 *
 * Video CONTENT here is garbage bytes (`Buffer.alloc`), not a real container —
 * deliberately, because none of what this file tests (the count, the pool, the
 * alert, delete-then-reupload) depends on the file being a playable video, and
 * the duration prober fails OPEN on anything it cannot parse (see
 * _probeVideoDurationSeconds), so garbage bytes are treated as "duration
 * unknown" and never blocked on length. The DURATION cap itself — which does
 * require a real, parseable clip — is proven separately in
 * test/media-video-duration.js against small checked-in fixtures.
 *
 * Usage: node test/media-limits.js
 */
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-md-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';
// Keep this integration test hermetic: it asserts the no-provider console
// fallback as proof that the owner alert fired, and must never send a real
// email merely because local .env credentials are present.
process.env.RESEND_API_KEY = '';
process.env.SMTP_USER = '';
process.env.SMTP_PASS = '';
const { app } = require('../server.js');
const Database = require('better-sqlite3');

const db = new Database(path.join(process.env.DATA_DIR, 'resumetailor.db'));
db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run('m@x.com', 'm', 'x');
db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('tokM', 'm@x.com');
db.prepare('INSERT INTO subscribers (email,customer_id) VALUES (?,?)').run('m@x.com', 'cM');
db.prepare("INSERT INTO employer_subscribers (email,customer_id,tier,status) VALUES (?,?,'corporate','active')").run('m@x.com', 'ecM');
const now = Date.now();
db.prepare('INSERT INTO personal_sites (subdomain,email,text,created_at,updated_at) VALUES (?,?,?,?,?)')
  .run('site-one', 'm@x.com', 'placeholder', now, now);
// A second site, to prove the cap really is per-site and not just re-labelled
// per-account: uploads here must never spend site-one's slots.
db.prepare('INSERT INTO personal_sites (subdomain,email,text,created_at,updated_at) VALUES (?,?,?,?,?)')
  .run('site-two', 'm@x.com', 'placeholder', now, now);

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC', 'base64');
let fails = 0;
const check = (n, c, d) => { if (c) console.log('PASS  ' + n); else { fails++; console.error('FAIL  ' + n + (d ? ' — ' + d : '')); } };

const server = app.listen(0, async () => {
  const B = `http://127.0.0.1:${server.address().port}`;
  const H = { Authorization: 'Bearer tokM' };
  const SUB = 'site-one';
  const list = async (sub) => (await (await fetch(B + '/api/site-media?subdomain=' + (sub || SUB), { headers: H })).json());
  const up = async (buf, name, mime, sub) => {
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type: mime }), name);
    fd.append('subdomain', sub || SUB);
    const r = await fetch(B + '/api/site-media', { method: 'POST', headers: H, body: fd });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const vid = (n) => Buffer.alloc(n, 7);

  // ── A UPLOAD ON A DIFFERENT SITE DOES NOT COUNT HERE. ─────────────────
  // Reproduces the exact report: hitting a limit with nothing on the site
  // being edited, because old uploads on a DIFFERENT site were still counted.
  for (let i = 0; i < 5; i++) await up(vid(1000), 'other' + i + '.mp4', 'video/mp4', 'site-two');
  const siteOneStart = (await list('site-one')).usage;
  check('five videos on a different site count zero here',
    siteOneStart.videoCount === 0, JSON.stringify(siteOneStart));

  // ── THE ORIGINAL REPORT: two images, then a video. ───────────────────
  await up(PNG, 'a.png', 'image/png');
  await up(PNG, 'b.png', 'image/png');
  const afterImgs = (await list()).usage;
  check('two images count as zero videos', afterImgs.videoCount === 0, JSON.stringify(afterImgs));
  const v1 = await up(vid(1000), 'v.mp4', 'video/mp4');
  check('and a video after two images uploads', v1.status === 200, JSON.stringify(v1.body).slice(0, 160));

  // ── THE CAP: five succeed, the sixth is refused. ──────────────────────
  const cap = (await list()).usage.limits.videoMaxCount;
  check('the policy is 5 videos per site', cap === 5, String(cap));
  for (let i = 0; i < cap - 1; i++) {
    const r = await up(vid(1000), 'c' + i + '.mp4', 'video/mp4');
    check(`video ${i + 2}/${cap} uploads`, r.status === 200, JSON.stringify(r.body).slice(0, 140));
  }
  const atCap = (await list()).usage;
  check('five videos are now stored (one from the report + four more)', atCap.videoCount === cap, String(atCap.videoCount));
  check('images are still counted apart from video',
    atCap.imageAudioCount === 2 && atCap.videoCount === cap, JSON.stringify(atCap));

  // ── THE SIXTH IS REFUSED, RECOVERABLY. ────────────────────────────────
  let logs = [];
  const origLog = console.log;
  console.log = (...a) => { logs.push(a.join(' ')); };
  const sixth = await up(vid(1000), 'sixth.mp4', 'video/mp4');
  console.log = origLog;
  check('the 6th video is refused', sixth.status === 400, String(sixth.status));
  check('the refusal names the cap and points at Uploads, not "delete one first" verbatim',
    /5-video limit/i.test(sixth.body.error || '') && /Uploads/.test(sixth.body.error || ''), sixth.body.error);
  check('and an owner alert fired for it',
    logs.some((l) => l.includes('[EMAIL]') && l.includes('hit the 5-video limit') && l.includes('m@x.com')),
    logs.join(' | ').slice(0, 300));

  /* THE DEDUP. "Send me an alert" was not "send me one per attempt" — a stuck
     client or a frustrated user pressing upload again would otherwise fill the
     owner's inbox with the same fact repeated. At most once per user per day. */
  logs = [];
  console.log = (...a) => { logs.push(a.join(' ')); };
  await up(vid(1000), 'seventh.mp4', 'video/mp4');
  console.log = origLog;
  check('a second hit the same day does not alert again',
    !logs.some((l) => l.includes('hit the 5-video limit')), logs.join(' | ').slice(0, 200));

  // ── DELETE MAKES ROOM, FOR REAL. ──────────────────────────────────────
  const items = (await list()).items;
  const one = items.find((i) => i.kind === 'video');
  const del = await fetch(B + '/api/site-media/' + one.id, { method: 'DELETE', headers: H });
  const afterDel = await del.json();
  check('deleting a video frees a slot', del.status === 200 && afterDel.usage.videoCount === cap - 1, JSON.stringify(afterDel.usage || {}));
  const freed = await up(vid(1000), 'ok.mp4', 'video/mp4');
  check('and the freed slot is usable again', freed.status === 200, JSON.stringify(freed.body).slice(0, 140));

  // ── STORAGE REMAINS A BACKSTOP BEHIND THE COUNT. ──────────────────────
  const pool = atCap.limits.videoPool;
  check('the pool the owner asked to keep is still 1 GB', pool === 1024 * 1024 * 1024, String(pool));
  const nVids = (await list()).usage.videoCount;
  db.prepare("UPDATE site_media SET bytes = ? WHERE kind = 'video' AND site_sub = ?").run(Math.ceil(pool / nVids), SUB);
  // A 6th slot doesn't exist to test the pool through normally (count caps
  // first at 5), so free one, fill the pool across the remaining four, and
  // prove the pool itself still refuses independently of the count.
  const items2 = (await list()).items;
  const vids2 = items2.filter((i) => i.kind === 'video');
  await fetch(B + '/api/site-media/' + vids2[0].id, { method: 'DELETE', headers: H });
  db.prepare("UPDATE site_media SET bytes = ? WHERE kind = 'video' AND site_sub = ?").run(Math.ceil(pool / (vids2.length - 1)), SUB);
  const poolFull = await up(vid(1000), 'poolfull.mp4', 'video/mp4');
  check('a full pool is still refused even with room left in the count',
    poolFull.status === 400 && /storage is full/i.test(poolFull.body.error || ''), JSON.stringify(poolFull.body));

  // ── A ROW WITH NO KIND MUST NOT BECOME A VIDEO. ───────────────────────
  const before = (await list()).usage;
  db.prepare("INSERT INTO site_media (email, kind, path, mime, bytes, created_at, site_sub) VALUES (?,?,?,?,?,?,?)")
    .run('m@x.com', '', '/tmp/none', 'image/png', 10, Date.now(), SUB);
  const odd = (await list()).usage;
  check('a row whose kind is missing is read from its mime, not called a video',
    odd.videoCount === before.videoCount, before.videoCount + ' → ' + odd.videoCount);

  // ── THE PANEL STILL OFFERS THE DELETE THAT MAKES THE CAP RECOVERABLE. ─
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8');
  check('the Uploads panel offers a delete on every file',
    /class="cv-updel"[^>]*onclick="cvDeleteMedia\(/.test(appJs) && /async function cvDeleteMedia\(/.test(appJs));
  check('and it calls the route that already existed',
    /fetch\('\/api\/site-media\/' \+ Number\(id\), \{ method: 'DELETE'/.test(appJs));
  check('the meter counts down to the cap again — "(n/5 clips)"',
    /L\.videoMaxCount \? ' \(' \+ n \+ '\/' \+ L\.videoMaxCount/.test(appJs));

  // ── THE PRODUCTION DEFAULT, WITHOUT AN ENV OVERRIDE. ──────────────────
  // Duration ENFORCEMENT (a real clip actually being rejected) needs a real
  // parseable file and lives in test/media-video-duration.js; this just pins
  // the number that ships when MEDIA_MAX_VIDEO_SEC is unset.
  const srvJs = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  check('the shipped default video duration cap is 2 minutes (120s)',
    /videoMaxDurationSec: Number\(process\.env\.MEDIA_MAX_VIDEO_SEC\) > 0 \? Number\(process\.env\.MEDIA_MAX_VIDEO_SEC\) : 120,/.test(srvJs));

  server.close();
  if (fails) { console.error('\nFAILED (' + fails + ' failure' + (fails === 1 ? '' : 's') + ')'); process.exit(1); }
  console.log('\nALL PASS (0 failures)');
  process.exit(0);
});
