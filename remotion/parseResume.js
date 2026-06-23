// Turns the plain-text resume produced by /api/tailor into structured props
// for the ResumeVideo composition. The tailor output follows a known layout
// (name, contact line, SUMMARY, EXPERIENCE with • bullets, EDUCATION, SKILLS),
// but this parser is deliberately tolerant of formatting drift.

const { defaultResumeVideoProps } = require('./data');

function clean(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

// A section header is a short, all-uppercase line (SUMMARY, EXPERIENCE, ...).
function isHeader(line) {
  const t = line.trim();
  if (!t || t.length > 34) return false;
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3) return false;
  if (t !== t.toUpperCase()) return false;
  return /^[A-Z0-9 &/]+$/.test(t);
}

const BULLET_RE = /^\s*[•\-*–·▪]\s+/;

function parseResume(text, opts = {}) {
  const raw = String(text || '').replace(/\r/g, '').replace(/\*\*/g, '');
  const lines = raw.split('\n');

  // Name = first non-empty line. Drop a leading contact line if it has |/@.
  const name = clean((lines.find((l) => l.trim()) || '')).slice(0, 60);

  // Group lines under their section header.
  const sections = { _head: [] };
  let current = '_head';
  for (const line of lines) {
    if (isHeader(line)) {
      current = line.trim().toUpperCase();
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
    .split(/[,|•\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1 && s.length < 40)
    .slice(0, opts.maxSkills || 8);

  // Fall back to defaults so the renderer never receives empty scenes.
  return {
    name: name || defaultResumeVideoProps.name,
    title: title || 'Professional',
    summary,
    highlights: highlights.length ? highlights : defaultResumeVideoProps.highlights,
    skills: skills.length ? skills : defaultResumeVideoProps.skills,
    accentColor: opts.accentColor || defaultResumeVideoProps.accentColor,
    brand: opts.brand || defaultResumeVideoProps.brand,
  };
}

module.exports = { parseResume };
