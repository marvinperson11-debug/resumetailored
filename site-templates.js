/**
 * Website Builder v2 — starter templates.
 *
 * Each template is a complete site document (the same shape the renderer and the
 * editor use): pages → sections → absolutely-positioned elements on a 1200px
 * design canvas. Templates ship with sample copy and self-contained gradient
 * placeholder art (`ph`), so there are no binary assets to host and every image
 * slot is one click from a real upload.
 *
 * Palette is ResumeTailored's: indigo #6366F1 → violet #8B5CF6 on ink #030712.
 *
 * Mobile needs no per-template work: the renderer emits elements in reading
 * order (sorted by y, then x) and stacks them full-width below 820px.
 */

const BRAND = { primary: '6366F1', accent: '8B5CF6', ink: '0f172a', paper: 'ffffff', muted: '64748b' };
const INK_DARK = 'linear-gradient(135deg,#030712,#1e1b4b)';

// Small helpers keep the template data readable.
const el = (id, type, x, y, w, h, props, extra) => Object.assign({ id, type, x, y, w, h, props: props || {} }, extra || {});
const sec = (id, h, bg, els) => ({ id, h, bg, els });
const grad = (v) => ({ type: 'gradient', value: v });
const color = (v) => ({ type: 'color', value: v });

/* ── 1. EXECUTIVE — Professional CV ─────────────────────────────────────────
   Dark full-bleed hero with headshot, credential strip, experience, contact. */
const EXECUTIVE = {
  v: 2, lang: 'en', theme: BRAND,
  pages: [{
    id: 'home', name: 'Home', slug: 'home', isHome: true,
    seo: { title: 'Executive Profile', description: 'Senior leadership profile and track record.' },
    sections: [
      sec('hero', 560, grad(INK_DARK), [
        el('nav', 'nav', 80, 34, 800, 40),
        el('name', 'heading', 80, 168, 640, 120, { text: 'Alex Morgan', color: '#ffffff', size: 60 }),
        el('role', 'subheading', 80, 300, 560, 40, { text: 'VP of Operations · 15 years scaling teams', color: '#a5b4fc' }),
        el('intro', 'paragraph', 80, 356, 520, 80, { text: 'I build operating systems for companies in their fastest-growing years — turning ambiguity into repeatable process.', color: '#cbd5e1' }),
        el('cta', 'button', 80, 458, 210, 52, { text: 'Get in touch', anchor: 'contact' }),
        el('photo', 'image', 810, 150, 310, 310, { ph: { from: '6366F1', to: '8B5CF6', shape: 'circle', label: 'Your headshot' } }),
      ]),
      sec('creds', 210, color('#ffffff'), [
        el('c1h', 'subheading', 80, 56, 300, 34, { text: '$40M', color: '#6366F1' }),
        el('c1p', 'paragraph', 80, 98, 300, 50, { text: 'Annual P&L ownership' }),
        el('c2h', 'subheading', 450, 56, 300, 34, { text: '120+', color: '#6366F1' }),
        el('c2p', 'paragraph', 450, 98, 300, 50, { text: 'People led across 4 countries' }),
        el('c3h', 'subheading', 820, 56, 300, 34, { text: '3 exits', color: '#6366F1' }),
        el('c3p', 'paragraph', 820, 98, 300, 50, { text: 'Series B through acquisition' }),
      ]),
      sec('exp', 640, color('#f8fafc'), [
        el('exph', 'subheading', 80, 54, 500, 40, { text: 'Experience' }),
        el('resume', 'resume', 80, 110, 1040, 480),
      ]),
      sec('contact', 440, grad(INK_DARK), [
        el('ch', 'subheading', 80, 60, 520, 40, { text: "Let's talk", color: '#ffffff' }),
        el('cp', 'paragraph', 80, 112, 460, 70, { text: 'Open to operating and advisory roles. Send a note and I will reply personally.', color: '#cbd5e1' }),
        el('social', 'social', 80, 210, 300, 44, { items: [{ network: 'LinkedIn', url: 'https://linkedin.com' }, { network: 'Email', url: 'mailto:you@example.com' }] }),
        el('form', 'form', 620, 60, 500, 300, { mode: 'contact', heading: 'Send a message' }),
      ]),
    ],
  }],
};

/* ── 2. GRID PORTFOLIO — Portfolio ──────────────────────────────────────────
   Typographic hero, masonry work grid, about, contact. */
