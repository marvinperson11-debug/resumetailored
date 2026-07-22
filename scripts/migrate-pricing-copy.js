#!/usr/bin/env node
/**
 * One-off, idempotent content migration for the 2026 pricing/feature change.
 *
 * What changed (see PLAN.md):
 *   - Free tier is now UNLIMITED resumes + cover letters (was 1/day).
 *   - Pro price is $19.99/mo (was $19/mo).
 *   - Pro now sells 100+ premium templates, the resume video, personal websites
 *     and watermark-free exports (NOT "unlimited tailoring", which is free now).
 *
 * This script rewrites the shared marketing boilerplate across public/**.html.
 * It is safe to re-run: every replacement targets an OLD string, so a second
 * pass is a no-op.
 *
 * It deliberately does NOT touch:
 *   - CNY (¥) prices — the canonical CNY price is a business decision; flagged.
 *   - Template COUNTS ("100+ templates", "56 resume + 48 cover") — still true.
 *
 * Usage:  node scripts/migrate-pricing-copy.js [--dry]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DRY = process.argv.includes('--dry');
const ROOT = path.join(__dirname, '..', 'public');

// Ordered literal replacements. Applied top-to-bottom BEFORE the $19 regex, so
// the multi-word sentences (which contain "$19/mo") match their original form.
const LITERAL = [
  // The big FAQ/hero free-tier sentence (JSON-LD + visible), 226 pages.
  [
    'One full tailoring (resume + cover letter) per day is free, forever, with no credit card. Pro ($19/mo) unlocks unlimited tailoring and all 100+ templates.',
    'Unlimited resume tailoring and cover letters are free, forever, with no credit card. Pro ($19.99/mo) unlocks 100+ premium templates, the resume video, a personal website, and watermark-free exports.',
  ],
  // Hero notes.
  ['1 free tailoring per day · No credit card required', 'Unlimited free tailoring · No credit card required'],
  ['1 free cover letter per day · No credit card required', 'Unlimited free cover letters · No credit card required'],
  ['1 free tailoring/day &bull; No credit card &bull; Upgrade to Pro for $19/mo', 'Unlimited free tailoring &bull; No credit card &bull; Pro from $19.99/mo'],
  ['Free tier: 1 full tailoring/day &bull; No credit card &bull; No account needed to start', 'Free tier: unlimited tailoring &bull; No credit card &bull; Sign up free to start'],
  // ── Sentence-level free-tier claims (specific first) ──────────────────────
  ['You get 1 free resume tailoring + 1 free cover letter per day', 'You get unlimited free resume tailoring and cover letters'],
  ['Yes — the free tier gives you 1 AI resume tailoring per day', 'Yes — the free tier gives you unlimited AI resume tailoring'],
  ['The free tier gives you one complete AI resume rewrite per day', 'The free tier gives you unlimited AI resume rewrites'],
  ['The free tier gives you one full AI resume tailoring per day', 'The free tier gives you unlimited AI resume tailoring'],
  ['The free tier gives you one full resume tailoring per day', 'The free tier gives you unlimited resume tailoring'],
  ['The free tier gives you one tailored cover letter per day', 'The free tier gives you unlimited tailored cover letters'],
  ['The free tier gives you one complete rewrite per day', 'The free tier gives you unlimited rewrites'],
  ['The free tier gives you one full tailoring per day', 'The free tier gives you unlimited tailoring'],
  ['The free tier gives you one tailoring per day', 'The free tier gives you unlimited tailoring'],
  ['The free tier includes 1 cover letter generation per day', 'The free tier includes unlimited cover letter generation'],
  ['the free tier gives you 1 AI resume tailoring per day', 'the free tier gives you unlimited AI resume tailoring'],
  ['You get one free ATS check and full resume rewrite per day', 'You get unlimited free ATS checks and resume rewrites'],
  ['On the free tier, you get one full tailoring and score per day', 'On the free tier, you get unlimited tailoring and scoring'],
  ['On the free tier you can do one per day', 'The free tier is unlimited'],
  ['You also get a free tier with one tailoring per day', 'You also get a free tier with unlimited tailoring'],
  ['ResumeTailored AI offers one free resume tailoring per day', 'ResumeTailored AI offers unlimited free resume tailoring'],
  ['a free tier with one full resume tailoring per day', 'a free tier with unlimited resume tailoring'],
  ['a free tier with 1 full rewrite per day', 'a free tier with unlimited rewrites'],
  // ── Fragment-level (longest first) ────────────────────────────────────────
  ['one free ATS check and full resume rewrite per day', 'unlimited free ATS checks and resume rewrites'],
  ['one free full check every single day', 'unlimited free checks'],
  ['One free tailoring every day, forever', 'Unlimited free tailoring, forever'],
  ['one free tailoring every day', 'unlimited free tailoring'],
  ['1 free resume tailoring per day', 'unlimited free resume tailoring'],
  ['one free resume tailoring per day', 'unlimited free resume tailoring'],
  ['one free tailoring per day', 'unlimited free tailoring'],
  ['one full resume tailoring per day', 'unlimited resume tailoring'],
  ['One full tailoring free per day', 'Unlimited tailoring, free'],
  ['one full tailoring per day', 'unlimited tailoring'],
  ['One full tailoring per day', 'Unlimited tailoring'],
  ['One tailoring per day', 'Unlimited tailoring'],
  ['1 full AI rewrite + cover letter per day', 'unlimited AI rewrites + cover letters'],
  ['1 full AI resume rewrite per day', 'unlimited AI resume rewrites'],
  ['Free tier: 1 full AI resume rewrite per day', 'Free tier: unlimited AI resume rewrites'],
  ['Free tier: 1 full tailoring per day', 'Free tier: unlimited tailoring'],
  ['1 free full tailoring per day', 'Unlimited free tailoring'],
  ['1 free full rewrite per day', 'Unlimited free rewrites'],
  ['1 free cover letter per day on the free plan', 'unlimited free cover letters on the free plan'],
  ['1 free AI tailoring per day', 'unlimited free AI tailoring'],
  ['1 AI resume tailoring per day', 'unlimited AI resume tailoring'],
  ['1 AI tailoring per day', 'unlimited AI tailoring'],
  ['1 ATS scan per day', 'unlimited ATS scans'],
  ['1 cover letter per day', 'unlimited cover letters'],
  ['1 full tailoring per day', 'unlimited tailoring'],
  ['1 free tailoring per day', 'Unlimited free tailoring'],
  ['1 tailoring per day', 'unlimited tailoring'],
  ['1 free tailoring/day', 'Unlimited free tailoring'],
  ['1 free tailoring · No payment required', 'Unlimited free tailoring · No payment required'],
  ['1 free check every day', 'Unlimited free checks'],
  ['1 free check/day', 'Unlimited free checks'],
  ['1 free per day, no credit card needed', 'free and unlimited, no credit card needed'],
  ['1 free per day', 'free and unlimited'],
  ['1 per day, always', 'Unlimited, always'],
  ['Free daily tailoring', 'Unlimited free tailoring'],
  ['free on the daily free tier', 'free on the free tier'],
  // Structured-data (JSON-LD) Offer price — has no "$", so the regex skips it.
  ['"price":"19"', '"price":"19.99"'],
  ['"price": "19"', '"price": "19.99"'],
  // Offer names / hero notes still saying "1 tailoring/day".
  ['Free — 1 tailoring/day', 'Free — Unlimited tailoring'],
  ['1 full AI tailoring/day', 'unlimited AI tailoring'],
  ['1 full tailoring/day', 'unlimited tailoring'],
  ['1 tailoring/day', 'unlimited tailoring'],
  ['1 free ATS scan', 'unlimited free ATS scans'],
  // ── Final free-tier sentence stragglers ───────────────────────────────────
  ['The free tier gives you one complete resume rewrite and cover letter per day', 'The free tier gives you unlimited resume rewrites and cover letters'],
  ['ResumeTailored gives one full tailoring (resume + cover letter) per day', 'ResumeTailored gives unlimited tailoring (resume + cover letter)'],
  ['the free tier gives you one complete, AI-powered resume rewrite per day', 'the free tier gives you unlimited AI-powered resume rewrites'],
  ['you can generate your own job-specific cover letter once per day', 'you can generate your own job-specific cover letters, unlimited and free'],
  ['you can tailor your own resume to any job posting once per day', 'you can tailor your own resume to any job posting, unlimited and free'],
  // ── Chinese (zh) free-tier claims: "1/day" → "unlimited". CNY PRICES are
  //    left untouched on purpose (canonical ¥ price is a business decision, and
  //    several ¥ figures are competitor prices in comparison tables). ──────────
  ['每日1次免费AI定制', '无限次免费AI定制'],
  ['每天为你提供1次AI定制', '为你提供无限次AI定制'],
  ['每日1次免费定制', '无限次免费定制'],
  ['每日1次AI定制', '无限次AI定制'],
  ['每日1次定制', '无限次定制'],
  ['每天 1 次免费定制', '无限次免费定制'],
  ['每天 1 次免费', '无限次免费'],
  ['每天1次ATS扫描', '无限次ATS扫描'],
  ['每天可免费使用1次', '可免费无限次使用'],
];

// Final pass: $19 -> $19.99, but never $19.99 (already dotted) or $190+ (digit).
const DOLLAR = /\$19(?![\d.])/g;

function migrate(content) {
  let out = content;
  let hits = 0;
  for (const [from, to] of LITERAL) {
    if (out.includes(from)) {
      out = out.split(from).join(to);
      hits++;
    }
  }
  const before = out;
  out = out.replace(DOLLAR, '$19.99');
  if (out !== before) hits++;
  return { out, changed: out !== content, hits };
}

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.isFile() && p.endsWith('.html')) acc.push(p);
  }
  return acc;
}

const files = walk(ROOT);
let changedCount = 0;
const changedFiles = [];
for (const f of files) {
  const content = fs.readFileSync(f, 'utf8');
  const { out, changed } = migrate(content);
  if (changed) {
    changedCount++;
    changedFiles.push(path.relative(ROOT, f));
    if (!DRY) fs.writeFileSync(f, out);
  }
}

console.log(`${DRY ? '[DRY RUN] ' : ''}Scanned ${files.length} HTML files, ${changedCount} would change / changed.`);
if (process.argv.includes('--list')) changedFiles.forEach(f => console.log('  ' + f));

// Sanity: report any remaining bare $19 (should be zero after a real run).
if (!DRY) {
  let stragglers = 0;
  for (const f of files) if (DOLLAR.test(fs.readFileSync(f, 'utf8'))) stragglers++;
  console.log(stragglers ? `WARNING: ${stragglers} files still contain a bare $19` : 'OK: no bare $19 remain.');
}
