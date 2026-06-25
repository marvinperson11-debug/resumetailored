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

// Spoken voiceover broken into ordered segments, each tagged with the scene it
// drives. Single source of truth for both the script (join the texts) and the
// reveal timing — each segment maps to one on-screen scene shown exactly while
// its text is spoken. `index` is the highlight number.
// Expand name suffixes for speech so TTS doesn't spell them out ("J. R.").
// Visual scenes still show the original ("Jr"); only the spoken script changes.
function speakableName(name) {
  return String(name || '')
    .replace(/\bJr\.?\b/gi, 'Junior')
    .replace(/\bSr\.?\b/gi, 'Senior')
    .replace(/\bIII\b/g, 'the Third')
    .replace(/\bIV\b/g, 'the Fourth')
    .replace(/\bII\b/g, 'the Second')
    .replace(/\s+/g, ' ')
    .trim();
}

function narrationSegments(props) {
  const p = props || {};
  const segs = [];
  // Optionally address the recipient first (e.g. "Hi Mr. Smith, Hiring Manager.").
  const rcpt = String(p.recipientName || '').trim();
  const rcptTitle = String(p.recipientTitle || '').trim();
  if (rcpt) segs.push({ kind: 'greeting', text: `Hi ${rcpt}${rcptTitle ? ', ' + rcptTitle : ''}.` });
  // Candidate introduces themselves (no title — the focus is name + story).
  if (p.name) segs.push({ kind: 'intro', text: `${rcpt ? '' : 'Hello. '}My name is ${speakableName(p.name)}.` });
  if (p.summary) segs.push({ kind: 'summary', text: String(p.summary).replace(/\s+/g, ' ').trim() });
  const hs = (p.highlights || []).slice(0, 3);
  hs.forEach((h, i) => {
    const t = String(h).replace(/\s+/g, ' ').trim();
    if (t) segs.push({ kind: 'highlight', index: i, text: `${i === 0 ? 'Here are a few things I’m proud of. ' : ''}${t}.` });
  });
  const skills = (p.skills || []).slice(0, 6);
  if (skills.length) segs.push({ kind: 'skills', text: `My core skills include ${skills.join(', ')}.` });
  // No spoken brand/website outro — the video is about the candidate, not us.
  // The small corner watermark carries the brand silently.
  return segs;
}

// Build the exact script string AND each segment's character span within it, so
// a TTS engine that returns per-character timings (ElevenLabs) can be mapped
// back to per-segment start/end times with no drift.
function narrationTimeline(props) {
  const segs = narrationSegments(props);
  let script = '';
  const segments = segs.map((s) => {
    if (script) script += ' ';
    const charStart = script.length;
    script += s.text;
    return { ...s, charStart, charEnd: script.length };
  });
  return { script, segments };
}

// Spoken voiceover script derived from the resume props. Used both by the
// server-side TTS (remotion/narration.js) and the browser preview narration
// (public/preview.html). Kept short so it tracks the ~18s video length.
function narrationScript(props) {
  return narrationTimeline(props).script;
}

module.exports = { defaultResumeVideoProps, FPS, sceneFrames, narrationScript, narrationSegments, narrationTimeline };
