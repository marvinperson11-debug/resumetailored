#!/usr/bin/env node
/**
 * Generates the /alternatives/* conversion pages from one data table, so the
 * visible comparison table, the FAQ and the FAQPage/WebPage JSON-LD can never
 * drift apart. Run: node scripts/build-alternatives.js
 *
 * Page chrome (CSS) lives in scripts/templates/alternatives-base.css (extracted from
 * the original kickresume page before it was regenerated). Competitor facts below were taken from the competitors'
 * own published pricing pages on VERIFIED_ON; anything we could not confirm is
 * marked "Check official site" rather than guessed. Re-verify before changing.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ORIGIN = 'https://resumetailored.com';
const VERIFIED_ON = '2026-10-07';
const VERIFIED_LABEL = 'October 7, 2026';
const PUB = path.join(__dirname, '..', 'public');
const CHECK = 'Check official site';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ── Shared facts about ResumeTailored AI (from public/pricing.html + CLAUDE.md) ──
const US_C = {
  free: 'Free account: unlimited resume tailoring, cover letters and ATS scans. 6 templates; exports carry a small watermark.',
  pro: 'Pro $19.00/month: 3 tailoring variants, ATS rewrite report, all 104 templates, watermark-free exports.',
  lifetime: '$129 one-time (includes 30 tailoring-variant sets per month; monthly Pro has no cap).',
  urlImport: 'Yes: paste a job URL from LinkedIn, Indeed, Glassdoor or 40+ other job boards.',
  ai: 'Anthropic Claude.',
  interview: 'All 15 practice questions free with basic feedback; detailed feedback and full mock interviews are Pro.',
  tracker: 'Free job application tracker (up to 20 applications on the free plan).',
  bilingual: 'English and Chinese interface, plus translation of non-English resumes.',
};

const PAGES = [
  // ───────────────────────── Candidate side ─────────────────────────
  {
    slug: 'rezi', audience: 'candidate', name: 'Rezi',
    officialUrl: 'https://www.rezi.ai/pricing', officialLabel: "Rezi's pricing page",
    title: 'Best Rezi Alternative in 2026: Free AI Tailoring, $19/mo',
    meta: "Rezi vs ResumeTailored AI, checked against Rezi's own pricing page on Oct 7, 2026: free plans, monthly and lifetime price, cover letters and job-URL import.",
    h1: 'Best Rezi Alternative in 2026',
    sub: "Rezi is a capable resume builder. If you want unlimited free tailoring to each job posting, a lower monthly price, or job-URL import, here is an honest side-by-side, checked against Rezi's own pricing page.",
    keywords: 'rezi alternative, alternative to rezi, rezi vs resumetailored, rezi free plan, rezi pricing, ai resume tailoring',
    blog: [{ href: '/blog/rezi-vs-resumetailored', label: 'Rezi vs ResumeTailored AI: the long-form comparison' }],
    related: ['teal', 'jobscan'],
    callout: [['Rezi Pro', '$29/mo'], ['ResumeTailored Pro', '$19.00/mo'], ['Lifetime', '$129 (Rezi: $149)']],
    table: [
      ['Free plan', "Free: 1 resume, 1 AI interview, 3 PDF downloads, limited AI keyword targeting. Unlimited cover letters (per Rezi's FAQ).", US_C.free],
      ['Monthly price', 'Pro: $29/month', 'Pro: $19.00/month'],
      ['Lifetime option', '$149 one-time (Pro features)', US_C.lifetime],
      ['Keyword targeting / tailoring to a job', 'AI keyword targeting: limited on Free, full on Pro', 'Tailors your resume and cover letter to a pasted job description or URL; unlimited on Free'],
      ['AI cover letters', 'Included, unlimited on Free (per Rezi)', 'Included, unlimited on Free'],
      ['Interview practice', '1 AI interview on Free; unlimited on Pro', US_C.interview],
      ['Job-URL import', CHECK, US_C.urlImport],
      ['AI model', CHECK, US_C.ai],
      ['Refund policy', '30-day money-back guarantee on Pro and Lifetime (per Rezi)', 'Monthly plans cancel any time; Lifetime is a one-time purchase'],
      ['Language support', CHECK, US_C.bilingual],
    ],
    theirStrengths: [
      "Unlimited cover letters on the free plan, and a published 30-day money-back guarantee on paid plans.",
      "A $149 lifetime plan with Pro features and no stated monthly cap, compared with our $129 lifetime plan that includes 30 tailoring-variant sets a month.",
      "Free and Pro include AI interview practice; Pro includes a monthly expert resume review (per Rezi's FAQ).",
    ],
    ourStrengths: [
      'No cap on free resume tailoring: with a free account you can tailor a resume and cover letter to every job you apply to.',
      'Paste a job URL from LinkedIn, Indeed, Glassdoor or 40+ other boards and the description is pulled in for you.',
      '$19.00/month for Pro versus $29/month for Rezi Pro, and $129 versus $149 for lifetime.',
      'English and Chinese interface and translation for non-English resumes.',
    ],
    bestFor: {
      them: 'You want one resume builder with an expert-review option and a long-standing money-back guarantee, and you are comfortable with the free plan’s single resume.',
      us: 'You apply to many roles and want every resume and cover letter tailored to the posting, without a cap on the free plan.',
    },
    faq: [
      ['Is ResumeTailored AI a good Rezi alternative?', "It is if tailoring a resume and cover letter to each job is your main need. Free accounts get unlimited tailoring, cover letters and ATS scans, and Pro is $19.00/month versus $29/month for Rezi Pro. Rezi has strengths too: unlimited free cover letters, AI interview practice and a 30-day money-back guarantee."],
      ['How do Rezi and ResumeTailored AI pricing compare?', "Per Rezi's pricing page (checked " + VERIFIED_LABEL + "): Free $0, Pro $29/month, Lifetime $149 one-time. ResumeTailored AI: Free $0, Pro $19.00/month, Lifetime $129 one-time (which includes 30 tailoring-variant sets per month). Prices change, so confirm on each site before you buy."],
      ["Does Rezi's free plan include cover letters?", "Yes. Rezi's pricing page FAQ describes unlimited cover letters on the free plan. ResumeTailored AI also generates cover letters for free with an account."],
      ['Can ResumeTailored AI import a job posting from a URL?', 'Yes. Paste a job link from LinkedIn, Indeed, Glassdoor or 40+ other job boards and the job description is extracted automatically. We could not confirm this feature for Rezi, so check Rezi’s site.'],
      ['What AI does ResumeTailored AI use?', 'It is powered by Anthropic’s Claude. We have not verified which model Rezi uses, so we do not compare output quality here; the best test is to run the same job posting through both free plans.'],
    ],
  },
  {
    slug: 'jobscan', audience: 'candidate', name: 'Jobscan',
    officialUrl: 'https://www.jobscan.co/', officialLabel: "Jobscan's plans page",
    title: 'Best Jobscan Alternative 2026: Tailors Your Resume, Free',
    meta: 'Jobscan vs ResumeTailored AI: Jobscan scores a resume against a job; ResumeTailored AI also rewrites it. Prices and free limits checked Oct 7, 2026.',
    h1: 'Best Jobscan Alternative in 2026',
    sub: 'Jobscan is a well-known resume scanner. If you want the tailoring done for you instead of only a match report, and a free plan without a scan limit, here is how the two compare.',
    keywords: 'jobscan alternative, alternative to jobscan, jobscan vs resumetailored, free jobscan alternative, ats resume scanner',
    blog: [{ href: '/blog/jobscan-vs-resumetailored', label: 'Jobscan vs ResumeTailored AI: the long-form comparison' }],
    related: ['rezi', 'teal'],
    callout: [['Jobscan Premium', '$49.95/mo'], ['ResumeTailored Pro', '$19.00/mo'], ['Free plan', 'Unlimited tailoring']],
    table: [
      ['Free plan', 'Free: 5 resume scans per month', US_C.free],
      ['Paid price', 'Premium: $49.95/month, or $89.95 per quarter (about $29.98/month)', 'Pro: $19.00/month; Lifetime $129 one-time'],
      ['Trial', '7-day free trial of Premium (per Jobscan)', 'No trial needed: the free plan is unlimited for tailoring'],
      ['Match report against a job description', 'Yes: the core product (full report on Premium)', 'Yes: free ATS scanner; Pro adds an ATS rewrite report with keyword delta and before/after score'],
      ['Rewrites your resume for the job', 'AI optimizations on Premium (per Jobscan, desktop only)', 'Core feature, unlimited on Free'],
      ['Cover letters', 'AI cover letter generator on Premium (per Jobscan)', 'Unlimited on Free'],
      ['LinkedIn optimization', 'On Premium (per Jobscan)', 'Free LinkedIn optimizer score and suggestions; Pro adds an AI rewrite'],
      ['Job-URL import', CHECK, US_C.urlImport],
      ['Job tracker', 'Included on the free plan (per Jobscan)', US_C.tracker],
    ],
    theirStrengths: [
      'A dedicated, long-established resume scanner with a detailed match report and recruiter/ATS findings.',
      'LinkedIn optimization and cover letter tools on Premium, plus a 7-day trial.',
      'If a score against a specific job description is all you need, the free 5 scans a month may already be enough.',
    ],
    ourStrengths: [
      'Tailoring is unlimited on the free plan, and the scan and the rewrite happen in the same flow.',
      '$19.00/month for Pro versus $49.95/month (or about $29.98/month on the quarterly plan) for Jobscan Premium.',
      'Paste a job URL from LinkedIn, Indeed, Glassdoor or 40+ boards instead of copying the description.',
    ],
    bestFor: {
      them: 'You mainly want to measure how well an existing resume matches a posting and are happy to make the edits yourself.',
      us: 'You want the resume and cover letter rewritten for each posting and checked in one step, without a monthly scan limit.',
    },
    faq: [
      ['Is ResumeTailored AI a good Jobscan alternative?', 'If you want tailoring done for you, yes. Jobscan is built around scanning a resume against a job description. ResumeTailored AI includes a free ATS scanner and also rewrites the resume and writes the cover letter, with no limit on the free plan.'],
      ['How much does Jobscan cost compared with ResumeTailored AI?', "Per Jobscan's plan page (checked " + VERIFIED_LABEL + "): Free includes 5 scans per month; Premium is $49.95/month or $89.95 per quarter. ResumeTailored AI Pro is $19.00/month, or $129 one-time for Lifetime. Plan pages can be out of date, so confirm on Jobscan's site."],
      ['Does Jobscan write cover letters?', "Jobscan's plan page lists an AI cover letter generator on Premium. ResumeTailored AI generates cover letters on the free plan."],
      ['Does ResumeTailored AI have an ATS scanner?', 'Yes. The ATS scanner is free with an account. Pro adds an ATS rewrite report that shows the keyword changes and a before/after match score.'],
      ['Which is better for ATS keyword matching?', 'Jobscan is a specialist and its match report is detailed. ResumeTailored AI folds keyword matching into the rewrite. Run the same resume and posting through both free plans and compare.'],
    ],
  },
  {
    slug: 'teal', audience: 'candidate', name: 'Teal',
    officialUrl: 'https://www.tealhq.com/pricing', officialLabel: "Teal's pricing page",
    title: 'Best Teal Alternative in 2026: Unlimited Free AI Tailoring',
    meta: "Teal vs ResumeTailored AI: Teal+ costs $29 per 30 days and caps free AI credits. Compare free plans, price, cover letters and tracking, checked Oct 7, 2026.",
    h1: 'Best Teal Alternative in 2026',
    sub: 'Teal is strong at tracking your job search. If your priority is AI tailoring and cover letters for each application without running out of credits, here is how the two compare.',
    keywords: 'teal alternative, alternative to teal, teal vs resumetailored, teal hq alternative, free ai resume builder',
    blog: [{ href: '/blog/teal-vs-resumetailored', label: 'Teal vs ResumeTailored AI: the long-form comparison' }],
    related: ['rezi', 'jobscan'],
    callout: [['Teal+', '$29/30 days'], ['ResumeTailored Pro', '$19.00/mo'], ['Free AI tailoring', 'Unlimited']],
    table: [
      ['Free plan', 'Unlimited resumes and job tracking; 10 templates; PDF export; limited, non-renewable AI credits; top 5 job keywords', US_C.free],
      ['Paid price', 'Teal+: $29 per 30 days, $79 per 90 days, or $13 per 7 days', 'Pro: $19.00/month; Lifetime $129 one-time'],
      ['AI on the free plan', "Limited credits (Teal's help center lists a few each for bullets, summaries and cover letters)", 'Unlimited tailoring and cover letters with a free account'],
      ['AI cover letters', 'Limited credits on Free; unlimited on Teal+', 'Unlimited on Free'],
      ['Job tracking', 'Unlimited job tracking on Free: a core strength', US_C.tracker],
      ['Job-URL import', CHECK, US_C.urlImport],
      ['Interview practice', 'Unlimited on Teal+', US_C.interview],
      ['AI model', CHECK, US_C.ai],
      ['Language support', CHECK, US_C.bilingual],
    ],
    theirStrengths: [
      'Unlimited job tracking and unlimited resumes on the free plan, with 10 free templates.',
      "A broader job-search workspace: Teal's tracker is the center of the product.",
      'Weekly, 30-day and 90-day billing options, so you can pay for a short job search only.',
    ],
    ourStrengths: [
      'AI tailoring and cover letters are not credit-limited on the free plan.',
      '$19.00/month for Pro versus $29 per 30 days for Teal+, and a $129 lifetime option.',
      'Paste a job URL from LinkedIn, Indeed, Glassdoor or 40+ boards to start a tailored resume.',
    ],
    bestFor: {
      them: 'You want one place to organise a long job search, and the free tracker and resume builder cover most of what you need.',
      us: 'You want each application’s resume and cover letter tailored by AI without worrying about running out of free credits.',
    },
    faq: [
      ['Is ResumeTailored AI a good Teal alternative?', 'For AI tailoring and cover letters, yes: they are unlimited with a free account. Teal is the stronger choice if a feature-rich job tracker is your priority, though ResumeTailored AI includes a free tracker too (up to 20 applications on the free plan).'],
      ['How does Teal pricing compare with ResumeTailored AI?', "Per Teal's pricing page and help center (checked " + VERIFIED_LABEL + "): Teal+ is $13 every 7 days, $29 every 30 days or $79 every 90 days. ResumeTailored AI Pro is $19.00/month, with a $129 one-time Lifetime plan. Confirm current prices on Teal's site."],
      ['Does Teal include an AI cover letter generator?', "Yes. Teal's free plan gives a small number of AI credits for cover letters and Teal+ lists unlimited cover letters. ResumeTailored AI generates cover letters without a credit limit on the free plan."],
      ['Can I use Teal and ResumeTailored AI together?', 'Yes. Plenty of people track applications in one tool and tailor documents in another. Nothing locks you in: you can export your tailored resume as PDF, DOCX or text.'],
      ['Which AI model does each use?', 'ResumeTailored AI uses Anthropic’s Claude. We have not verified which model Teal uses, so we do not compare output quality here.'],
    ],
  },

  // ───────────── A.5: rebuilt from verified data (old pages had wrong prices and invented testimonials) ─────────────
  {
    slug: 'kickresume', audience: 'candidate', name: 'Kickresume',
    officialUrl: 'https://www.kickresume.com/en/pricing/', officialLabel: "Kickresume's pricing page",
    title: 'Best Kickresume Alternative in 2026: Free AI Tailoring',
    meta: "Kickresume vs ResumeTailored AI: Kickresume paid plans run $8 to $24 a month; ours tailors for free. Checked against Kickresume's pricing page on Oct 7, 2026.",
    h1: 'Best Kickresume Alternative in 2026',
    sub: 'Kickresume is a design-forward resume builder with an AI writer on its paid plans. If you want unlimited free tailoring to each posting instead, here is an honest comparison, checked against Kickresume’s own pricing page.',
    keywords: 'kickresume alternative, alternative to kickresume, kickresume vs resumetailored, kickresume pricing, free ai resume tailoring',
    blog: [{ href: '/blog/free-ats-resume-scanners-compared', label: 'Free ATS resume scanners compared' }],
    related: ['rezi', 'teal'],
    callout: [['Kickresume paid', '$8–$24/mo'], ['ResumeTailored Pro', '$19.00/mo'], ['Free tailoring', 'Unlimited']],
    table: [
      ['Free plan', '$0: 4 basic resume templates and 4 matching cover letter templates, unlimited downloads. AI writer, AI cover letter writer and ATS checker are not included.', US_C.free],
      ['Paid price', '$8/month billed $96 yearly; $18/month billed $54 quarterly; $24/month billed monthly', 'Pro: $19.00/month; Lifetime $129 one-time'],
      ['AI writing', 'AI Resume & Cover Letter Writer on paid plans', 'AI tailoring and cover letters, unlimited on Free'],
      ['ATS check', 'ATS Resume Checker on paid plans', 'Free ATS scanner; Pro adds an ATS rewrite report'],
      ['Templates', '4 resume + 4 cover letter templates free; 40+ of each on paid plans', '6 templates free (3 resume, 3 cover letter); all 104 on Pro'],
      ['Tailors a resume to a specific posting', CHECK, 'Core feature: paste a job description or URL'],
      ['Job-URL import', CHECK, US_C.urlImport],
      ['AI model', CHECK, US_C.ai],
    ],
    theirStrengths: [
      'A large template library on paid plans (40+ resume and 40+ cover letter templates) and design-forward styling.',
      'AI writer, AI cover letter writer and ATS checker bundled on every paid plan.',
      'A lower effective monthly price on the yearly plan ($8 a month billed $96) than our $19.00 monthly Pro.',
      'Unlimited downloads even on the free plan, with four basic templates.',
    ],
    ourStrengths: [
      'Unlimited tailoring and cover letters on the free plan, so the AI features are not behind a paywall.',
      'Paste a job URL from LinkedIn, Indeed, Glassdoor or 40+ boards to start a tailored resume.',
      'A one-time $129 lifetime option instead of recurring billing.',
    ],
    bestFor: {
      them: 'You want polished, design-led templates and an all-in-one builder, and you will pay for a yearly plan.',
      us: 'You apply to many roles and want each resume and cover letter tailored to the posting, with the AI available on the free plan.',
    },
    faq: [
      ['Is ResumeTailored AI a good Kickresume alternative?', 'If tailoring to each job is your main need, yes: it is unlimited on the free plan. Kickresume is stronger on template variety, and its yearly plan is cheaper per month than our Pro plan.'],
      ['How much does Kickresume cost?', "Per Kickresume's pricing page (checked " + VERIFIED_LABEL + "): $8/month billed $96 yearly, $18/month billed $54 quarterly, $24/month monthly, and a free plan with 4 basic templates. ResumeTailored AI Pro is $19.00/month or $129 one-time. Confirm current prices on Kickresume's site."],
      ['Does Kickresume have an ATS checker and AI writer?', "Yes. Kickresume's pricing page lists an AI Resume & Cover Letter Writer and an ATS Resume Checker on its paid plans, but not on the free plan."],
      ['Are two-column templates a problem for ATS?', 'It depends on the parser. Some read multi-column layouts out of order, so a single-column layout with standard headings is the safest choice for online applications. Test any resume by pasting its text into a plain-text editor, or by running it through an ATS scanner.'],
      ['What AI does ResumeTailored AI use?', 'Anthropic’s Claude. We have not verified which model Kickresume uses and do not compare output quality here; run the same posting through both to judge for yourself.'],
    ],
  },
  {
    slug: 'resume-io', audience: 'candidate', name: 'Resume.io', outFile: 'resume-io-alternative.html', canonicalPath: '/resume-io-alternative',
    officialUrl: 'https://resume.io/pricing', officialLabel: "Resume.io's pricing page",
    title: 'Best Resume.io Alternative in 2026: Free AI Tailoring',
    meta: "Resume.io vs ResumeTailored AI: Resume.io’s trial renews at $29.95 every 4 weeks; ours tailors free. Prices checked on Resume.io’s pricing page, Oct 7, 2026.",
    h1: 'Best Resume.io Alternative in 2026',
    sub: 'Resume.io is a template-led resume builder. If you want unlimited free tailoring to each posting and a free plan that exports your resume, here is an honest comparison, checked against Resume.io’s own pricing page.',
    keywords: 'resume.io alternative, alternative to resume.io, resume.io vs resumetailored, resume.io pricing, free resume builder download',
    blog: [{ href: '/blog/free-ats-resume-scanners-compared', label: 'Free ATS resume scanners compared' }],
    related: ['kickresume', 'rezi'],
    callout: [['Resume.io quarterly', '$49.95/3 mo'], ['ResumeTailored Pro', '$19.00/mo'], ['Free tailoring', 'Unlimited']],
    table: [
      ['Free plan', '$0: one resume and one cover letter, downloadable as TXT only (no PDF), limited sharing and analytics', US_C.free],
      ['Paid price', '7-day trial for $2.95, then auto-renews to $29.95 billed every 4 weeks; or Quarterly $49.95 billed every 3 months', 'Pro: $19.00/month (cancel any time); Lifetime $129 one-time'],
      ['What paid includes', 'Unlimited resumes, cover letters, premium templates and PDF downloads', 'All 104 templates, watermark-free PDF/DOCX/TXT, 3 tailoring variants, ATS rewrite report'],
      ['Refund policy', '7-day money-back guarantee on paid plans', 'Monthly plans cancel any time; Lifetime is a one-time purchase'],
      ['AI features', CHECK, 'AI tailoring and cover letters, unlimited on Free'],
      ['Tailors a resume to a specific posting', CHECK, 'Core feature: paste a job description or URL'],
      ['Job-URL import', CHECK, US_C.urlImport],
    ],
    theirStrengths: [
      'A focused, template-led builder with unlimited resumes, cover letters and PDF downloads on paid plans.',
      'A free plan with one resume and one cover letter, for trying the editor.',
      'A published 7-day money-back guarantee.',
    ],
    ourStrengths: [
      'Unlimited tailoring and cover letters on the free plan, with exports in PDF, DOCX and text (free exports carry a small watermark).',
      'No auto-renewing trial: the free plan needs no card, and Pro is $19.00 a month with cancel-any-time billing.',
      'Paste a job URL from LinkedIn, Indeed, Glassdoor or 40+ boards to start a tailored resume.',
    ],
    bestFor: {
      them: 'You want a template-first builder and are comfortable with a paid plan for PDF downloads.',
      us: 'You apply to many roles and want each resume and cover letter tailored to the posting, with exports available on the free plan.',
    },
    faq: [
      ['Is ResumeTailored AI a good Resume.io alternative?', 'If you want AI tailoring to each posting and a free plan that exports, yes. Resume.io is a solid template-led builder; the trade-off is that its free plan limits you to one resume and a text download.'],
      ['How much does Resume.io cost?', "Per Resume.io's pricing page (checked " + VERIFIED_LABEL + "): a 7-day trial at $2.95 that auto-renews to $29.95 every 4 weeks, or $49.95 billed every 3 months. ResumeTailored AI Pro is $19.00/month or $129 one-time. Confirm on Resume.io's site, and read the renewal terms before starting any trial."],
      ['Can I download my resume free on Resume.io?', "Resume.io's free plan allows one resume and one cover letter with TXT downloads; PDF download is part of the paid plans. ResumeTailored AI free accounts can export PDF, DOCX and text, with a small watermark."],
      ['Does Resume.io have AI features?', "Its pricing page promotes an AI resume builder but does not say which plans include it, so check Resume.io's site. We do not claim it lacks AI."],
      ['What AI does ResumeTailored AI use?', 'Anthropic’s Claude. We make no claim about which model Resume.io uses.'],
    ],
  },
  {
    slug: 'enhancv', audience: 'candidate', name: 'Enhancv', outFile: 'enhancv-alternative.html', canonicalPath: '/enhancv-alternative',
    officialUrl: 'https://enhancv.com/pricing/', officialLabel: "Enhancv's pricing page",
    title: 'Best Enhancv Alternative in 2026: Free AI Resume Tailoring',
    meta: "Enhancv vs ResumeTailored AI: Enhancv’s free plan is a 7-day window; ours has unlimited free tailoring. Checked against Enhancv’s pricing page, Oct 7, 2026.",
    h1: 'Best Enhancv Alternative in 2026',
    sub: 'Enhancv is known for polished, design-forward resumes. If you want AI tailoring to each posting on a free plan that does not expire, here is an honest comparison, checked against Enhancv’s own pricing page.',
    keywords: 'enhancv alternative, alternative to enhancv, enhancv vs resumetailored, enhancv pricing, free ai resume builder',
    blog: [{ href: '/blog/free-ats-resume-scanners-compared', label: 'Free ATS resume scanners compared' }],
    related: ['kickresume', 'resume-io'],
    callout: [['Enhancv free plan', '7-day window'], ['ResumeTailored Pro', '$19.00/mo'], ['Free tailoring', 'Unlimited']],
    table: [
      ['Free plan', 'Valid for 7 days: all resume templates, basic sections, Enhancv branding, up to 12 section items, all design tools', US_C.free],
      ['Paid plan', 'Pro quarterly: 300 resumes and cover letters, all templates, ATS check, real-time content suggestions, no branding, unlimited section items. The price text was not readable when we checked, so see Enhancv’s site.', 'Pro: $19.00/month; Lifetime $129 one-time'],
      ['AI features', 'Enhancv describes a suite of AI features; the pricing page does not say which plans include them', 'AI tailoring and cover letters, unlimited on Free'],
      ['Tailoring to a job description', 'Described as a feature on Enhancv’s pricing page; plan inclusion not stated', 'Core feature: paste a job description or URL'],
      ['ATS check', 'Included on Pro', 'Free ATS scanner; Pro adds an ATS rewrite report'],
      ['Job-URL import', CHECK, US_C.urlImport],
    ],
    theirStrengths: [
      'Design-forward templates and a flexible design editor, with all templates available even on the free plan.',
      'An ATS check, content suggestions and cover letters bundled into Pro, with up to 300 documents.',
      'Describes resume tailoring to job descriptions as a feature, so it is not a tailoring-free tool.',
    ],
    ourStrengths: [
      'A free plan that does not expire and includes unlimited tailoring, cover letters and ATS scans.',
      'Pro at $19.00 a month or a $129 one-time lifetime option.',
      'Paste a job URL from LinkedIn, Indeed, Glassdoor or 40+ boards to start a tailored resume.',
    ],
    bestFor: {
      them: 'You care most about visual design and are happy to subscribe for the editor and ATS check.',
      us: 'You apply to many roles and want tailoring to each posting on a free plan that does not expire.',
    },
    faq: [
      ['Is ResumeTailored AI a good Enhancv alternative?', 'If you want a free plan that keeps working and unlimited tailoring, yes. Enhancv is stronger on design, and it also describes tailoring and AI features, so compare both on the same resume and posting.'],
      ['How does Enhancv pricing work?', "Per Enhancv's pricing page (checked " + VERIFIED_LABEL + "): a free plan valid for 7 days and a quarterly Pro plan. The Pro price was not legible when we retrieved the page, so check Enhancv's site. ResumeTailored AI Pro is $19.00/month or $129 one-time."],
      ['Does Enhancv have an ATS checker?', "Enhancv's pricing page lists an ATS check as part of Pro. ResumeTailored AI has a free ATS scanner, and Pro adds a rewrite report."],
      ['Does Enhancv tailor resumes to job descriptions?', "Its pricing page describes resume tailoring to job descriptions as a feature without stating the plan, so check Enhancv's site."],
      ['What AI does ResumeTailored AI use?', 'Anthropic’s Claude. We make no claim about which model Enhancv uses.'],
    ],
  },
  // ───────────────────────── Employer side ─────────────────────────
  {
    slug: 'breezy', audience: 'employer', name: 'Breezy HR',
    officialUrl: 'https://breezy.hr/pricing', officialLabel: "Breezy HR's pricing page",
    title: 'Best Breezy HR Alternative in 2026: Hiring Portal from $0',
    meta: "Breezy HR vs ResumeTailored for Employers: free plans, paid tiers from $49/mo, video interviews and e-signatures compared, checked Oct 7, 2026.",
    h1: 'Best Breezy HR Alternative in 2026',
    sub: 'Breezy HR is a mature applicant tracker with job-board distribution. If you are a small team that wants AI-ranked applicants, video interviews and e-signatures at a lower monthly price, here is an honest comparison.',
    keywords: 'breezy hr alternative, alternative to breezy, breezy hr pricing, small business applicant tracking system, free ats for small business',
    blog: [{ href: '/blog/best-ats-for-small-business', label: 'Best ATS for small business in 2026: a buyer’s guide' }],
    related: ['workable'],
    callout: [['Breezy paid plans', 'from $157/mo'], ['ResumeTailored Portal', '$49/mo'], ['Free plan', '$0']],
    table: [
      ['Free plan', 'Bootstrap: free, unlimited users, 1 active position or pool at a time, distribution to 50+ job boards', 'Free: 1 active job, 10 candidates in your pipeline, 1 seat, 3 e-signature sends a month, basic career page'],
      ['Paid plans', 'Startup $157 to $189/mo; Growth $273 to $329/mo; Business $439 to $529/mo (the page shows two prices per plan and does not label annual vs monthly)', 'Portal $49/mo; Scale $99/mo; Corporate $299/mo (per workspace)'],
      ['Free trial', '14-day full-feature trial, no card needed', 'No trial needed: start on the free plan'],
      ['Job board distribution', '50+ job boards', 'Not offered. Roles appear on your ResumeTailored careers page and in the job-seeker feed; bring your own distribution'],
      ['AI features', 'Add-on: Breezy Intelligence credits from $30 per 100,000', 'AI candidate matching built in: every applicant is scored against the role with matched and missing keywords'],
      ['Video interviews', 'Startup and up (Zoom, Google Meet, MS Teams integrations); recording on Business', 'Portal and up: 10/mo with recording; Scale: 50/mo with AI summaries'],
      ['E-signatures', 'Growth and up', 'All plans: 3/mo on Free, 10 on Portal, 50 on Scale, unlimited on Corporate'],
      ['Pipelines', 'One pipeline on Startup; multiple pipelines on Growth and up', 'Drag-and-drop pipeline: New, Reviewed, Interview, Hired'],
      ['HR extras', CHECK, 'Portal and up: Employees hub and time suite. Scale: Office suite'],
    ],
    theirStrengths: [
      'Distribution to 50+ job boards on every plan, including the free one.',
      'Multiple recruiting pipelines on higher plans and a long-established feature set for hiring teams.',
      'A free plan with unlimited users, and a 14-day full-feature trial.',
    ],
    ourStrengths: [
      'Lower entry price for a full workspace: Portal is $49/mo with unlimited jobs and candidates and 3 seats.',
      'AI candidate matching, video interviews with recording, e-signatures and HR documents in one workspace.',
      'Clear tiers with seats, e-signature sends and interviews listed up front.',
    ],
    bestFor: {
      them: 'You rely on multiposting to many job boards and want that included from day one.',
      us: 'You mostly hire from your own careers page and referrals, and want AI-ranked applicants, interviews and e-signatures in one lower-priced workspace.',
    },
    faq: [
      ['Is ResumeTailored a good Breezy HR alternative?', 'For small teams that want AI-ranked applicants, a pipeline, video interviews and e-signatures at a lower price, yes. If you depend on one-click posting to many job boards, Breezy is stronger there: we do not offer multiposting.'],
      ['How does Breezy HR pricing compare?', "Per Breezy's pricing page (checked " + VERIFIED_LABEL + "): Bootstrap is free with one active position; paid plans start at $157 to $189 a month. ResumeTailored for Employers has a free plan, then Portal $49/mo, Scale $99/mo and Corporate $299/mo. Confirm current Breezy pricing on its site."],
      ['Does ResumeTailored post jobs to Indeed or LinkedIn?', 'No. Your jobs appear on your ResumeTailored careers page and in the job-seeker feed. If you need multiposting, use a job-board distribution tool alongside it.'],
      ['Are video interviews included?', 'Portal includes 10 video interviews a month with recording, and Scale includes 50 a month with AI summaries. The free plan does not include video interviews.'],
      ['Can I start without a credit card?', 'Yes. Create a free employer account to get 1 active job, 10 candidates in your pipeline and 1 team seat.'],
    ],
  },
  {
    slug: 'workable', audience: 'employer', name: 'Workable',
    officialUrl: 'https://www.workable.com/pricing', officialLabel: "Workable's pricing page",
    title: 'Best Workable Alternative in 2026: Start Free, Not $299/mo',
    meta: "Workable vs ResumeTailored for Employers: Workable Standard is $299/mo; ours starts free with Portal at $49/mo. Plans compared, checked Oct 7, 2026.",
    h1: 'Best Workable Alternative in 2026',
    sub: 'Workable is a full-featured recruiting platform priced for larger teams. If you are a smaller team that wants AI-ranked applicants, video interviews and e-signatures without a $299 monthly floor, here is how they compare.',
    keywords: 'workable alternative, alternative to workable, workable pricing, cheaper applicant tracking system, small business ats',
    blog: [{ href: '/blog/best-ats-for-small-business', label: 'Best ATS for small business in 2026: a buyer’s guide' }],
    related: ['breezy'],
    callout: [['Workable Standard', '$299/mo'], ['ResumeTailored Portal', '$49/mo'], ['Free plan', '$0']],
    table: [
      ['Entry price', 'Standard: $299/month billed monthly, or $3,588/year billed annually', 'Free plan, then Portal $49/month (per workspace)'],
      ['Higher tiers', 'Premier $599/month and Enterprise $719/month (both shown with annual billing)', 'Scale $99/month; Corporate $299/month'],
      ['Free trial', '15 days on the Standard feature set, no card needed', 'No trial needed: start on the free plan'],
      ['Active jobs', 'Unlimited, subject to fair usage', 'Free: 1 active job. Portal and up: unlimited jobs and candidates'],
      ['Job board distribution', '200+ job boards and a careers page builder', 'Not offered. Roles appear on your ResumeTailored careers page and in the job-seeker feed'],
      ['AI features', 'Workable Agent add-on; every paid account starts with 3,000 free AI credits, more sold in packs', 'AI candidate matching built in; AI interview summaries on Scale'],
      ['Video interviews', 'Add-on on Standard (Video interviews+ $109/mo); included on Premier and up', 'Portal: 10 a month with recording. Scale: 50 a month with AI summaries'],
      ['E-signatures', 'Included for recruiting and HR documents', 'All plans (3/mo Free, 10 Portal, 50 Scale, unlimited Corporate)'],
      ['Reporting', 'Full reporting suite and custom report builder', 'Hiring funnel, time-to-hire analytics and CSV export'],
    ],
    theirStrengths: [
      'Distribution to 200+ job boards and a deep reporting suite.',
      'A mature platform with texting, assessments and HR performance add-ons.',
      'Built for larger hiring volumes where multiposting and custom reports matter.',
    ],
    ourStrengths: [
      'A real free plan and a $49/month Portal tier, against a $299/month Workable entry price.',
      'AI candidate matching, a drag-and-drop pipeline, video interviews and e-signatures in one workspace.',
      'Plan limits (seats, e-signature sends, interviews) are listed plainly on the pricing page.',
    ],
    bestFor: {
      them: 'You hire in volume, need multiposting to hundreds of boards, and want advanced reporting and add-ons.',
      us: 'You are a small or growing team that wants a capable hiring workspace at a fraction of the price and mostly sources from your own careers page.',
    },
    faq: [
      ['Is ResumeTailored a good Workable alternative?', 'For small teams, yes: you get AI-ranked applicants, a pipeline, video interviews and e-signatures starting free, with Portal at $49/month. Workable is stronger for high-volume hiring that needs multiposting and deep reporting.'],
      ['How much does Workable cost compared with ResumeTailored?', "Per Workable's pricing page (checked " + VERIFIED_LABEL + "): Standard is $299/month billed monthly or $3,588/year, Premier $599/month and Enterprise $719/month with annual billing. ResumeTailored for Employers is free to start, then $49, $99 or $299 a month per workspace. Confirm current Workable pricing on its site."],
      ['Does ResumeTailored distribute jobs to job boards?', 'No. Your jobs appear on your ResumeTailored careers page and in the job-seeker feed. Workable lists 200+ job boards, so choose it if multiposting is essential.'],
      ['Does ResumeTailored include e-signatures?', 'Yes, on every plan: 3 sends a month on Free, 10 on Portal, 50 on Scale and unlimited on Corporate.'],
      ['Can I try it before paying?', 'Yes. The free employer plan includes 1 active job, 10 candidates in your pipeline and 1 team seat, with no credit card.'],
    ],
  },
];

// ── Rendering ────────────────────────────────────────────────────────────────
function loadChrome() {
  const css = fs.readFileSync(path.join(__dirname, 'templates', 'alternatives-base.css'), 'utf8');
  // Phones: stack each row (feature / competitor / us) instead of a clipped 3-column table.
  const extra = `
.comparison-wrap{overflow:visible}
.comparison-table td.td-us{color:#9be7bd;font-weight:600}
.card ul{margin:10px 0 0 18px;padding:0}.card li{margin-bottom:8px;line-height:1.55}
@media(max-width:640px){
  .comparison-table,.comparison-table tbody,.comparison-table tr,.comparison-table td{display:block;width:100%}
  .comparison-table thead{display:none}
  .comparison-table tr{margin:0 0 14px;border:1px solid rgba(128,128,128,.35);border-radius:12px;overflow:hidden}
  .comparison-table td{padding:10px 14px;border:0;text-align:left}
  .comparison-table td:first-child{font-weight:800}
  .comparison-table td[data-label]::before{content:attr(data-label);display:block;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;opacity:.65;margin-bottom:2px}
  .price-callout{flex-wrap:wrap;max-width:100%}
  .container{padding-left:16px;padding-right:16px}
}
html,body{overflow-x:hidden}`;
  return { css: css + extra };
}

function jsonLd(p, url) {
  const web = {
    '@context': 'https://schema.org', '@type': 'WebPage', '@id': url + '#webpage', url, name: p.title,
    description: p.meta, inLanguage: 'en', dateModified: VERIFIED_ON,
    isPartOf: { '@type': 'WebSite', name: 'ResumeTailored AI', url: ORIGIN + '/' },
    about: { '@type': 'Thing', name: p.name + ' alternative' },
  };
  const faq = {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: p.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
  };
  return [web, faq].map((o) => `  <script type="application/ld+json">\n${JSON.stringify(o, null, 2)}\n  </script>`).join('\n');
}

function render(p, chrome) {
  const url = `${ORIGIN}${p.canonicalPath || '/alternatives/' + p.slug}`;
  const emp = p.audience === 'employer';
  const ctaHref = emp ? '/for-employers' : '/';
  const ctaText = emp ? 'See ResumeTailored for Employers →' : 'Tailor My Resume Free →';
  const ctaBanner = emp
    ? { h: 'Start hiring free', t: 'Create a free employer account: 1 active job, 10 candidates in your pipeline and 1 team seat. Upgrade only when you need more.', note: 'Free plan • Portal $49/mo • Scale $99/mo • Corporate $299/mo' }
    : { h: 'Try it on your next application', t: 'Paste a job description or URL and get a tailored resume and cover letter. A free account is all you need.', note: 'Unlimited free tailoring • Pro $19.00/mo • Lifetime $129' };
  const rows = p.table.map(([f, t, u]) => {
    const unv = t === CHECK;
    return `          <tr>\n            <td>${esc(f)}</td>\n            <td data-label="${esc(p.name)}">${unv ? `<span class="warn">&#9888;</span> ${esc(t)}` : esc(t)}</td>\n            <td class="td-us" data-label="ResumeTailored">${esc(u)}</td>\n          </tr>`;
  }).join('\n');
  const li = (a) => a.map((x) => `            <li>${esc(x)}</li>`).join('\n');
  const faqHtml = p.faq.map(([q, a]) => `      <div class="faq-item">\n        <div class="faq-q">${esc(q)}<span class="faq-arrow">&#8964;</span></div>\n        <div class="faq-a">${esc(a)}</div>\n      </div>`).join('\n');
  const others = PAGES.filter((x) => p.related.includes(x.slug));
  const relatedLinks = others.map((o) => `<a href="${o.canonicalPath || '/alternatives/' + o.slug}">${esc(o.name)} alternative</a>`).join(' &bull; ');
  const blogLinks = p.blog.map((b) => `<a href="${b.href}">${esc(b.label)}</a>`).join(' &bull; ');
  const callout = p.callout.map(([l, a], i) => `      ${i ? '<div class="price-divider"></div>\n      ' : ''}<div class="price-item"><span class="label">${esc(l)}</span><span class="amount${i ? ' green' : ''}">${esc(a)}</span></div>`).join('\n');
  const footerLinks = [['Blog', '/blog'], ['vs Rezi', '/alternatives/rezi'], ['vs Jobscan', '/alternatives/jobscan'], ['vs Teal', '/alternatives/teal'], ['vs Kickresume', '/alternatives/kickresume'], ['vs Breezy', '/alternatives/breezy'], ['vs Workable', '/alternatives/workable'], ['For Employers', '/for-employers'], ['Free ATS Keyword Tool', '/tools/ats-keyword-extractor']]
    .map(([l, h]) => `      <a href="${h}">${l}</a>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(p.title)}</title>
  <meta name="description" content="${esc(p.meta)}" />
  <meta name="keywords" content="${esc(p.keywords)}" />
  <link rel="canonical" href="${url}" />
  <meta property="og:title" content="${esc(p.title)}" />
  <meta property="og:description" content="${esc(p.meta)}" />
  <meta property="og:url" content="${url}" />
  <meta property="og:type" content="website" />
  <meta property="og:image" content="${ORIGIN}/og-image.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(p.title)}" />
  <meta name="twitter:description" content="${esc(p.meta)}" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="icon" href="/favicon-32.png" sizes="32x32" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <script>
  (function(){var ID='G-JWC76X5X68',loaded=false;window.dataLayer=window.dataLayer||[];window.gtag=function(){window.dataLayer.push(arguments);};gtag('js',new Date());gtag('config',ID);
  var ev=['scroll','pointerdown','keydown','touchstart','mousemove'];function load(){if(loaded)return;loaded=true;ev.forEach(function(e){window.removeEventListener(e,load,{passive:true});});var s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id='+ID;document.head.appendChild(s);}
  ev.forEach(function(e){window.addEventListener(e,load,{passive:true});});setTimeout(load,3000);})();
  </script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
${jsonLd(p, url)}
  <style>${chrome.css}</style>
</head>
<body>

<nav class="nav">
  <div class="nav-inner">
    <a href="/" class="logo">ResumeTailored<span class="badge-ai">AI</span></a>
    <div class="nav-links">
      <a href="/how-it-works">How It Works</a>
      <a href="/blog">Blog</a>
      <a href="/pricing">Pricing</a>
    </div>
    <div class="nav-actions">
      <a href="/dashboard" class="btn btn-ghost">Log In</a>
      <a href="${ctaHref}" class="btn btn-primary">${esc(ctaText)}</a>
    </div>
    <button class="hamburger" onclick="document.getElementById('mob').classList.add('open')" aria-label="Menu"><span></span><span></span><span></span></button>
  </div>
</nav>
<div class="mobile-menu" id="mob">
  <button class="mobile-close" onclick="document.getElementById('mob').classList.remove('open')">&times;</button>
  <a href="/how-it-works">How It Works</a>
  <a href="/blog">Blog</a>
  <a href="/pricing">Pricing</a>
  <a href="${ctaHref}" class="btn btn-primary btn-lg">${esc(ctaText)}</a>
</div>

<section class="hero">
  <div class="container">
    <div class="hero-badge">${esc(p.name)} Alternative 2026</div>
    <h1>${esc(p.h1)}</h1>
    <p class="hero-sub">${esc(p.sub)}</p>
    <div class="hero-cta">
      <a href="${ctaHref}" class="btn btn-primary btn-lg">${esc(ctaText)}</a>
      <a href="#comparison" class="btn btn-ghost btn-lg">See the comparison &darr;</a>
    </div>
    <div class="price-callout">
${callout}
    </div>
    <p class="hero-note">Facts about ${esc(p.name)} verified ${VERIFIED_LABEL}. Anything we could not confirm says “${CHECK}”.</p>
  </div>
</section>

<section class="section section-gray" id="comparison">
  <div class="container">
    <p class="section-eyebrow">Side by side</p>
    <h2 class="section-title">${esc(p.name)} vs <span>ResumeTailored${emp ? ' for Employers' : ' AI'}</span></h2>
    <p class="section-sub">Verified as of ${VERIFIED_LABEL} from <a href="${p.officialUrl}" rel="noopener nofollow">${esc(p.officialLabel)}</a> and our own <a href="/pricing">pricing page</a>. Plans change, so confirm before you buy.</p>
    <div class="comparison-wrap">
      <table class="comparison-table">
        <thead>
          <tr>
            <th style="width:24%">Feature</th>
            <th class="th-comp">${esc(p.name)}</th>
            <th class="th-us">ResumeTailored${emp ? '' : ' AI'}<br /><span class="th-badge">Our product</span></th>
          </tr>
        </thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </div>
  </div>
</section>

<section class="section">
  <div class="container">
    <p class="section-eyebrow">Fair comparison</p>
    <h2 class="section-title">Where each one <span>is stronger</span></h2>
    <div class="card-grid">
      <div class="card">
        <h3>Where ${esc(p.name)} is stronger</h3>
        <ul>
${li(p.theirStrengths)}
        </ul>
      </div>
      <div class="card">
        <h3>Where ResumeTailored is stronger</h3>
        <ul>
${li(p.ourStrengths)}
        </ul>
      </div>
      <div class="card">
        <h3>Who should pick which</h3>
        <p><strong>Choose ${esc(p.name)} if:</strong> ${esc(p.bestFor.them)}</p>
        <p><strong>Choose ResumeTailored if:</strong> ${esc(p.bestFor.us)}</p>
      </div>
    </div>
    <p class="section-sub" style="margin-top:24px">Read more: ${blogLinks}${relatedLinks ? ' &bull; ' + relatedLinks : ''}</p>
  </div>
</section>

<section class="section section-gray">
  <div class="container">
    <p class="section-eyebrow">Questions</p>
    <h2 class="section-title">Frequently asked <span>questions</span></h2>
    <div class="faq-list">
${faqHtml}
    </div>
  </div>
</section>

<section class="cta-banner">
  <div class="container">
    <h2>${esc(ctaBanner.h)}</h2>
    <p>${esc(ctaBanner.t)}</p>
    <a href="${ctaHref}" class="btn btn-white btn-lg">${esc(ctaText)}</a>
    <p class="cta-note">${esc(ctaBanner.note)}</p>
  </div>
</section>

<footer class="footer">
  <div class="footer-inner">
    <a href="/" class="logo">ResumeTailored<span class="badge-ai">AI</span></a>
    <div class="footer-links">
${footerLinks}
    </div>
    <div class="footer-copy">&copy; 2026 ResumeTailored AI. Competitor information last verified ${VERIFIED_LABEL}.</div>
  </div>
</footer>

<script>document.querySelectorAll('.faq-q').forEach(function(q){q.addEventListener('click',function(){q.parentElement.classList.toggle('open');});});</script>
<script src="/mobile-native.js" defer></script>
<script src="/site-nav.js" defer></script>
</body>
</html>
`;
}

function main() {
  const only = process.argv.slice(2);
  const chrome = loadChrome();
  for (const p of PAGES) {
    if (only.length && !only.includes(p.slug)) continue;
    if (p.title.length > 60) throw new Error(`${p.slug}: title is ${p.title.length} chars (>60)`);
    if (p.meta.length > 160) throw new Error(`${p.slug}: meta is ${p.meta.length} chars (>160)`);
    fs.writeFileSync(path.join(PUB, p.outFile || path.join('alternatives', p.slug + '.html')), render(p, chrome));
    console.log(`wrote public/${p.outFile || 'alternatives/' + p.slug + '.html'}  title=${p.title.length}  meta=${p.meta.length}`);
  }
}
if (require.main === module) main();
module.exports = { PAGES, VERIFIED_ON };
