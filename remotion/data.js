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
  brand: 'ResumeTailored AI',
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
// Expand honorifics, name suffixes and common job-title abbreviations for
// speech so the TTS says the words instead of spelling out the letters
// ("Mr." → "Mister", "VP" → "Vice President", "Jr." → "Junior"). Visual scenes
// still show the original text; only the spoken script is expanded.
function speakable(s) {
  let t = String(s || '').replace(/\s+/g, ' ').trim();
  const reps = [
    // Honorifics (the \b before the optional dot lets us also consume "Mr.")
    [/\bMrs\b\.?/gi, 'Missus'],
    [/\bMr\b\.?/gi, 'Mister'],
    [/\bMs\b\.?/gi, 'Miz'],
    [/\bMx\b\.?/gi, 'Mix'],
    [/\bDr\b\.?/gi, 'Doctor'],
    [/\bProf\b\.?/gi, 'Professor'],
    // Name suffixes
    [/\bJr\b\.?/gi, 'Junior'],
    [/\bSr\b\.?/gi, 'Senior'],
    [/\bIII\b/g, 'the Third'],
    [/\bIV\b/g, 'the Fourth'],
    [/\bII\b/g, 'the Second'],
    // Job-title / position abbreviations
    [/\bSVP\b/g, 'Senior Vice President'],
    [/\bEVP\b/g, 'Executive Vice President'],
    [/\bAVP\b/g, 'Assistant Vice President'],
    [/\bVP\b/g, 'Vice President'],
    [/\bCEO\b/g, 'Chief Executive Officer'],
    [/\bCFO\b/g, 'Chief Financial Officer'],
    [/\bCTO\b/g, 'Chief Technology Officer'],
    [/\bCOO\b/g, 'Chief Operating Officer'],
    [/\bCMO\b/g, 'Chief Marketing Officer'],
    [/\bCIO\b/g, 'Chief Information Officer'],
    [/\bCHRO\b/g, 'Chief Human Resources Officer'],
    [/\bHR\b/g, 'Human Resources'],
    [/\bMgr\b\.?/gi, 'Manager'],
    [/\bDir\b\.?/gi, 'Director'],
    [/\bAsst\b\.?/gi, 'Assistant'],
    [/\bAssoc\b\.?/gi, 'Associate'],
    [/\bExec\b\.?/gi, 'Executive'],
    [/\bCoord\b\.?/gi, 'Coordinator'],
    [/\bAdmin\b\.?/gi, 'Administrator'],
    [/\bRep\b\.?/gi, 'Representative'],
    [/\bSpec\b\.?/gi, 'Specialist'],
    [/\bEngr?\b\.?/gi, 'Engineer'],
    [/\bOps\b/gi, 'Operations'],
  ];
  for (const [re, rep] of reps) t = t.replace(re, rep);
  return t.replace(/\s+/g, ' ').trim();
}

function narrationSegments(props) {
  const p = props || {};
  const segs = [];
  // Optionally address the recipient first (e.g. "Hi Mr. Smith, Hiring Manager.").
  const rcpt = String(p.recipientName || '').trim();
  const rcptTitle = String(p.recipientTitle || '').trim();
  if (rcpt) segs.push({ kind: 'greeting', text: `Hi ${speakable(rcpt)}${rcptTitle ? ', ' + speakable(rcptTitle) : ''}.` });
  // Candidate introduces themselves (no title — the focus is name + story).
  if (p.name) segs.push({ kind: 'intro', text: `${rcpt ? '' : 'Hello. '}My name is ${speakable(p.name)}.` });
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
