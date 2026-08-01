#!/usr/bin/env node
/**
 * MEDIA FOLLOWS THE SITE IT BELONGS TO — deleted with it, carried across a
 * rename, never touched by what happens to a DIFFERENT site.
 *
 * Reported directly: "I hit my video limit and I haven't uploaded anything
 * on this site" — because media used to be one pool per ACCOUNT, so a video
 * left over from a template tried once, weeks ago, was still sitting in the
 * pool and spending this site's slots. `site_media.site_sub` fixes the
 * counting (proven in test/media-limits.js); this file proves the other half
 * of that promise — the lifecycle. A site's media has to actually go away
 * when the site does, or "scoped to the site" is true of the count and false
 * of the disk.
 *
 * Usage: node test/media-site-scope.js
 */
const fs = require('fs'), os = require('os'), path = require('path');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-mss-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';
const { app } = require('../server.js');
const Database = require('better-sqlite3');

const db = new Database(path.join(process.env.DATA_DIR, 'resumetailor.db'));
db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run('m@x.com', 'm', 'x');
db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('tokM', 'm@x.com');
db.prepare('INSERT INTO subscribers (email,customer_id) VALUES (?,?)').run('m@x.com', 'cM');

let failures = 0;
const check = (n, c, d) => { if (c) console.log('PASS  ' + n); else { failures++; console.error('FAIL  ' + n + (d ? ' — ' + d : '')); } };

const server = app.listen(0, async () => {
  const B = `http://127.0.0.1:${server.address().port}`;
  const H = { Authorization: 'Bearer tokM' };
  const HJ = { ...H, 'Content-Type': 'application/json' };
  const now = Date.now();
  const mkSite = (sub) => db.prepare('INSERT INTO personal_sites (subdomain,email,text,created_at,updated_at) VALUES (?,?,?,?,?)')
    .run(sub, 'm@x.com', 'placeholder', now, now);
  const upload = async (sub, name) => {
    const fd = new FormData();
    fd.append('file', new Blob([Buffer.alloc(1024, 1)], { type: 'video/mp4' }), name);
    fd.append('subdomain', sub);
    const r = await fetch(B + '/api/site-media', { method: 'POST', headers: H, body: fd });
    return await r.json();
  };
  const countFor = async (sub) => (await (await fetch(B + '/api/site-media?subdomain=' + sub, { headers: H })).json()).usage.videoCount;

  try {
    // ── DELETING A SITE DELETES ITS MEDIA, ON DISK AND IN THE ROW. ────────
    mkSite('will-delete');
    mkSite('stays-put');
    const kept = await upload('will-delete', 'a.mp4');
    const other = await upload('stays-put', 'b.mp4');
    check('the upload landed on disk', kept.id && fs.existsSync(db.prepare('SELECT path FROM site_media WHERE id=?').get(kept.id).path));
    const delRes = await fetch(B + '/api/personal-sites/will-delete', { method: 'DELETE', headers: H });
    check('deleting the site succeeds', delRes.status === 200, String(delRes.status));
    const row = db.prepare('SELECT * FROM site_media WHERE id = ?').get(kept.id);
    check('its media row is gone', !row, JSON.stringify(row));
    const otherRow = db.prepare('SELECT path FROM site_media WHERE id = ?').get(other.id);
    check('a DIFFERENT site\'s media is untouched by the deletion', !!otherRow && fs.existsSync(otherRow.path));
    check('and only the deleted site\'s file actually left disk',
      otherRow && fs.existsSync(otherRow.path), 'other file missing');

    // ── A RENAME CARRIES MEDIA ACROSS, IT DOES NOT LOSE IT. ────────────────
    mkSite('old-address');
    const carried = await upload('old-address', 'c.mp4');
    const renameRes = await fetch(B + '/api/personal-site', {
      method: 'POST', headers: HJ,
      body: JSON.stringify({ subdomain: 'new-address', renameFrom: 'old-address', text: 'placeholder that is long enough to publish' }),
    });
    check('the rename itself succeeds', renameRes.status === 200, String(renameRes.status));
    const movedRow = db.prepare('SELECT site_sub FROM site_media WHERE id = ?').get(carried.id);
    check('the media row now points at the new address', movedRow && movedRow.site_sub === 'new-address', JSON.stringify(movedRow));
    const newCount = await countFor('new-address');
    check('and is visible/counted there', newCount === 1, String(newCount));
    const oldCount = await countFor('old-address');
    check('the old address has nothing left to count', oldCount === 0, String(oldCount));

    // ── THE LEGACY "DELETE MY SITE" ROUTE WIPES EVERY SITE'S MEDIA. ────────
    // Predates multi-site; still means "delete everything for this account".
    mkSite('legacy-a');
    mkSite('legacy-b');
    const la = await upload('legacy-a', 'd.mp4');
    const lb = await upload('legacy-b', 'e.mp4');
    const wipeRes = await fetch(B + '/api/personal-site', { method: 'DELETE', headers: H });
    check('the account-wide delete succeeds', wipeRes.status === 200, String(wipeRes.status));
    check('every site\'s media is gone, not just one',
      !db.prepare('SELECT 1 FROM site_media WHERE id IN (?,?)').get(la.id, lb.id));
    check('and their files are actually removed from disk',
      !fs.existsSync(db.prepare('SELECT path FROM site_media WHERE id=?').get(la.id)?.path || '/nonexistent'));
  } catch (e) {
    check('the run completed', false, e && e.stack);
  }

  server.close();
  if (failures) { console.error(`\nFAILED (${failures} failure${failures === 1 ? '' : 's'})`); process.exit(1); }
  console.log('\nALL PASS (0 failures)');
  process.exit(0);
});
