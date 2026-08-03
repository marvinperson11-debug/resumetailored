/* badge-page.js — pure HTML renderer for the public /badge/:slug page.
 *
 * Mirrors the llms-txt.js pattern: a pure function ({badge}, origin) -> HTML
 * string, no DB access, independently testable. The page is OG-tagged for rich
 * LinkedIn/Twitter unfurls and carries the ResumeTailored brand footer, so a
 * shared badge is a branded growth loop. */
'use strict';

const BAND_META = {
  gold:   { label: 'Gold',   emoji: '🥇', color: '#B4832A', bg: '#FBF3E0' },
  silver: { label: 'Silver', emoji: '🥈', color: '#6B7280', bg: '#F1F2F4' },
  bronze: { label: 'Bronze', emoji: '🥉', color: '#8A5A2B', bg: '#F6ECE2' }
};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// badge: { name, professionLabel, topic, band, score, created_at }
function renderBadgePage(badge, origin) {
  const b = badge || {};
  const meta = BAND_META[b.band] || BAND_META.bronze;
  const name = b.name && String(b.name).trim() ? String(b.name).trim() : 'A ResumeTailored user';
  const prof = b.professionLabel || 'Professional';
  const topic = b.topic && String(b.topic).trim() ? String(b.topic).trim() : '';
  const title = `${name} — ${meta.label} in ${prof}${topic ? ' · ' + topic : ''}`;
  const desc = `${esc(name)} earned a ${meta.label} skills badge (${b.score || 0}%) in ${esc(prof)}${topic ? ' — ' + esc(topic) : ''} on ResumeTailored.`;
  const url = `${origin || ''}/badge/${esc(b.slug || '')}`;
  const date = b.created_at ? new Date(b.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)} · ResumeTailored</title>
<meta name="description" content="${desc}" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${desc}" />
<meta property="og:url" content="${url}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${desc}" />
<link rel="icon" href="/favicon.ico" />
<style>
  :root { --cream:#FAF7F0; --forest:#1F5C3D; --ink:#191512; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    background:var(--cream); color:var(--ink); display:flex; min-height:100vh; align-items:center; justify-content:center; padding:24px; }
  .card { background:#fff; border-radius:24px; box-shadow:0 10px 40px rgba(25,21,18,.10); max-width:460px; width:100%; overflow:hidden; text-align:center; }
  .ribbon { background:${meta.bg}; padding:40px 28px 28px; }
  .medal { font-size:72px; line-height:1; }
  .band { display:inline-block; margin-top:12px; font-weight:800; letter-spacing:.5px; text-transform:uppercase;
    color:${meta.color}; border:2px solid ${meta.color}; border-radius:999px; padding:5px 16px; font-size:13px; }
  .body { padding:28px; }
  .name { font-size:24px; font-weight:800; margin:0 0 4px; }
  .prof { font-size:16px; color:var(--forest); font-weight:700; margin:0 0 2px; }
  .topic { font-size:14px; color:#6B7280; margin:0 0 18px; }
  .score { font-size:44px; font-weight:900; color:${meta.color}; margin:0; }
  .scorelbl { font-size:12px; text-transform:uppercase; letter-spacing:1px; color:#9CA3AF; margin:0 0 18px; }
  .date { font-size:13px; color:#9CA3AF; }
  .cta { display:block; margin:22px 24px 8px; background:var(--forest); color:#fff; text-decoration:none;
    font-weight:800; padding:14px; border-radius:12px; }
  .foot { padding:16px; font-size:12px; color:#9CA3AF; }
  .foot a { color:var(--forest); text-decoration:none; font-weight:700; }
  @media (prefers-reduced-motion: no-preference) { .medal { animation: pop .5s ease; } }
  @keyframes pop { 0%{transform:scale(.6);opacity:0} 100%{transform:scale(1);opacity:1} }
</style>
</head>
<body>
  <div class="card">
    <div class="ribbon">
      <div class="medal">${meta.emoji}</div>
      <div class="band">${meta.label} Badge</div>
    </div>
    <div class="body">
      <p class="name">${esc(name)}</p>
      <p class="prof">${esc(prof)}</p>
      ${topic ? `<p class="topic">${esc(topic)}</p>` : '<p class="topic">Skills Assessment</p>'}
      <p class="score">${b.score || 0}%</p>
      <p class="scorelbl">Assessment Score</p>
      ${date ? `<p class="date">Earned ${esc(date)}</p>` : ''}
    </div>
    <a class="cta" href="/app">Test your own skills free →</a>
    <div class="foot">Verified by <a href="/">ResumeTailored</a> · AI-powered career tools</div>
  </div>
</body>
</html>`;
}

module.exports = { renderBadgePage, BAND_META };