const GRID_PORTFOLIO = {
  v: 2, lang: 'en', theme: BRAND,
  pages: [
    {
      id: 'home', name: 'Work', slug: 'home', isHome: true,
      seo: { title: 'Selected Work', description: 'A portfolio of selected projects.' },
      sections: [
        sec('hero', 400, color('#ffffff'), [
          el('nav', 'nav', 80, 40, 900, 40),
          el('h', 'heading', 80, 140, 820, 120, { text: 'Selected work, 2019 — today', size: 56 }),
          el('p', 'paragraph', 80, 280, 620, 60, { text: 'Product design and art direction for teams that care about craft.' }),
        ]),
        sec('work', 700, color('#ffffff'), [
          el('gal', 'gallery', 80, 20, 1040, 620, {
            layout: 'masonry', cols: 3, gap: 18,
            items: [
              { ph: { from: '6366F1', to: '8B5CF6', h: 260 }, title: 'Northwind', caption: 'Brand system' },
              { ph: { from: '8B5CF6', to: 'ec4899', h: 200 }, title: 'Atlas', caption: 'Mobile app' },
              { ph: { from: '0ea5e9', to: '6366F1', h: 300 }, title: 'Kestrel', caption: 'Design system' },
              { ph: { from: '8B5CF6', to: '6366F1', h: 220 }, title: 'Field Notes', caption: 'Editorial' },
              { ph: { from: 'ec4899', to: '8B5CF6', h: 280 }, title: 'Halo', caption: 'Campaign' },
              { ph: { from: '6366F1', to: '0ea5e9', h: 210 }, title: 'Beacon', caption: 'Web platform' },
            ],
          }),
        ]),
        sec('about', 420, color('#f8fafc'), [
          el('ah', 'subheading', 80, 60, 420, 40, { text: 'About' }),
          el('ap', 'paragraph', 80, 116, 480, 200, { text: 'I work with founders and product teams from first sketch to shipped interface. Previously in-house at two venture-backed startups; now independent.\n\nCurrently booking projects for next quarter.' }),
          el('aimg', 'imagebox', 660, 60, 460, 300, { ph: { from: '1e1b4b', to: '6366F1', label: 'Studio photo' }, caption: 'The studio, Brooklyn' }),
        ]),
        sec('contact', 360, color('#ffffff'), [
          el('ch', 'subheading', 80, 56, 420, 40, { text: 'Start a project' }),
          el('form', 'form', 80, 116, 520, 200, { mode: 'contact' }),
          el('soc', 'social', 660, 116, 300, 44, { items: [{ network: 'Instagram', url: 'https://instagram.com' }, { network: 'LinkedIn', url: 'https://linkedin.com' }] }),
        ]),
      ],
    },
    {
      id: 'about', name: 'About', slug: 'about',
      seo: { title: 'About' },
      sections: [
        sec('a1', 560, color('#ffffff'), [
          el('nav', 'nav', 80, 40, 900, 40),
          el('h', 'heading', 80, 140, 700, 90, { text: 'About me', size: 48 }),
          el('r', 'resume', 80, 250, 1040, 260),
        ]),
      ],
    },
  ],
};

/* ── 3. BOLD — Creative ─────────────────────────────────────────────────────
   Oversized type over colour blocks, slider showcase, statement band. */
const BOLD = {
  v: 2, lang: 'en',
  theme: { primary: '8B5CF6', accent: 'ec4899', ink: '0f172a', paper: '050816', muted: '94a3b8' },
  pages: [{
    id: 'home', name: 'Home', slug: 'home', isHome: true,
    seo: { title: 'Creative Portfolio' },
    sections: [
      sec('hero', 660, grad('linear-gradient(135deg,#050816,#3b0764,#831843)'), [
        el('nav', 'nav', 80, 36, 900, 40),
        el('block', 'box', 60, 150, 520, 320, { bg: '8B5CF6', radius: 24 }, { z: 1 }),
        el('h', 'heading', 100, 190, 900, 240, { text: 'MAKE IT LOUD.', color: '#ffffff', size: 96 }, { z: 2 }),
        el('p', 'paragraph', 100, 452, 520, 80, { text: 'Art direction, motion, and identity work for brands that refuse to blend in.', color: '#e9d5ff' }, { z: 2 }),
        el('cta', 'button', 100, 552, 230, 54, { text: 'See the work', anchor: 'work' }, { z: 2 }),
      ]),
      sec('work', 560, color('#050816'), [
        el('wh', 'subheading', 80, 54, 500, 40, { text: 'Recent projects', color: '#ffffff' }),
        el('gal', 'gallery', 80, 118, 1040, 380, {
          layout: 'slider', gap: 20,
          items: [
            { ph: { from: '8B5CF6', to: 'ec4899', h: 320 }, title: 'Neon Nights', caption: 'Campaign film' },
            { ph: { from: 'ec4899', to: 'f59e0b', h: 320 }, title: 'Supercut', caption: 'Motion identity' },
            { ph: { from: '6366F1', to: '8B5CF6', h: 320 }, title: 'Afterglow', caption: 'Album art' },
          ],
        }),
      ]),
      sec('statement', 360, grad('linear-gradient(135deg,#8B5CF6,#ec4899)'), [
        el('q', 'heading', 120, 90, 960, 180, { text: '"Design that whispers gets ignored."', color: '#ffffff', size: 52, align: 'center' }),
      ]),
      sec('contact', 420, color('#050816'), [
        el('ch', 'subheading', 80, 60, 460, 40, { text: 'Work with me', color: '#ffffff' }),
        el('form', 'form', 80, 120, 520, 240, { mode: 'contact' }),
        el('soc', 'social', 700, 120, 320, 44, { items: [{ network: 'Instagram', url: 'https://instagram.com' }, { network: 'Behance', url: 'https://behance.net' }] }),
      ]),
    ],
  }],
};

