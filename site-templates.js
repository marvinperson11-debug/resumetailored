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
      sec('creds', 150, color('#ffffff'), [
        el('c1h', 'subheading', 80, 56, 300, 34, { text: '$40M', color: '#6366F1' }),
        el('c1p', 'paragraph', 80, 98, 300, 50, { text: 'Annual P&L ownership' }),
        el('c2h', 'subheading', 450, 56, 300, 34, { text: '120+', color: '#6366F1' }),
        el('c2p', 'paragraph', 450, 98, 300, 50, { text: 'People led across 4 countries' }),
        el('c3h', 'subheading', 820, 56, 300, 34, { text: '3 exits', color: '#6366F1' }),
        el('c3p', 'paragraph', 820, 98, 300, 50, { text: 'Series B through acquisition' }),
      ]),
      sec('exp', 560, color('#f8fafc'), [
        el('exph', 'subheading', 80, 54, 500, 40, { text: 'Experience' }),
        el('resume', 'resume', 80, 110, 1040, 420),
      ]),
      sec('contact', 370, grad(INK_DARK), [
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
        sec('contact', 440, color('#ffffff'), [
          el('ch', 'subheading', 80, 56, 420, 40, { text: 'Start a project' }),
          el('form', 'form', 80, 116, 520, 290, { mode: 'contact' }),
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
      sec('work', 500, color('#050816'), [
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
      sec('statement', 280, grad('linear-gradient(135deg,#8B5CF6,#ec4899)'), [
        el('q', 'heading', 120, 90, 960, 180, { text: '"Design that whispers gets ignored."', color: '#ffffff', size: 52, align: 'center' }),
      ]),
      sec('contact', 450, color('#050816'), [
        el('ch', 'subheading', 80, 60, 460, 40, { text: 'Work with me', color: '#ffffff' }),
        el('form', 'form', 80, 120, 520, 290, { mode: 'contact' }),
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
      sec('services', 400, color('#ffffff'), [
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
      sec('proof', 260, grad(INK_DARK), [
        el('ph', 'subheading', 80, 54, 520, 40, { text: 'Selected results', color: '#ffffff' }),
        el('cs', 'casestudies', 80, 116, 1040, 120, {
          items: [
            { title: 'Rebuilt the planning cycle', metric: '2x', detail: 'Doubled on-time delivery within two quarters by replacing ad-hoc planning with a single operating cadence.' },
            { title: 'Cut onboarding ramp', metric: '45%', detail: 'New hires productive in 6 weeks instead of 11 after redesigning the onboarding path.' },
          ],
        }),
      ]),
      sec('contact', 440, color('#ffffff'), [
        el('ch', 'subheading', 80, 56, 460, 40, { text: 'Get in touch' }),
        el('form', 'form', 80, 116, 520, 290, { mode: 'contact' }),
        el('qrl', 'paragraph', 700, 116, 300, 40, { text: 'Scan to open this page:' }),
        el('qr', 'qr', 700, 164, 160, 160),
        el('soc', 'social', 700, 348, 300, 44, { items: [{ network: 'LinkedIn', url: 'https://linkedin.com' }] }),
      ]),
    ],
  }],
};

/* ── 5. MINIMAL — Professional CV ───────────────────────────────────────────
   All whitespace and typography. One page, centred, nothing to distract. */
const MINIMAL = {
  v: 2, lang: 'en',
  theme: { primary: '0f172a', accent: '6366F1', ink: '0f172a', paper: 'ffffff', muted: '6b7280' },
  pages: [{
    id: 'home', name: 'Home', slug: 'home', isHome: true,
    seo: { title: 'Jordan Ellis — Résumé', description: 'A quiet, readable professional profile.' },
    sections: [
      sec('hero', 470, color('#ffffff'), [
        el('nav', 'nav', 400, 40, 400, 40, { align: 'center' }),
        el('name', 'heading', 200, 150, 800, 90, { text: 'Jordan Ellis', size: 56, align: 'center' }),
        el('role', 'subheading', 250, 254, 700, 34, { text: 'Marketing Manager · Toronto', align: 'center', color: '#6b7280' }),
        el('rule', 'divider', 520, 316, 160, 2, { color: '6366F1', thickness: 2 }),
        el('intro', 'paragraph', 280, 348, 640, 70, { text: 'Ten years turning research into campaigns that move numbers. Currently looking for a team that measures what it ships.', align: 'center' }),
      ]),
      sec('resume', 560, color('#ffffff'), [
        el('h', 'subheading', 80, 40, 500, 34, { text: 'Experience' }),
        el('r', 'resume', 80, 96, 1040, 420),
      ]),
      sec('contact', 470, color('#f8fafc'), [
        el('h', 'subheading', 400, 56, 400, 34, { text: 'Get in touch', align: 'center' }),
        el('p', 'paragraph', 350, 100, 500, 44, { text: 'The fastest way to reach me is a short note.', align: 'center' }),
        el('form', 'form', 340, 154, 520, 290, { mode: 'contact' }),
      ]),
    ],
  }],
};

/* ── 6. DEVELOPER — Tech ────────────────────────────────────────────────────
   Dark, project-first, with a stack strip and links out to code. */
const DEVELOPER = {
  v: 2, lang: 'en',
  theme: { primary: '22d3ee', accent: '6366F1', ink: 'e2e8f0', paper: '0b1020', muted: '94a3b8' },
  pages: [{
    id: 'home', name: 'Home', slug: 'home', isHome: true,
    seo: { title: 'Sam Okafor — Software Engineer', description: 'Backend and platform engineering. Selected projects and stack.' },
    sections: [
      sec('hero', 550, grad('linear-gradient(135deg,#0b1020,#0f172a 55%,#1e1b4b)'), [
        el('nav', 'nav', 80, 34, 800, 40),
        el('kicker', 'paragraph', 80, 150, 400, 30, { text: '$ whoami', color: '#22d3ee' }),
        el('h', 'heading', 80, 190, 760, 120, { text: 'Sam Okafor', color: '#ffffff', size: 58 }),
        el('role', 'subheading', 80, 318, 640, 60, { text: 'Senior Backend Engineer — distributed systems, Go & Postgres', color: '#a5b4fc' }),
        el('p', 'paragraph', 80, 386, 560, 60, { text: 'I make services that stay up on the worst day of the quarter.', color: '#cbd5e1' }),
        el('cta', 'button', 80, 468, 200, 50, { text: 'See projects', anchor: 'projects' }),
        el('cta2', 'button', 300, 468, 180, 50, { text: 'GitHub', href: 'https://github.com', style: 'ghost' }),
      ]),
      sec('stack', 190, color('#0f172a'), [
        el('h', 'subheading', 80, 42, 300, 30, { text: 'Stack', color: '#ffffff' }),
        el('s1', 'paragraph', 80, 84, 320, 60, { text: 'Go · Python · TypeScript', color: '#94a3b8' }),
        el('s2', 'paragraph', 440, 84, 320, 60, { text: 'Postgres · Redis · Kafka', color: '#94a3b8' }),
        el('s3', 'paragraph', 800, 84, 320, 60, { text: 'AWS · Terraform · Kubernetes', color: '#94a3b8' }),
      ]),
      sec('projects', 390, color('#0b1020'), [
        el('h', 'subheading', 80, 46, 500, 34, { text: 'Selected projects', color: '#ffffff' }),
        el('gal', 'gallery', 80, 104, 1040, 250, {
          layout: 'grid', cols: 3, gap: 18,
          items: [
            { ph: { from: '22d3ee', to: '6366F1', h: 200 }, title: 'shardwright', caption: 'Postgres sharding proxy · 1.2k stars', link: 'https://github.com' },
            { ph: { from: '6366F1', to: '8B5CF6', h: 200 }, title: 'queuelite', caption: 'Zero-dependency job queue in Go', link: 'https://github.com' },
            { ph: { from: '8B5CF6', to: '22d3ee', h: 200 }, title: 'obsidian-metrics', caption: 'OpenTelemetry exporter', link: 'https://github.com' },
          ],
        }),
      ]),
      sec('experience', 540, color('#0f172a'), [
        el('h', 'subheading', 80, 46, 500, 34, { text: 'Experience', color: '#ffffff' }),
        el('r', 'resume', 80, 104, 1040, 420),
      ]),
      sec('contact', 380, grad('linear-gradient(135deg,#0f172a,#1e1b4b)'), [
        el('h', 'subheading', 80, 54, 460, 34, { text: 'Hiring?', color: '#ffffff' }),
        el('p', 'paragraph', 80, 100, 460, 60, { text: 'Open to senior and staff roles, remote or hybrid in Lagos / London.', color: '#cbd5e1' }),
        el('soc', 'social', 80, 178, 320, 44, { items: [{ network: 'GitHub', url: 'https://github.com' }, { network: 'LinkedIn', url: 'https://linkedin.com' }] }),
        el('form', 'form', 620, 54, 500, 290, { mode: 'contact', heading: 'Send a message' }),
      ]),
    ],
  }],
};

/* ── 7. STUDIO — Portfolio ──────────────────────────────────────────────────
   Photography / visual work. Full-bleed hero, dedicated gallery page. */
const STUDIO = {
  v: 2, lang: 'en',
  theme: { primary: '0f172a', accent: 'b45309', ink: '111827', paper: 'fdfcfb', muted: '78716c' },
  pages: [
    {
      id: 'home', name: 'Studio', slug: 'home', isHome: true,
      seo: { title: 'Rowan Studio — Photography', description: 'Portrait and editorial photography.' },
      sections: [
        sec('hero', 620, grad('linear-gradient(160deg,#292524,#78716c 60%,#b45309)'), [
          el('nav', 'nav', 80, 36, 900, 40),
          el('h', 'heading', 80, 300, 820, 130, { text: 'Rowan Studio', color: '#ffffff', size: 66 }),
          el('p', 'paragraph', 80, 448, 560, 60, { text: 'Portrait and editorial photography — Chicago and anywhere with a flight.', color: '#f5f5f4' }),
          el('cta', 'button', 80, 528, 210, 50, { text: 'View the work', page: 'gallery' }),
        ]),
        sec('feature', 520, color('#fdfcfb'), [
          el('h', 'subheading', 80, 56, 460, 34, { text: 'Recent frames' }),
          el('gal', 'gallery', 80, 112, 1040, 360, {
            layout: 'grid', cols: 3, gap: 14,
            items: [
              { ph: { from: '292524', to: 'b45309', h: 320 }, title: 'Marta', caption: 'Editorial' },
              { ph: { from: '78716c', to: 'fbbf24', h: 320 }, title: 'Harbour', caption: 'Travel' },
              { ph: { from: 'b45309', to: '292524', h: 320 }, title: 'Studio 4', caption: 'Portrait' },
            ],
          }),
        ]),
        sec('about', 400, color('#f5f5f4'), [
          el('h', 'subheading', 80, 56, 420, 34, { text: 'About the studio' }),
          el('p', 'paragraph', 80, 106, 520, 200, { text: 'Ten years photographing people who do not enjoy being photographed. Natural light where possible, patience always.\n\nClients include magazines, universities and a lot of very good restaurants.' }),
          el('img', 'imagebox', 660, 56, 460, 290, { ph: { from: '292524', to: '78716c', label: 'The studio' }, caption: 'West Loop, Chicago' }),
        ]),
        sec('contact', 430, color('#fdfcfb'), [
          el('h', 'subheading', 80, 50, 420, 34, { text: 'Book a shoot' }),
          el('form', 'form', 80, 104, 520, 290, { mode: 'contact' }),
          el('soc', 'social', 700, 104, 300, 44, { items: [{ network: 'Instagram', url: 'https://instagram.com' }, { network: 'Email', url: 'mailto:you@example.com' }] }),
        ]),
      ],
    },
    {
      id: 'gallery', name: 'Gallery', slug: 'gallery',
      seo: { title: 'Gallery — Rowan Studio' },
      sections: [
        sec('g', 860, color('#fdfcfb'), [
          el('nav', 'nav', 80, 40, 900, 40),
          el('h', 'heading', 80, 118, 700, 80, { text: 'Gallery', size: 46 }),
          el('gal', 'gallery', 80, 220, 1040, 600, {
            layout: 'masonry', cols: 3, gap: 14,
            items: [
              { ph: { from: '292524', to: 'b45309', h: 300 }, title: 'Marta' },
              { ph: { from: 'b45309', to: 'fbbf24', h: 220 }, title: 'Harbour' },
              { ph: { from: '78716c', to: '292524', h: 260 }, title: 'Studio 4' },
              { ph: { from: 'fbbf24', to: '78716c', h: 240 }, title: 'Kitchen' },
              { ph: { from: '292524', to: '78716c', h: 300 }, title: 'Rooftop' },
              { ph: { from: 'b45309', to: '292524', h: 230 }, title: 'Backstage' },
            ],
          }),
        ]),
      ],
    },
  ],
};

/* ── 8. COACH — Business ────────────────────────────────────────────────────
   Personal brand for coaches and advisors: promise, proof, booking. */
const COACH = {
  v: 2, lang: 'en',
  theme: { primary: '0d9488', accent: '6366F1', ink: '0f172a', paper: 'ffffff', muted: '64748b' },
  pages: [{
    id: 'home', name: 'Home', slug: 'home', isHome: true,
    seo: { title: 'Priya Raman — Career Coach', description: 'Coaching for people changing careers on purpose.' },
    sections: [
      sec('hero', 480, grad('linear-gradient(135deg,#ecfeff,#eef2ff)'), [
        el('nav', 'nav', 80, 36, 820, 40),
        el('h', 'heading', 80, 138, 620, 140, { text: 'Change careers on purpose.', size: 52 }),
        el('p', 'paragraph', 80, 296, 540, 80, { text: 'I coach mid-career professionals through the move they have been putting off — with a plan, not a pep talk.' }),
        el('cta', 'button', 80, 400, 240, 52, { text: 'Book a free intro', anchor: 'book' }),
        el('img', 'imagebox', 780, 110, 340, 320, { ph: { from: '0d9488', to: '6366F1', label: 'Your photo' }, radius: 20 }),
      ]),
      sec('how', 380, color('#ffffff'), [
        el('h', 'subheading', 80, 46, 520, 34, { text: 'How it works' }),
        el('b1', 'box', 80, 106, 320, 250, { bg: 'f0fdfa', radius: 16 }),
        el('n1', 'subheading', 108, 136, 260, 30, { text: '1 · Map', color: '#0d9488' }),
        el('p1', 'paragraph', 108, 178, 264, 150, { text: 'One long session to name what you actually want and what is in the way.' }),
        el('b2', 'box', 440, 106, 320, 250, { bg: 'f0fdfa', radius: 16 }),
        el('n2', 'subheading', 468, 136, 260, 30, { text: '2 · Move', color: '#0d9488' }),
        el('p2', 'paragraph', 468, 178, 264, 150, { text: 'Six weeks of positioning, outreach and interview reps, with homework between.' }),
        el('b3', 'box', 800, 106, 320, 250, { bg: 'f0fdfa', radius: 16 }),
        el('n3', 'subheading', 828, 136, 260, 30, { text: '3 · Land', color: '#0d9488' }),
        el('p3', 'paragraph', 828, 178, 264, 150, { text: 'Offer strategy and negotiation, then a plan for the first ninety days.' }),
      ]),
      sec('proof', 260, color('#f8fafc'), [
        el('h', 'subheading', 80, 46, 520, 34, { text: 'What clients say' }),
        el('cs', 'casestudies', 80, 104, 1040, 120, {
          items: [
            { title: 'From ops manager to product manager in 4 months', metric: '+22% pay', detail: '"I had been circling this move for two years. Priya made it a project with dates on it."' },
            { title: 'Back to work after a two-year break', metric: '3 offers', detail: '"The hardest part was believing the gap was survivable. It was — once I had a way to talk about it."' },
          ],
        }),
      ]),
      sec('book', 490, color('#ffffff'), [
        el('h', 'subheading', 80, 50, 460, 34, { text: 'Book an intro call' }),
        el('p', 'paragraph', 80, 96, 460, 60, { text: 'Twenty minutes, free, no pitch. Tell me where you are stuck.' }),
        el('form', 'form', 80, 168, 520, 290, { mode: 'contact', heading: 'Request a time' }),
        el('audio', 'audio', 700, 96, 420, 150, { label: 'A 30-second hello' }),
        el('soc', 'social', 700, 270, 300, 44, { items: [{ network: 'LinkedIn', url: 'https://linkedin.com' }] }),
      ]),
    ],
  }],
};

/* ── 9. ACADEMIC — Professional CV ──────────────────────────────────────────
   Restrained and dense: research statement, publications, teaching. */
const ACADEMIC = {
  v: 2, lang: 'en',
  theme: { primary: '1e3a8a', accent: '7c3aed', ink: '111827', paper: 'ffffff', muted: '4b5563' },
  pages: [
    {
      id: 'home', name: 'Home', slug: 'home', isHome: true,
      seo: { title: 'Dr. Lena Hoffmann', description: 'Research, publications and teaching.' },
      sections: [
        sec('hero', 430, color('#f8fafc'), [
          el('nav', 'nav', 80, 36, 900, 40),
          el('h', 'heading', 80, 128, 760, 90, { text: 'Dr. Lena Hoffmann', size: 46 }),
          el('role', 'subheading', 80, 232, 700, 60, { text: 'Postdoctoral Researcher, Computational Linguistics · TU Berlin', color: '#4b5563' }),
          el('p', 'paragraph', 80, 316, 700, 90, { text: 'I study how low-resource languages behave under transfer learning, and what that tells us about what models actually learn.' }),
        ]),
        sec('research', 330, color('#ffffff'), [
          el('h', 'subheading', 80, 46, 520, 34, { text: 'Research interests' }),
          el('p', 'paragraph', 80, 96, 500, 200, { text: 'Low-resource NLP\nMorphologically rich languages\nEvaluation beyond benchmarks\nInterpretability of multilingual models' }),
          el('h2', 'subheading', 640, 46, 480, 34, { text: 'Currently' }),
          el('p2', 'paragraph', 640, 96, 480, 200, { text: 'Leading a two-year DFG-funded project on morphological generalisation, supervising three MSc students, and reviewing for ACL and EMNLP.' }),
        ]),
        sec('cv', 540, color('#f8fafc'), [
          el('h', 'subheading', 80, 44, 500, 34, { text: 'Curriculum vitae' }),
          el('r', 'resume', 80, 98, 1040, 420),
        ]),
        sec('contact', 380, color('#ffffff'), [
          el('h', 'subheading', 80, 46, 460, 34, { text: 'Contact' }),
          el('p', 'paragraph', 80, 94, 460, 60, { text: 'Office 4.12, Institute for Language Science. Open to collaborations and PhD enquiries.' }),
          el('form', 'form', 640, 46, 480, 290, { mode: 'contact' }),
          el('soc', 'social', 80, 176, 300, 44, { items: [{ network: 'Scholar', url: 'https://scholar.google.com' }, { network: 'ORCID', url: 'https://orcid.org' }] }),
        ]),
      ],
    },
    {
      id: 'pubs', name: 'Publications', slug: 'publications',
      seo: { title: 'Publications — Dr. Lena Hoffmann' },
      sections: [
        sec('p', 480, color('#ffffff'), [
          el('nav', 'nav', 80, 38, 900, 40),
          el('h', 'heading', 80, 116, 700, 80, { text: 'Publications', size: 44 }),
          el('note', 'paragraph', 80, 206, 700, 40, { text: 'Selected; full list on Google Scholar.' }),
          el('cs', 'casestudies', 80, 262, 1040, 180, {
            items: [
              { title: 'Morphological generalisation in multilingual encoders', metric: 'ACL 2026', detail: 'Hoffmann, L., & Bauer, K. Proceedings of ACL 2026. Shows that transfer gains on agglutinative languages are largely explained by subword overlap rather than syntactic transfer.' },
              { title: 'Beyond accuracy: evaluation for low-resource NLP', metric: 'EMNLP 2025', detail: 'Hoffmann, L. Findings of EMNLP 2025. Proposes an evaluation protocol that separates data scarcity from genuine model limitations.' },
              { title: 'A treebank for Low Saxon', metric: 'LREC 2024', detail: 'Hoffmann, L., Meyer, J., & Ali, S. Release of a 12k-sentence dependency treebank and baseline parsers.' },
            ],
          }),
        ]),
      ],
    },
  ],
};

/* ── 10. SHOWREEL — Creative ────────────────────────────────────────────────
   Video-forward: reel at the top, clips below, audio intro. */
const SHOWREEL = {
  v: 2, lang: 'en',
  theme: { primary: 'f43f5e', accent: 'f59e0b', ink: 'f8fafc', paper: '09090b', muted: 'a1a1aa' },
  pages: [{
    id: 'home', name: 'Home', slug: 'home', isHome: true,
    seo: { title: 'Casey Lin — Reel', description: 'Director and editor. Reel, selected clips and contact.' },
    sections: [
      sec('hero', 700, grad('linear-gradient(135deg,#09090b,#3b0764 70%,#881337)'), [
        el('nav', 'nav', 80, 34, 900, 40),
        el('h', 'heading', 80, 116, 760, 100, { text: 'Casey Lin', color: '#ffffff', size: 54 }),
        el('role', 'subheading', 80, 224, 620, 34, { text: 'Director & editor — commercial, music, documentary', color: '#fda4af' }),
        el('reel', 'video', 80, 292, 1040, 360, { label: '2026 reel' }),
      ]),
      sec('clips', 500, color('#09090b'), [
        el('h', 'subheading', 80, 46, 500, 34, { text: 'Selected clips', color: '#ffffff' }),
        el('gal', 'gallery', 80, 106, 1040, 380, {
          layout: 'slider', gap: 18,
          items: [
            { ph: { from: 'f43f5e', to: 'f59e0b', h: 300 }, title: 'Everywhere At Once', caption: 'Music video · 3:41' },
            { ph: { from: 'f59e0b', to: '8B5CF6', h: 300 }, title: 'Nine Kitchens', caption: 'Documentary short · 11:02' },
            { ph: { from: '8B5CF6', to: 'f43f5e', h: 300 }, title: 'Cold Open', caption: 'Commercial · 0:60' },
          ],
        }),
      ]),
      sec('about', 350, color('#18181b'), [
        el('h', 'subheading', 80, 46, 460, 34, { text: 'About', color: '#ffffff' }),
        el('p', 'paragraph', 80, 96, 500, 180, { text: 'I cut my own work, which means the edit starts on the shot list. Ten years across commercial and documentary, most of it handheld.' }),
        el('aud', 'audio', 640, 96, 480, 150, { label: 'Voice intro (30s)' }),
        el('cta', 'button', 640, 270, 220, 50, { text: 'Download résumé', anchor: 'contact' }),
      ]),
      sec('contact', 430, color('#09090b'), [
        el('h', 'subheading', 80, 50, 460, 34, { text: 'Bookings', color: '#ffffff' }),
        el('form', 'form', 80, 106, 520, 290, { mode: 'contact' }),
        el('soc', 'social', 700, 106, 320, 44, { items: [{ network: 'Vimeo', url: 'https://vimeo.com' }, { network: 'Instagram', url: 'https://instagram.com' }] }),
        el('qr', 'qr', 700, 180, 150, 150),
      ]),
    ],
  }],
};

/* ── 11. FREELANCE — Business ───────────────────────────────────────────────
   Services with plain pricing, one testimonial, a project-brief form. */
const FREELANCE = {
  v: 2, lang: 'en',
  theme: { primary: '4f46e5', accent: 'f59e0b', ink: '111827', paper: 'ffffff', muted: '6b7280' },
  pages: [{
    id: 'home', name: 'Home', slug: 'home', isHome: true,
    seo: { title: 'Available for freelance work', description: 'Services, rates and how to start a project.' },
    sections: [
      sec('hero', 460, color('#ffffff'), [
        el('nav', 'nav', 80, 36, 820, 40),
        el('badge', 'paragraph', 80, 122, 300, 30, { text: '● Available from October', color: '#4f46e5' }),
        el('h', 'heading', 80, 160, 700, 120, { text: 'Freelance web development', size: 48 }),
        el('p', 'paragraph', 80, 296, 560, 60, { text: 'I build and ship small, fast websites for people who need one that works — not a six-month project.' }),
        el('cta', 'button', 80, 376, 230, 50, { text: 'Start a project', anchor: 'brief' }),
      ]),
      sec('services', 410, color('#f9fafb'), [
        el('h', 'subheading', 80, 44, 520, 34, { text: 'What I do, and what it costs' }),
        el('b1', 'box', 80, 106, 320, 280, { bg: 'ffffff', radius: 16 }),
        el('t1', 'subheading', 108, 138, 264, 30, { text: 'Landing page' }),
        el('r1', 'subheading', 108, 176, 264, 30, { text: 'from $1,500', color: '#4f46e5' }),
        el('d1', 'paragraph', 108, 216, 264, 150, { text: 'One page, copy polish, analytics and a form that actually delivers. Two weeks.' }),
        el('b2', 'box', 440, 106, 320, 280, { bg: 'ffffff', radius: 16 }),
        el('t2', 'subheading', 468, 138, 264, 30, { text: 'Marketing site' }),
        el('r2', 'subheading', 468, 176, 264, 30, { text: 'from $4,500', color: '#4f46e5' }),
        el('d2', 'paragraph', 468, 216, 264, 150, { text: 'Five to eight pages, a CMS your team can use, and SEO set up properly. Four to six weeks.' }),
        el('b3', 'box', 800, 106, 320, 280, { bg: 'ffffff', radius: 16 }),
        el('t3', 'subheading', 828, 138, 264, 30, { text: 'Ongoing' }),
        el('r3', 'subheading', 828, 176, 264, 30, { text: '$900 / month', color: '#4f46e5' }),
        el('d3', 'paragraph', 828, 216, 264, 150, { text: 'A standing day a month for changes, fixes and the things that keep slipping.' }),
      ]),
      sec('work', 380, color('#ffffff'), [
        el('h', 'subheading', 80, 46, 500, 34, { text: 'Recent work' }),
        el('gal', 'gallery', 80, 104, 1040, 240, {
          layout: 'grid', cols: 3, gap: 16,
          items: [
            { ph: { from: '4f46e5', to: '8B5CF6', h: 190 }, title: 'Bellwether Coffee', caption: 'Marketing site' },
            { ph: { from: 'f59e0b', to: '4f46e5', h: 190 }, title: 'Harlow Dental', caption: 'Landing page + booking' },
            { ph: { from: '8B5CF6', to: 'f59e0b', h: 190 }, title: 'Foundry Books', caption: 'Shop rebuild' },
          ],
        }),
      ]),
      sec('brief', 500, color('#f9fafb'), [
        el('h', 'subheading', 80, 48, 500, 34, { text: 'Tell me about the project' }),
        el('p', 'paragraph', 80, 94, 500, 80, { text: 'What it is, roughly when you need it, and any budget you have in mind. I reply within a day.' }),
        el('form', 'form', 80, 186, 520, 290, { mode: 'contact', heading: 'Project brief' }),
        el('quote', 'paragraph', 660, 94, 460, 160, { text: '"Quoted on Monday, live the following Thursday. I have never had a website project go like that."\n\n— Dana Whitfield, Bellwether Coffee' }),
        el('soc', 'social', 660, 280, 300, 44, { items: [{ network: 'LinkedIn', url: 'https://linkedin.com' }, { network: 'Email', url: 'mailto:you@example.com' }] }),
      ]),
    ],
  }],
};

/* ── 12. GRADUATE — Professional CV ─────────────────────────────────────────
   Early-career: education and projects lead, experience follows. */
const GRADUATE = {
  v: 2, lang: 'en',
  theme: { primary: '2563eb', accent: '06b6d4', ink: '0f172a', paper: 'ffffff', muted: '64748b' },
  pages: [{
    id: 'home', name: 'Home', slug: 'home', isHome: true,
    seo: { title: 'Maya Chen — Graduate Portfolio', description: 'Recent graduate seeking a first role in data analysis.' },
    sections: [
      sec('hero', 500, grad('linear-gradient(135deg,#eff6ff,#ecfeff)'), [
        el('nav', 'nav', 80, 36, 820, 40),
        el('h', 'heading', 80, 140, 660, 120, { text: 'Maya Chen', size: 54 }),
        el('role', 'subheading', 80, 272, 620, 34, { text: 'BSc Statistics, 2026 · Looking for a first data role', color: '#2563eb' }),
        el('p', 'paragraph', 80, 322, 540, 70, { text: 'Three internships, two published class projects, and a genuine enthusiasm for cleaning other people’s spreadsheets.' }),
        el('cta', 'button', 80, 412, 210, 50, { text: 'See my projects', anchor: 'projects' }),
        el('photo', 'image', 820, 130, 280, 280, { ph: { from: '2563eb', to: '06b6d4', shape: 'circle', label: 'Your photo' } }),
      ]),
      sec('projects', 320, color('#ffffff'), [
        el('h', 'subheading', 80, 46, 500, 34, { text: 'Projects' }),
        el('cs', 'casestudies', 80, 104, 1040, 180, {
          items: [
            { title: 'Predicting bus delays from open transit data', metric: 'R² 0.71', detail: 'Built a gradient-boosted model on two years of city GTFS feeds; wrote it up as a dashboard the transit society still uses.' },
            { title: 'Survey analysis for the student union', metric: '3,200 responses', detail: 'Cleaned and analysed the annual satisfaction survey, then presented findings to the executive committee.' },
            { title: 'Course project: A/B test simulator', metric: 'Top of cohort', detail: 'An R package that teaches sample-size intuition by simulating underpowered tests.' },
          ],
        }),
      ]),
      sec('skills', 220, color('#f8fafc'), [
        el('h', 'subheading', 80, 44, 300, 30, { text: 'Skills' }),
        el('s1', 'paragraph', 80, 90, 320, 80, { text: 'Python · pandas · scikit-learn' }),
        el('s2', 'paragraph', 440, 90, 320, 80, { text: 'SQL · dbt · BigQuery' }),
        el('s3', 'paragraph', 800, 90, 320, 80, { text: 'R · Tableau · Excel' }),
      ]),
      sec('cv', 540, color('#ffffff'), [
        el('h', 'subheading', 80, 44, 500, 34, { text: 'Education & experience' }),
        el('r', 'resume', 80, 98, 1040, 420),
      ]),
      sec('contact', 390, grad('linear-gradient(135deg,#eff6ff,#ecfeff)'), [
        el('h', 'subheading', 80, 50, 460, 34, { text: 'Get in touch' }),
        el('p', 'paragraph', 80, 96, 460, 60, { text: 'Graduating in June and available from July. Happy to do a take-home.' }),
        el('form', 'form', 620, 50, 500, 290, { mode: 'contact' }),
        el('soc', 'social', 80, 176, 300, 44, { items: [{ network: 'LinkedIn', url: 'https://linkedin.com' }, { network: 'GitHub', url: 'https://github.com' }] }),
      ]),
    ],
  }],
};

/**
 * Element ids must be unique across the WHOLE document, not just the page: the
 * editor's `findElement` searches the document and keeps the LAST match, and
 * the renderer derives per-element mobile CSS class names from the id. Two
 * elements sharing an id meant selecting one and editing the other.
 *
 * Templates are authored with short, readable local ids, so namespace them here
 * by page + section index. Section ids are deliberately left alone: they are the
 * anchor targets that in-page CTAs (`props.anchor`) link to.
 */
function namespaceIds(doc) {
  (doc.pages || []).forEach((pg, pi) => {
    (pg.sections || []).forEach((s, si) => {
      (s.els || []).forEach((e) => { e.id = `${pi}${si}-${e.id}`; });
    });
  });
  return doc;
}

const SITE_TEMPLATES = [
  { id: 'executive', name: 'Executive', category: 'Professional CV', blurb: 'Dark hero, credential strip and a full experience section. For senior and leadership profiles.', swatch: ['030712', '6366F1'], doc: EXECUTIVE },
  { id: 'minimal', name: 'Minimal', category: 'Professional CV', blurb: 'Centred type, one rule, a lot of white space. Lets the résumé do the talking.', swatch: ['ffffff', '0f172a'], doc: MINIMAL },
  { id: 'graduate', name: 'Graduate', category: 'Professional CV', blurb: 'Projects and education first, experience after. Built for a first or second role.', swatch: ['eff6ff', '2563eb'], doc: GRADUATE },
  { id: 'academic', name: 'Academic', category: 'Professional CV', blurb: 'Research statement, CV and a dedicated publications page. Restrained on purpose.', swatch: ['f8fafc', '1e3a8a'], doc: ACADEMIC },
  { id: 'grid-portfolio', name: 'Grid Portfolio', category: 'Portfolio', blurb: 'Masonry work grid with an about page. Built to show projects first.', swatch: ['ffffff', '8B5CF6'], doc: GRID_PORTFOLIO },
  { id: 'studio', name: 'Studio', category: 'Portfolio', blurb: 'Full-bleed hero and a separate gallery page. For photography and visual work.', swatch: ['292524', 'b45309'], doc: STUDIO },
  { id: 'bold', name: 'Bold', category: 'Creative', blurb: 'Oversized type over colour blocks, slider showcase and a statement band.', swatch: ['3b0764', 'ec4899'], doc: BOLD },
  { id: 'showreel', name: 'Showreel', category: 'Creative', blurb: 'Your reel at the top, clips in a slider, voice intro below. For film and motion.', swatch: ['09090b', 'f43f5e'], doc: SHOWREEL },
  { id: 'developer', name: 'Developer', category: 'Tech', blurb: 'Dark, project-first, with a stack strip and links straight out to your code.', swatch: ['0b1020', '22d3ee'], doc: DEVELOPER },
  { id: 'consultant', name: 'Consultant', category: 'Business', blurb: 'Services, proof and a contact section with your QR code. For independents.', swatch: ['eef2ff', '6366F1'], doc: CONSULTANT },
  { id: 'coach', name: 'Coach', category: 'Business', blurb: 'A clear promise, a three-step method, client results and a booking form.', swatch: ['ecfeff', '0d9488'], doc: COACH },
  { id: 'freelance', name: 'Freelance', category: 'Business', blurb: 'Services with plain pricing, recent work and a project-brief form.', swatch: ['ffffff', '4f46e5'], doc: FREELANCE },
].map((t) => Object.assign(t, { doc: namespaceIds(t.doc) }));

// Catalogue entries for the gallery (no document payload — kept small).
function templateList() {
  return SITE_TEMPLATES.map(({ id, name, category, blurb, swatch }) => ({ id, name, category, blurb, swatch }));
}
/* EVERY BOX IN A TEMPLATE IS ITS OWN ELEMENT.

   Templates draw their showcase rows with a `gallery`, which is one element
   holding many pictures. On the page that looks like three boxes; in the
   document it is one, so a user could not select the middle one, could not put
   a video in it, and could not give the first its own background. They saw
   three boxes and the editor disagreed.

   The template DATA keeps the gallery, because a row of cells is a much more
   readable way to write one. It is split into independent elements here, on the
   way to becoming somebody's site — so the definitions stay short and what the
   user gets is editable box by box.

   Existing sites are not touched by this. The same split is available to them
   as an action in the editor. */
const { splitAll } = require('./public/site-doc-store.js');

function templateDoc(id) {
  const t = SITE_TEMPLATES.find((x) => x.id === id);
  if (!t) return null;
  const doc = JSON.parse(JSON.stringify(t.doc));
  try { splitAll(doc); } catch (_) { /* a template that cannot split still opens */ }
  return doc;
}

module.exports = { SITE_TEMPLATES, templateList, templateDoc };
