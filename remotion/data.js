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

module.exports = { defaultResumeVideoProps, FPS, sceneFrames };
