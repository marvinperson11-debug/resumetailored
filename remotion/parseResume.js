// Turns the plain-text resume produced by /api/tailor into structured props
// for the ResumeVideo composition. The tailor output follows a known layout
// (name, contact line, SUMMARY, EXPERIENCE with • bullets, EDUCATION, SKILLS),
// but this parser is deliberately tolerant of formatting drift.

const { defaultResumeVideoProps } = require('./data');

function clean(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

// Chinese resumes have no uppercase headers — recognise the common section
// names directly and normalise them onto the English keys the rest of the
// parser matches on (SUMMARY / EXPERIENCE / SKILLS / EDUCATION).
const ZH_HEADERS = [
  [/^(个人简介|个人总结|职业总结|个人概述|简介|概述|自我评价)[:：]?$/, 'SUMMARY'],
  [/^(工作经历|工作经验|职业经历|项目经历|实习经历)[:：]?$/, 'EXPERIENCE'],
  [/^(专业技能|核心技能|技能专长|技能)[:：]?$/, 'SKILLS'],
  [/^(教育背景|教育经历|学历)[:：]?$/, 'EDUCATION'],
];
function zhHeaderKey(line) {
  const t = line.trim();
  if (!t || t.length > 12) return null;
  for (const [re, key] of ZH_HEADERS) if (re.test(t)) return key;
  return null;
}

const CJK_RE = /[一-鿿㐀-䶿]/;
// Rough share of CJK characters among the text's word characters — used to
// decide the video's narration/display language.
function cjkShare(text) {
  const t = String(text || '');
  const cjk = (t.match(/[一-鿿㐀-䶿]/g) || []).length;
  const latin = (t.match(/[A-Za-z]/g) || []).length;
  return cjk + latin === 0 ? 0 : cjk / (cjk + latin);
}

// A section header is a short, all-uppercase line (SUMMARY, EXPERIENCE, ...)
// or one of the known Chinese section names.
function isHeader(line) {
  if (zhHeaderKey(line)) return true;
  const t = line.trim();
  if (!t || t.length > 34) return false;
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3) return false;
  if (t !== t.toUpperCase()) return false;
  return /^[A-Z0-9 &/]+$/.test(t);
}

const BULLET_RE = /^\s*[•\-*–·▪]\s+/;

// Pick the candidate's name: the first line that actually looks like a name,
// not a stray initial ("M"), a contact line, a phone number, or a section
// header. Prefers a "First Last" line (has a space).
function pickName(lines) {
  const cands = lines.map((l) => l.trim()).filter(Boolean);
  const ok = (t) => {
    if (t.length > 60) return false;
    if (/[@|]/.test(t)) return false; // contact line
    if (/\d{3,}/.test(t)) return false; // phone / numbers
    if (zhHeaderKey(t)) return false; // Chinese section header
    // Chinese names are 2-4 CJK characters with no Latin requirement.
    if (CJK_RE.test(t)) return t.replace(/[^一-鿿㐀-䶿A-Za-z·]/g, '').length >= 2;
    if (t.length < 3) return false;
    if (t.replace(/[^A-Za-z]/g, '').length < 3) return false; // skips "M", "M.", initials
    if (t === t.toUpperCase() && !/\s/.test(t)) return false; // single all-caps word = header
    return true;
  };
  return clean(cands.find((t) => ok(t) && (/\s/.test(t) || CJK_RE.test(t))) || cands.find(ok) || cands[0] || '').slice(0, 60);
}

function parseResume(text, opts = {}) {
  const raw = String(text || '').replace(/\r/g, '').replace(/\*\*/g, '');
  const lines = raw.split('\n');

  // Name = first line that plausibly looks like a person's name.
  const name = pickName(lines);

  // Group lines under their section header.
  const sections = { _head: [] };
  let current = '_head';
  for (const line of lines) {
    if (isHeader(line)) {
      // Chinese headers normalise onto the English section keys.
      current = zhHeaderKey(line) || line.trim().toUpperCase();
      sections[current] = sections[current] || [];
    } else {
      sections[current].push(line);
    }
  }
  const findSection = (keys) => {
    const key = Object.keys(sections).find((h) => keys.some((k) => h.includes(k)));
    return key ? sections[key] : [];
  };

  const summary = clean(findSection(['SUMMARY', 'PROFILE']).join(' ')).slice(0, 220);

  // Title = first non-bullet line under EXPERIENCE, before any "Company | dates".
  const expLines = findSection(['EXPERIENCE']);
  const titleLine = expLines.find((l) => l.trim() && !BULLET_RE.test(l));
  const title = clean((titleLine || '').split('|')[0]).slice(0, 60);

  // Highlights = bullets across the whole doc, quantified ones first.
  let bullets = lines
    .filter((l) => BULLET_RE.test(l))
    .map((l) => clean(l.replace(BULLET_RE, '')))
    .filter((b) => b.length > 8);
  const quantified = bullets.filter((b) => /\d/.test(b));
  const rest = bullets.filter((b) => !/\d/.test(b));
  const highlights = [...quantified, ...rest]
    .slice(0, opts.maxHighlights || 5)
    .map((b) => b.replace(/[.;]+$/, '').slice(0, 130));

  // Skills = comma/pipe separated list under SKILLS.
  const skills = clean(findSection(['SKILLS']).join(', '))
    .split(/[,，、|•\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && s.length < 40)
    .slice(0, opts.maxSkills || 8);

  // Narrate/display in Chinese when the resume is predominantly Chinese (an
  // explicit opts.lang always wins). Threshold is low because a Chinese resume
  // still carries plenty of Latin (company names, tools, emails).
  const lang = opts.lang === 'zh' || opts.lang === 'en' ? opts.lang : (cjkShare(raw) > 0.25 ? 'zh' : 'en');

  // Fall back to defaults so the renderer never receives empty scenes.
  return {
    name: name || defaultResumeVideoProps.name,
    title: title || (lang === 'zh' ? '专业人士' : 'Professional'),
    summary,
    highlights: highlights.length ? highlights : defaultResumeVideoProps.highlights,
    skills: skills.length ? skills : defaultResumeVideoProps.skills,
    accentColor: opts.accentColor || defaultResumeVideoProps.accentColor,
    brand: opts.brand || defaultResumeVideoProps.brand,
    lang,
  };
}

module.exports = { parseResume };