/* ── 4. CONSULTANT — Business ───────────────────────────────────────────────
   Services 3-up, proof via case studies, contact with QR. */
const CONSULTANT = {
  v: 2, lang: 'en', theme: BRAND,
  pages: [{
    id: 'home', name: 'Home', slug: 'home', isHome: true,
    seo: { title: 'Independent Consultant', description: 'Advisory and hands-on delivery for growing teams.' },
    sections: [
      sec('hero', 500, grad('linear-gradient(135deg,#eef2ff,#faf5ff)'), [
        el('nav', 'nav', 80, 36, 820, 40),
        el('h', 'heading', 80, 140, 640, 130, { text: 'Clarity, then momentum.', size: 52 }),
        el('p', 'paragraph', 80, 288, 540, 80, { text: 'I help founders turn a messy quarter into a plan the whole team can run — then help them run it.' }),
        el('cta', 'button', 80, 392, 250, 52, { text: 'Book a call', anchor: 'contact' }),
        el('img', 'imagebox', 780, 120, 340, 300, { ph: { from: '6366F1', to: '8B5CF6', label: 'Your photo' }, radius: 18 }),
      ]),
      sec('services', 460, color('#ffffff'), [
        el('sh', 'subheading', 80, 50, 520, 40, { text: 'How I help' }),
        el('s1b', 'box', 80, 116, 320, 260, { bg: 'f8fafc', radius: 16 }),
        el('s1h', 'subheading', 108, 148, 264, 34, { text: 'Operating cadence' }),
        el('s1p', 'paragraph', 108, 194, 264, 150, { text: 'Planning, metrics and rituals that survive contact with a real week.' }),
        el('s2b', 'box', 440, 116, 320, 260, { bg: 'f8fafc', radius: 16 }),
        el('s2h', 'subheading', 468, 148, 264, 34, { text: 'Go-to-market' }),
        el('s2p', 'paragraph', 468, 194, 264, 150, { text: 'Positioning and pipeline design, from first message to repeatable motion.' }),
        el('s3b', 'box', 800, 116, 320, 260, { bg: 'f8fafc', radius: 16 }),
        el('s3h', 'subheading', 828, 148, 264, 34, { text: 'Team design' }),
        el('s3p', 'paragraph', 828, 194, 264, 150, { text: 'Org structure, hiring plans and onboarding that scales past the founders.' }),
      ]),
      sec('proof', 460, grad(INK_DARK), [
        el('ph', 'subheading', 80, 54, 520, 40, { text: 'Selected results', color: '#ffffff' }),
        el('cs', 'casestudies', 80, 116, 1040, 300, {
          items: [
            { title: 'Rebuilt the planning cycle', metric: '2x', detail: 'Doubled on-time delivery within two quarters by replacing ad-hoc planning with a single operating cadence.' },
            { title: 'Cut onboarding ramp', metric: '45%', detail: 'New hires productive in 6 weeks instead of 11 after redesigning the onboarding path.' },
          ],
        }),
      ]),
      sec('contact', 460, color('#ffffff'), [
        el('ch', 'subheading', 80, 56, 460, 40, { text: 'Get in touch' }),
        el('form', 'form', 80, 116, 520, 260, { mode: 'contact' }),
        el('qrl', 'paragraph', 700, 116, 300, 40, { text: 'Scan to open this page:' }),
        el('qr', 'qr', 700, 164, 160, 160),
        el('soc', 'social', 700, 348, 300, 44, { items: [{ network: 'LinkedIn', url: 'https://linkedin.com' }] }),
      ]),
    ],
  }],
};

const SITE_TEMPLATES = [
  { id: 'executive', name: 'Executive', category: 'Professional CV', blurb: 'Dark hero, credential strip and a full experience section. For senior and leadership profiles.', swatch: ['030712', '6366F1'], doc: EXECUTIVE },
  { id: 'grid-portfolio', name: 'Grid Portfolio', category: 'Portfolio', blurb: 'Masonry work grid with an about page. Built to show projects first.', swatch: ['ffffff', '8B5CF6'], doc: GRID_PORTFOLIO },
  { id: 'bold', name: 'Bold', category: 'Creative', blurb: 'Oversized type over colour blocks, slider showcase and a statement band.', swatch: ['3b0764', 'ec4899'], doc: BOLD },
  { id: 'consultant', name: 'Consultant', category: 'Business', blurb: 'Services, proof and a contact section with your QR code. For independents.', swatch: ['eef2ff', '6366F1'], doc: CONSULTANT },
];

// Catalogue entries for the gallery (no document payload — kept small).
function templateList() {
  return SITE_TEMPLATES.map(({ id, name, category, blurb, swatch }) => ({ id, name, category, blurb, swatch }));
}
function templateDoc(id) {
  const t = SITE_TEMPLATES.find((x) => x.id === id);
  return t ? JSON.parse(JSON.stringify(t.doc)) : null;
}

module.exports = { SITE_TEMPLATES, templateList, templateDoc };
