/* related-tools.js — one shared "Related Tools" cross-link block for every tool
 * landing page on the site. Include it once per page:
 *     <script src="/related-tools.js" defer></script>
 * It renders a full, crawlable set of descriptive links to every other tool
 * landing page (omitting the page it is on), so each tool page cross-links to
 * all the others with a single edit. Framework-free to match the static site.
 *
 * Drop a <div id="relatedTools"></div> where you want it; otherwise it is
 * appended just before the page's <footer>, or at the end of <main>. */
(function () {
  'use strict';

  // Canonical inventory of tool landing pages. `href` is the clean served URL.
  var TOOLS = [
    { href: '/ai-resume-tailor',            icon: '✨', label: 'AI Resume Tailor',          desc: 'Rewrite your resume for any job description with Claude AI.' },
    { href: '/ai-cover-letter-generator',   icon: '✉️', label: 'AI Cover Letter Generator', desc: 'Generate a tailored cover letter in seconds — free.' },
    { href: '/ats-score-checker',           icon: '📈', label: 'ATS Score Checker',        desc: 'Score your resume against the job and beat the bots.' },
    { href: '/resume-analyzer',             icon: '🔍', label: 'Readability Review',       desc: 'Check word count, action verbs and readability instantly.' },
    { href: '/tools/ats-keyword-extractor', icon: '🔑', label: 'ATS Keyword Extractor',    desc: 'Pull the exact keywords a job posting is scanning for.' },
    { href: '/linkedin-optimizer',          icon: '💼', label: 'LinkedIn Profile Optimizer', desc: 'Sharpen your headline, About and experience bullets.' },
    { href: '/job-tracker',                 icon: '📋', label: 'Job Application Tracker',  desc: 'Track every application on a Kanban board with reminders.' },
    { href: '/share-resume-link',           icon: '🔗', label: 'Share Resume as a Link',   desc: 'Turn any resume into a private web link — no attachment.' },
    { href: '/resume-examples',             icon: '📄', label: 'Resume Examples',          desc: '70+ role-by-role resume examples across every industry.' },
    { href: '/cover-letter-examples',       icon: '📝', label: 'Cover Letter Examples',    desc: '70+ cover letter examples with role-specific openings.' },
    { href: '/tools/salary-negotiation',    icon: '💰', label: 'Salary Negotiation Script', desc: 'Get a data-backed counter-offer script for your role.' },
    { href: '/tools/resume-ab-tracker',     icon: '🧪', label: 'Resume A/B Test Tracker',  desc: 'Test resume versions and see which one gets replies.' },
    { href: '/tools/offer-comparison',      icon: '⚖️', label: 'Offer Comparison Calculator', desc: 'Compare offers on total comp, remote and commute.' },
    { href: '/tools/job-description-decoder', icon: '🧩', label: 'Job Description Decoder', desc: 'Translate a posting into red flags and hidden requirements.' },
    { href: '/tools/weekly-report',         icon: '📅', label: 'Weekly Job Search Report', desc: 'A weekly email digest of your job-search progress.' },
    { href: '/tools/follow-up-generator',   icon: '⏰', label: 'Follow-Up Email Generator',      desc: 'Write the perfect post-application follow-up email.' },
    { href: '/tools/mock-interview',        icon: '🎤', label: 'AI Mock Interview',        desc: 'Practice real interview questions and get feedback.' },
    { href: '/dashboard',                   icon: '🔎', label: 'Job Finder',               desc: 'Search live job postings tailored to your profession.' },
    { href: '/tools/autoapply',             icon: '⚡', label: 'Auto-Applyer',                   desc: 'Auto-fill applications on LinkedIn, Greenhouse & Lever.' }
  ];

  function norm(p) {
    p = (p || '/').replace(/\/+$/, '') || '/';
    return p.replace(/\.html$/, '');
  }

  function build() {
    if (document.querySelector('.rt-related')) return; // already injected
    var here = norm(location.pathname);
    var items = TOOLS.filter(function (t) { return norm(t.href) !== here; });
    if (!items.length) return;

    var style = document.createElement('style');
    style.textContent =
      '.rt-related{max-width:1100px;margin:48px auto;padding:28px 20px 8px;border-top:1px solid rgba(128,128,128,.22);font-family:Inter,-apple-system,Segoe UI,Arial,sans-serif;}' +
      '.rt-related-h{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:1.2px;color:#2E7D53;margin:0 0 16px;}' +
      '.rt-related-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;}' +
      '.rt-related-card{display:flex;gap:10px;align-items:flex-start;padding:13px 15px;border:1px solid rgba(128,128,128,.24);border-radius:12px;background:rgba(128,128,128,.05);text-decoration:none;color:inherit;transition:border-color .15s ease,transform .15s ease;}' +
      '.rt-related-card:hover{border-color:#2E7D53;transform:translateY(-2px);}' +
      '.rt-related-ic{font-size:20px;line-height:1.2;flex:none;}' +
      '.rt-related-tx b{display:block;font-size:14px;font-weight:700;margin-bottom:2px;}' +
      '.rt-related-tx span{display:block;font-size:12.5px;line-height:1.45;opacity:.72;}';
    document.head.appendChild(style);

    var sec = document.createElement('section');
    sec.className = 'rt-related';
    sec.setAttribute('aria-label', 'Related tools');
    var html = '<h2 class="rt-related-h">Related tools &amp; more free tools</h2><div class="rt-related-grid">';
    items.forEach(function (t) {
      html += '<a class="rt-related-card" href="' + t.href + '">' +
        '<span class="rt-related-ic" aria-hidden="true">' + t.icon + '</span>' +
        '<span class="rt-related-tx"><b>' + t.label + '</b><span>' + t.desc + '</span></span></a>';
    });
    html += '</div>';
    sec.innerHTML = html;

    var mount = document.getElementById('relatedTools');
    if (mount) { mount.appendChild(sec); return; }
    var footer = document.querySelector('footer');
    if (footer && footer.parentNode) { footer.parentNode.insertBefore(sec, footer); return; }
    var main = document.querySelector('main');
    if (main) { main.appendChild(sec); return; }
    document.body.appendChild(sec);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
