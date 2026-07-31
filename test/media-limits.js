#!/usr/bin/env node
/**
 * MEDIA LIMITS — what is counted, what is capped, and what the message says.
 *
 * The reported symptom was "Video limit reached (max 5)" after uploading two
 * images and one video. The count was arithmetically right; what was wrong was
 * everything around it. The cap counted every video ever stored — including the
 * ones the text video generator writes on the user's behalf, which they never
 * chose to upload — the meter counted down to it as "4/5" without saying what
 * would happen at 5, and the message told them to "delete one first" when the
 * Uploads panel had no way to delete anything. The DELETE route existed and
 * nothing in the app reached it.
 *
 * So: no count cap, storage as the only real limit, a message that says what is
 * stored and where to clear it, and a delete that exists.
 *
 * Usage: node test/media-limits.js
 */
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-md-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';
const { app } = require('../server.js');
const Database = require('better-sqlite3');

const db = new Database(path.join(process.env.DATA_DIR, 'resumetailor.db'));
db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run('m@x.com', 'm', 'x');
db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('tokM', 'm@x.com');
db.prepare('INSERT INTO subscribers (email,customer_id) VALUES (?,?)').run('m@x.com', 'cM');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC', 'base64');
let fails = 0;
const check = (n, c, d) => { if (c) console.log('PASS  ' + n); else { fails++; console.error('FAIL  ' + n + (d ? ' — ' + d : '')); } };

const server = app.listen(0, async () => {
  const B = `http://127.0.0.1:${server.address().port}`;
  const H = { Authorization: 'Bearer tokM' };
  const up = async (buf, name, mime) => {
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type: mime }), name);
    const r = await fetch(B + '/api/site-media', { method: 'POST', headers: H, body: fd });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const vid = (n) => Buffer.alloc(n, 7);

  // ── THE REPORT: two images, then a video. ────────────────────────────
  await up(PNG, 'a.png', 'image/png');
  await up(PNG, 'b.png', 'image/png');
  const afterImgs = (await (await fetch(B + '/api/site-media', { headers: H })).json()).usage;
  check('two images count as zero videos', afterImgs.videoCount === 0, JSON.stringify(afterImgs));
  const v1 = await up(vid(1000), 'v.mp4', 'video/mp4');
  check('and a video after two images uploads', v1.status === 200, JSON.stringify(v1.body).slice(0, 160));

  // ── THE CAP THAT WAS THERE: six videos in a row. ─────────────────────
  let lastStatus = 200;
  for (let i = 0; i < 24; i++) { const r = await up(vid(1000), 'c' + i + '.mp4', 'video/mp4'); lastStatus = r.status; }
  const many = (await (await fetch(B + '/api/site-media', { headers: H })).json()).usage;
  check('twenty-five videos upload without hitting a count cap', lastStatus === 200 && many.videoCount === 25,
    'last=' + lastStatus + ' count=' + many.videoCount);
  check('the limits no longer advertise a video count cap',
    many.limits.videoMaxCount === undefined, JSON.stringify(many.limits));
  check('images are still counted apart from video',
    many.imageAudioCount === 2 && many.videoCount === 25, JSON.stringify(many));

  // ── STORAGE IS THE REAL LIMIT, AND IT SAYS SO. ───────────────────────
  const pool = many.limits.videoPool;
  check('the video pool is big enough for a showreel', pool >= 1024 * 1024 * 1024, String(pool));
  /* Fill the pool EXACTLY, by sharing it across the rows that exist, so that
     removing one frees a real, known amount. Setting every row to half the pool
     (as this did first) leaves 24 half-pools behind and no delete can ever make
     room — a scenario that tests nothing but its own arithmetic. */
  const nVids = many.videoCount;
  db.prepare("UPDATE site_media SET bytes = ? WHERE kind = 'video'").run(Math.ceil(pool / nVids));
  const full = await up(vid(1000), 'z.mp4', 'video/mp4');
  check('a genuinely full pool is refused', full.status === 400, String(full.status));
  check('and the refusal says what is stored and where to clear it',
    /storage is full/i.test(full.body.error || '') && /MB of/.test(full.body.error || '')
    && /Uploads/.test(full.body.error || '') && !/max 5|Delete one first/i.test(full.body.error || ''),
    full.body.error);

  // ── AND A FILE CAN ACTUALLY BE DELETED. ──────────────────────────────
  const list = (await (await fetch(B + '/api/site-media', { headers: H })).json()).items;
  const one = list.find((i) => i.kind === 'video');
  const del = await fetch(B + '/api/site-media/' + one.id, { method: 'DELETE', headers: H });
  const after = await del.json();
  check('deleting a file works and reports the new usage',
    del.status === 200 && after.usage && after.usage.videoCount === nVids - 1, JSON.stringify(after.usage || {}));
  const freed = await up(vid(1000), 'ok.mp4', 'video/mp4');
  check('and the freed space is usable again', freed.status === 200, JSON.stringify(freed.body).slice(0, 140));

  // ── A ROW WITH NO KIND MUST NOT BECOME A VIDEO. ──────────────────────
  db.prepare("INSERT INTO site_media (email, kind, path, mime, bytes, created_at) VALUES (?,?,?,?,?,?)")
    .run('m@x.com', '', '/tmp/none', 'image/png', 10, new Date().toISOString());
  const before = (await (await fetch(B + '/api/site-media', { headers: H })).json()).usage;
  db.prepare("INSERT INTO site_media (email, kind, path, mime, bytes, created_at) VALUES (?,?,?,?,?,?)")
    .run('m@x.com', '', '/tmp/none2', 'image/png', 10, new Date().toISOString());
  const odd = (await (await fetch(B + '/api/site-media', { headers: H })).json()).usage;
  /* Compared against the count JUST BEFORE, not against a number written down
     earlier in the run — an earlier delete had already moved it, and the check
     was measuring my own bookkeeping rather than the server's. */
  check('a row whose kind is missing is read from its mime, not called a video',
    odd.videoCount === before.videoCount, before.videoCount + ' → ' + odd.videoCount);

  /* The panel must OFFER the delete, not merely have a route for one — that
     gap is the whole bug, and a server-side test cannot see it. */
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8');
  check('the Uploads panel offers a delete on every file',
    /class="cv-updel"[^>]*onclick="cvDeleteMedia\(/.test(appJs) && /async function cvDeleteMedia\(/.test(appJs));
  check('and it calls the route that already existed',
    /fetch\('\/api\/site-media\/' \+ Number\(id\), \{ method: 'DELETE'/.test(appJs));
  check('the meter no longer counts down to a cap',
    !/videoMaxCount/.test(appJs), 'app.html still references videoMaxCount');

  server.close();
  if (fails) { console.error('\nFAILED (' + fails + ' failure' + (fails === 1 ? '' : 's') + ')'); process.exit(1); }
  console.log('\nALL PASS (0 failures)');
  process.exit(0);
});
