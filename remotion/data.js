// Single source of truth for default props and timing, written as CommonJS so
// the plain-Node server (remotion/parseResume.js, server.js) can require it and
// the TSX compositions can import the same values through webpack's CJS interop.

const defaultResumeVideoProps = {
  name: 'Alex Morgan',
  title: 'Senior Product Manager',
  summary:
    'Product leader who scaled a B2B SaaS platform from $2M to $18M ARR across 12 markets.',
  highlights: [
    'Drove $16M ARR growth by launching 3 enterprise products',
    'Led a cross-functional team of 24 across 4 time zones',
    'Cut churn 38% with a data-driven retention program',
    'Shipped an AI feature adopted by 200K+ users in 90 days',
  ],
  skills: [
    'Product Strategy',
    'Roadmapping',
    'A/B Testing',
    'SQL',
    'Go-to-Market',
    'OKRs',
    'Figma',
    'Analytics',
  ],
  accentColor: '#6366F1',
  brand: 'ResumeTailor AI',
};

const FPS = 30;

// Per-scene frame counts. `total` is what Root passes to <Composition> via
// calculateMetadata so the timeline always matches the content length.
function sceneFrames(highlightCount, fps = FPS) {
  const intro = Math.round(2.8 * fps);
  const perHighlight = Math.round(1.35 * fps);
  const highlights = Math.round(1.1 * fps) + perHighlight * Math.max(highlightCount, 1);
  const skills = Math.round(2.6 * fps);
  const outro = Math.round(2.6 * fps);
  return { intro, highlights, skills, outro, total: intro + highlights + skills + outro };
}

// Spoken voiceover script derived from the resume props. Used both by the
// server-side TTS (remotion/narration.js) and the browser preview narration
// (public/preview.html). Kept short so it tracks the ~18s video length.
function narrationScript(props) {
  const p = props || {};
  const parts = [];
  if (p.name) parts.push(`Meet ${p.name}${p.title ? `, ${p.title}` : ''}.`);
  if (p.summary) parts.push(p.summary);
  const hs = (p.highlights || []).slice(0, 3);
  if (hs.length) parts.push('Career highlights: ' + hs.map((h) => h.replace(/\s+/g, ' ').trim()).join('. ') + '.');
  const skills = (p.skills || []).slice(0, 6);
  if (skills.length) parts.push('Core skills include ' + skills.join(', ') + '.');
  if (p.brand) parts.push(`Tailored with ${p.brand}.`);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

module.exports = { defaultResumeVideoProps, FPS, sceneFrames, narrationScript };
