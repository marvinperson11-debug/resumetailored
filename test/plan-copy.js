/**
 * Pricing / plan-limit copy guard. The numbers live in ONE place — resumetailored-platform/lib/plan-config.ts —
 * and every public page that prints a price or a Resume Video allowance must agree with it. This test reads the
 * constants file and checks the static site against it, so changing a limit there without updating the copy (or
 * the other way round) fails here.
 *
 *   node test/plan-copy.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let failures = 0;
const check = (name, ok, detail) => { if (ok) console.log('PASS ', name); else { failures++; console.error('FAIL ', name, detail ? '— ' + detail : ''); } };

// ── The constants ──
const cfgPath = 'resumetailored-platform/lib/plan-config.ts';
if (!fs.existsSync(path.join(ROOT, cfgPath))) { console.error('FAIL  missing ' + cfgPath + ' — merge the platform limits PR first'); process.exit(1); }
const cfg = read(cfgPath);
const num = (re) => { const m = re.exec(cfg); if (!m) throw new Error('cannot read ' + re); return Number(m[1]); };
const PRO_PRICE = num(/PRICES_USD = \{[^}]*pro:\s*(\d+)/);
const LT_PRICE = num(/PRICES_USD = \{[^}]*proLifetime:\s*(\d+)/);
const PRO_VIDEOS = num(/RESUME_VIDEO_MONTHLY_LIMITS = \{[\s\S]*?pro:\s*(\d+)/);
const LT_VIDEOS = num(/RESUME_VIDEO_MONTHLY_LIMITS = \{[\s\S]*?proLifetime:\s*(\d+)/);
const VARIANTS = num(/LIFETIME_VARIANT_MONTHLY_CAP\s*=\s*(\d+)/);
check('constants read: Pro $19 / 10 videos, Lifetime $129 / 40 videos', PRO_PRICE === 19 && LT_PRICE === 129 && PRO_VIDEOS === 10 && LT_VIDEOS === 40, [PRO_PRICE, LT_PRICE, PRO_VIDEOS, LT_VIDEOS].join(','));

// ── Every public page ──
const pages = [];
(function walk(d) {
  for (const f of fs.readdirSync(path.join(ROOT, d))) {
    const p = d + '/' + f;
    if (fs.statSync(path.join(ROOT, p)).isDirectory()) walk(p);
    else if (/\.(html|js|txt|md)$/.test(f)) pages.push(p);
  }
})('public');
const text = Object.fromEntries(pages.map((p) => [p, read(p)]));
const where = (re) => pages.filter((p) => re.test(text[p]));

// 1. One currency. Checkout is charged in USD, so no page may show a ¥/￥ price.
const yen = where(/[¥￥]\s?\d/);
check('no ¥ price anywhere (Chinese pages show the USD amount that is actually charged)', yen.length === 0, yen.slice(0, 5).join(', '));

// 2. Our price is $19 / month and $129 lifetime — never another amount.
check('no $19.99 anywhere', where(/\$\s?19\.99/).length === 0);
const wrongPro = [];
for (const p of pages) for (const m of text[p].matchAll(/(?:ResumeTailored|\bPro\b|专业版)[^<>$\n]{0,24}\$\s?(\d+(?:\.\d{2})?)\s?(?:\/\s?(?:mo|month)|\/月| per month| a month)/g)) {
  const v = Number(m[1]);
  const around = text[p].slice(Math.max(0, m.index - 500), m.index + m[0].length + 200);
  if (/Jobscan|Teal|Rezi|Kickresume|Enhancv|Zety|Resume\.io|Resume Worded|Canva|Novoresume|LinkedIn Premium|ChatGPT/i.test(around)) continue; // a competitor's price named beside ours
  if (v !== PRO_PRICE && ![49, 99, 299].includes(v)) wrongPro.push(p + ':' + m[0]); // 49/99/299 are the Employer tiers
}
check('every "Pro … $N/month" on the site says $' + PRO_PRICE, wrongPro.length === 0, wrongPro.slice(0, 4).join(' | '));
const lifetimeAmounts = [];
for (const p of pages) for (const m of text[p].matchAll(/(?:Lifetime|lifetime|终身(?:版|访问)?)[\s:·—\-(（]{0,4}\$\s?(\d+)/g)) if (Number(m[1]) !== LT_PRICE && Number(m[1]) !== 149) lifetimeAmounts.push(p + ':' + m[0]);
check('every "Lifetime … $N" says $' + LT_PRICE + ' (the only other figure is Rezi\'s $149)', lifetimeAmounts.length === 0, lifetimeAmounts.slice(0, 4).join(' | '));
check('Stripe checkout amount is still $19.00 (unchanged by the copy work)', (read('server.js').match(/unit_amount: 1900/g) || []).length >= 2);
check('the Rezi-lifetime saving is stated as $20 (149 − 129) on both homepages', /Saves \$20\+ vs\. Rezi Lifetime/.test(text['public/index.html']) && /Saves \$20\+ vs\. Rezi Lifetime/.test(text['public/zh/index.html']) && !where(/Saves \$99\+/).length);

// 3. Plan cards state the allowance plainly.
const idx = text['public/index.html'], zh = text['public/zh/index.html'], pricing = text['public/pricing.html'];
check('homepage (EN): Pro card says 10 videos/month, Lifetime card says 40 videos/month', idx.includes(`🎬 Resume video generator — ${PRO_VIDEOS} videos/month`) && idx.includes(`🎬 Resume video generator — ${LT_VIDEOS} videos/month`));
check('homepage (ZH dictionary): the same two lines, in Chinese', idx.includes(`简历视频生成器——每月 ${PRO_VIDEOS} 个视频`) && idx.includes(`简历视频生成器——每月 ${LT_VIDEOS} 个视频`));
check('/zh/ homepage: Pro and Lifetime cards list the allowance', zh.includes(`🎬 简历视频生成器——每月 ${PRO_VIDEOS} 个视频`) && zh.includes(`🎬 简历视频生成器——每月 ${LT_VIDEOS} 个视频`));
check('pricing page: Pro 10 videos / month, Lifetime 40 videos / month', pricing.includes(`<strong>${PRO_VIDEOS} videos / month</strong>`) && pricing.includes(`<strong>${LT_VIDEOS} videos / month</strong>`));
check('the legacy site has no Spanish / French / German homepage copy to update (EN + ZH only)', !fs.existsSync(path.join(ROOT, 'public/es')) && !fs.existsSync(path.join(ROOT, 'public/fr')) && !fs.existsSync(path.join(ROOT, 'public/de')) && !/hreflang="(es|fr|de)/.test(idx));

// 4. FAQ, ToS, llms.txt, landing + blog
const faq = text['public/faq.html'];
check('FAQ "What does Pro add?" states the video allowance (visible text and JSON-LD)', (faq.match(new RegExp(`the Resume Video studio \\(${PRO_VIDEOS} videos a month on Pro, ${LT_VIDEOS} on Lifetime\\)`, 'g')) || []).length === 2);
check('FAQ "What does Pro Lifetime include?" states both differences (visible + JSON-LD)', (faq.match(new RegExp(`Lifetime includes ${LT_VIDEOS} Resume Videos per calendar month \\(monthly Pro includes ${PRO_VIDEOS}\\)`, 'g')) || []).length === 2 && new RegExp(`capped at ${VARIANTS} tailoring-variant sets`).test(faq));
const terms = text['public/terms.html'];
check('ToS: no "unlimited access" for Pro; it states the monthly allowances, the reset and the $ amounts', !/unlimited access/i.test(terms) && terms.includes(`up to ${PRO_VIDEOS} Resume Videos per calendar month`) && terms.includes(`up to ${LT_VIDEOS} Resume Videos`) && terms.includes(`$${PRO_PRICE}.00/month`) && terms.includes(`$${LT_PRICE} for indefinite`) && /reset on the 1st/.test(terms) && /Last updated: October 9, 2026/.test(terms));
check('ToS: the only remaining "unlimited" is the Free tier\'s tailoring/cover letters/ATS/LinkedIn (which is true)', (terms.match(/unlimited/gi) || []).length === 1 && /Free tier:<\/strong> Unlimited AI resume tailoring/.test(terms));
check('llms.txt: Pro and Lifetime lines state the allowance', text['public/llms.txt'].includes(`resume video (${PRO_VIDEOS} videos a month)`) && text['public/llms.txt'].includes(`${LT_VIDEOS} resume videos a month`));
check('landing + studio pages state the allowance', text['public/resume-video-landing.html'].includes(`Pro Monthly (${PRO_VIDEOS} videos a month) and Lifetime Pro (${LT_VIDEOS} videos a month)`) && text['public/tools/resume-video.html'].includes(`${PRO_VIDEOS} videos a month on Pro, ${LT_VIDEOS} on Lifetime`));
check('blog posts that describe the video maker state the allowance (html and md)', ['blog/unlimited-free-resume-tailoring-2026.html', 'blog/unlimited-free-resume-tailoring-2026.md', 'blog/resume-website-builder.html', 'blog/resume-website-builder.md'].every((f) => new RegExp(`${PRO_VIDEOS}( videos)? a month`).test(text['public/' + f])));

// 5. The shared "Pro unlocks … the resume video" sentence on the role / example pages (and their JSON-LD).
const bare = where(/the resume video(?! \()[,\s]+(?:a|your) personal website/);
check('no page lists "the resume video" as a Pro perk without its allowance', bare.length === 0, bare.slice(0, 4).join(', '));
const role = pages.filter((p) => /-(resume|cover-letter)\.html$/.test(p) && /unlocks all 104 templates, the resume video/.test(text[p]));
check(`all ${role.length} role pages carry the allowance, in the visible text and the JSON-LD`, role.length > 200 && role.every((p) => (text[p].match(new RegExp(`the resume video \\(${PRO_VIDEOS} videos a month, ${LT_VIDEOS} with Lifetime\\)`, 'g')) || []).length === 2));

// 6. Nothing still calls Pro "unlimited" as an offer name, or says unlimited with the video.
check('no offer is named "Pro — Unlimited"', where(/"name":\s*"Pro — Unlimited"/).length === 0);
const unlimitedVideo = where(/unlimited[^<>\n]{0,40}(resume )?video|(resume )?video[^<>\n]{0,40}unlimited|不限次数[^<>\n]{0,40}简历视频/i).filter((p) => !/\/(blog|alternatives)\//.test(p) || /resumetailored/i.test(p));
check('no page promises unlimited videos', unlimitedVideo.length === 0, unlimitedVideo.slice(0, 4).join(', '));

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);
