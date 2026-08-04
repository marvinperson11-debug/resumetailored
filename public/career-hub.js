/* career-hub.js — Career Hub frontend (Dashboard, Skills Lab, Interview Prep,
 * Gap Analyzer, Job Finder, Scenario Lab, profession picker).
 *
 * Self-contained: injects its own sidebar buttons + panels into app.html and
 * wraps showTab() so each tool initializes on open. Reuses the app's auth token
 * (rt_token), showToast, startPro and isSubscriberFlag when present. Cream +
 * forest-green design system; all motion respects prefers-reduced-motion. */
(function () {
  'use strict';

  var TOOLS = [
    { id: 'career',      icon: '🧭', label: 'Career Dashboard' },
    { id: 'skillslab',   icon: '🧪', label: 'Skills Lab' },
    { id: 'interview',   icon: '🎤', label: 'Interview Prep' },
    { id: 'gap',         icon: '📊', label: 'Skills Gap' },
    { id: 'jobfinder',   icon: '🔎', label: 'Job Finder' },
    { id: 'scenariolab', icon: '🧩', label: 'Scenario Lab' }
  ];
  var TOOL_IDS = TOOLS.map(function (t) { return t.id; });

  var professionsData = null, profile = null, profileLoaded = false;
  var pickerOnSet = null;

  // ── small helpers ──────────────────────────────────────────────────────────
  function tok() { return localStorage.getItem('rt_token') || ''; }
  function authH() { return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok() }; }
  function isPro() { try { return !!isSubscriberFlag; } catch (e) { return false; } }
  function toast(m, ms) { if (typeof showToast === 'function') return showToast(m, ms); }
  function goPro() { if (typeof startPro === 'function') startPro(); }
  function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
  // i18n: route user-facing strings through the app's translator when present,
  // falling back to the English literal. Missing keys degrade to the fallback,
  // so a Chinese pass is purely additive (add ch_* keys to APP_I18N.zh) with no
  // rewrite here. See CAREER_HUB_PLAN follow-ups.
  function t(k, fb) { try { return (typeof _t === 'function') ? _t(k, fb) : fb; } catch (e) { return fb; } }
  // Analytics: fire a GA event through the site's existing gtag if present.
  function ga(event, params) { try { if (typeof gtag === 'function') gtag('event', event, params || {}); } catch (e) {} }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function el(id) { return document.getElementById(id); }
  function spin() { return '<div style="text-align:center;padding:40px;"><span class="ch-spinner"></span></div>'; }
  async function api(url, opts) {
    var r = await fetch(url, opts || { headers: authH() });
    var data = null; try { data = await r.json(); } catch (e) {}
    return { ok: r.ok, status: r.status, data: data || {} };
  }
  // Show the right message for a 402/quota response; returns true if handled.
  function handleGate(res) {
    if (res.status === 402) {
      var m = res.data.message || 'This is a Pro feature.';
      toast(m, 5000);
      return true;
    }
    if (res.status === 401) { toast('Please sign in to use the Career Hub.'); return true; }
    return false;
  }

  // ── one-time DOM injection ───────────────────────────────────────────────────
  function inject() {
    // Sidebar buttons — prepend into the existing "Career Hub" section.
    var careerLabel = Array.prototype.find.call(
      document.querySelectorAll('.sidebar-label'),
      function (n) { return /career hub/i.test(n.textContent); });
    if (careerLabel && !el('tab-career')) {
      var anchor = careerLabel.nextSibling;
      TOOLS.forEach(function (t) {
        var b = document.createElement('button');
        b.className = 'sidebar-btn';
        b.id = 'tab-' + t.id;
        b.setAttribute('data-label', t.label);
        b.onclick = function () { showTab(t.id); };
        var proBadge = (t.id === 'career' || t.id === 'skillslab' || t.id === 'interview' || t.id === 'jobfinder' || t.id === 'scenariolab' || t.id === 'gap')
          ? '<span class="ch-pill ch-pill-free" style="margin-left:auto;">FREE</span>' : '';
        b.innerHTML = '<span class="sidebar-icon">' + t.icon + '</span> <span style="flex:1;text-align:left;">' + t.label + '</span>' + proBadge;
        b.style.display = 'flex'; b.style.alignItems = 'center'; b.style.gap = '6px';
        careerLabel.parentNode.insertBefore(b, anchor);
      });
    }
    // Panels — append into the main content area.
    var main = document.querySelector('.dash-main');
    if (main) {
      TOOL_IDS.forEach(function (id) {
        if (!el('panel-' + id)) {
          var d = document.createElement('div');
          d.className = 'tab-content'; d.id = 'panel-' + id;
          d.innerHTML = '<div class="ch-wrap" id="ch-' + id + '"></div>';
          main.appendChild(d);
        }
      });
    }
    // Profession picker overlay.
    if (!el('chPickerOverlay')) {
      var ov = document.createElement('div');
      ov.className = 'ch-picker-overlay'; ov.id = 'chPickerOverlay';
      ov.innerHTML =
        '<div class="ch-picker" role="dialog" aria-modal="true">' +
        '<div class="ch-picker-grip"></div>' +
        '<div class="ch-picker-head"><h2>What\'s your target profession?</h2>' +
        '<input class="ch-input" id="chPickerSearch" placeholder="Search 60+ professions…" autocomplete="off" /></div>' +
        '<div class="ch-picker-body" id="chPickerBody"></div>' +
        '<div class="ch-picker-foot">' +
        '<select class="ch-select" id="chPickerSeniority" style="flex:1;min-width:130px;">' +
        '<option value="">Seniority (optional)</option><option value="entry-level">Entry Level</option>' +
        '<option value="mid">Mid Level</option><option value="senior">Senior</option><option value="lead">Lead</option></select>' +
        '<button class="ch-btn" id="chPickerSave" disabled>Save</button>' +
        '<button class="ch-btn ch-btn-ghost ch-btn-sm" id="chPickerClose">Cancel</button></div></div>';
      document.body.appendChild(ov);
      ov.addEventListener('click', function (e) { if (e.target === ov) closePicker(); });
      el('chPickerClose').onclick = closePicker;
      el('chPickerSearch').addEventListener('input', renderPickerList);
      el('chPickerSave').onclick = savePicker;
    }
    // Wrap showTab so tools initialize on open.
    if (!window._chWrapped && typeof window.showTab === 'function') {
      var orig = window.showTab;
      window.showTab = function (name) { orig(name); onTab(name); };
      window._chWrapped = true;
    }
  }

  function onTab(name) {
    if (TOOL_IDS.indexOf(name) === -1) return;
    ensureProfile().then(function () {
      // First-run soft gate: any career tool with no profession set.
      if (!profile && name !== 'career') { openPicker(function () { renderTool(name); }); }
      else if (!profile && name === 'career') { renderTool(name); }
      else { renderTool(name); }
    });
  }
  function renderTool(name) {
    if (name === 'career') renderDashboard();
    else if (name === 'skillslab') renderSkillsLab();
    else if (name === 'interview') renderInterview();
    else if (name === 'gap') renderGap();
    else if (name === 'jobfinder') renderJobFinder();
    else if (name === 'scenariolab') renderScenarioLab();
  }

  // ── professions + profile ────────────────────────────────────────────────────
  async function loadProfessions() {
    if (professionsData) return professionsData;
    try { var r = await fetch('/data/professions.json'); professionsData = await r.json(); } catch (e) { professionsData = { categories: [] }; }
    return professionsData;
  }
  async function ensureProfile() {
    if (profileLoaded) return profile;
    var res = await api('/api/profession');
    profile = (res.ok && res.data && res.data.id) ? res.data : null;
    profileLoaded = true;
    return profile;
  }

  function openPicker(onSet) {
    pickerOnSet = onSet || null;
    loadProfessions().then(function () {
      el('chPickerSearch').value = '';
      el('chPickerSeniority').value = profile ? (profile.seniority || '') : '';
      el('chPickerSave').disabled = true; el('chPickerSave').dataset.pid = '';
      renderPickerList();
      el('chPickerOverlay').classList.add('open');
      el('chPickerSearch').focus();
    });
  }
  function closePicker() { el('chPickerOverlay').classList.remove('open'); pickerOnSet = null; }
  function renderPickerList() {
    var q = (el('chPickerSearch').value || '').toLowerCase().trim();
    var body = el('chPickerBody'); var html = '';
    (professionsData.categories || []).forEach(function (cat) {
      var matches = cat.professions.filter(function (p) {
        if (!q) return true;
        return p.label.toLowerCase().indexOf(q) !== -1 ||
          (p.aliases || []).some(function (a) { return a.toLowerCase().indexOf(q) !== -1; }) ||
          cat.label.toLowerCase().indexOf(q) !== -1;
      });
      if (!matches.length) return;
      html += '<div class="ch-picker-cat">' + cat.icon + ' ' + esc(cat.label) + '</div>';
      matches.forEach(function (p) {
        html += '<div class="ch-picker-item" data-pid="' + esc(p.id) + '" data-sen="' + (p.seniority ? '1' : '0') + '">' + esc(p.label) + '</div>';
      });
    });
    body.innerHTML = html || '<div class="ch-empty">No matches.</div>';
    Array.prototype.forEach.call(body.querySelectorAll('.ch-picker-item'), function (item) {
      item.onclick = function () {
        Array.prototype.forEach.call(body.querySelectorAll('.ch-picker-item'), function (x) { x.classList.remove('hi'); });
        item.classList.add('hi');
        var save = el('chPickerSave'); save.disabled = false; save.dataset.pid = item.dataset.pid;
      };
    });
  }
  async function savePicker() {
    var pid = el('chPickerSave').dataset.pid; if (!pid) return;
    var sen = el('chPickerSeniority').value || '';
    el('chPickerSave').disabled = true;
    var res = await api('/api/profession', { method: 'POST', headers: authH(), body: JSON.stringify({ professionId: pid, seniority: sen }) });
    if (res.ok) {
      profile = res.data; profileLoaded = true;
      toast('Target profession set: ' + res.data.displayLabel);
      vibrate(20);
      closePicker();
      var cb = pickerOnSet; pickerOnSet = null; if (cb) cb();
    } else { el('chPickerSave').disabled = false; toast(res.data.message || 'Could not save.'); }
  }

  function profHeader() {
    if (!profile) return '';
    return '<div class="ch-prof-header"><span class="ch-prof-icon">🎯</span>' +
      '<div><div class="ch-prof-name">' + esc(profile.displayLabel) + '</div>' +
      '<div class="ch-prof-sub">' + esc(profile.categoryLabel) + ' · everything below is tailored to this role</div></div>' +
      '<button class="ch-prof-edit" onclick="CareerHub.changeProfession()">Change</button></div>';
  }
  function needProfileCard(box) {
    box.innerHTML = '<div class="ch-card ch-empty"><h3>Set your target profession</h3>' +
      '<p class="ch-note">Pick your profession once and every Career Hub tool tailors itself to it.</p>' +
      '<button class="ch-btn" style="margin-top:12px;" onclick="CareerHub.changeProfession()">Choose profession →</button></div>';
  }

  // ── Dashboard ────────────────────────────────────────────────────────────────
  async function renderDashboard() {
    var box = el('ch-career'); box.innerHTML = spin();
    var res = await api('/api/career/dashboard');
    if (!res.ok) { if (!handleGate(res)) box.innerHTML = '<div class="ch-empty">Could not load your dashboard.</div>'; return; }
    var d = res.data;
    profile = d.profession || profile;
    var bands = d.skills.bestBands || {};
    var bandHtml = Object.keys(bands).length
      ? Object.keys(bands).map(function (t) { var b = bands[t]; return '<span class="ch-pill ch-pill-' + (b.band || 'bronze') + '" style="margin:2px;">' + (b.band === 'gold' ? '🥇' : b.band === 'silver' ? '🥈' : '🥉') + ' ' + esc(t) + '</span>'; }).join('')
      : '<span class="ch-note">No skills tests yet.</span>';
    var gapHtml = d.gap
      ? '<div class="ch-stat">' + d.gap.matchScore + '%</div><div class="ch-stat-lbl">Last match</div>' +
        (d.gap.topGaps || []).map(function (g) { return '<div style="font-size:13px;margin-top:6px;">🔸 ' + esc(g.requirement) + '</div>'; }).join('')
      : '<span class="ch-note">No gap analysis yet.</span>';
    var steps = (d.nextSteps || []).map(function (s) {
      return '<li style="margin-bottom:8px;"><a style="color:var(--ch-forest);font-weight:700;cursor:pointer;text-decoration:none;" onclick="CareerHub.go(\'' + s.tab + '\')">' + esc(s.text) + ' →</a></li>';
    }).join('');
    box.innerHTML =
      (profile ? profHeader() : '') +
      '<div class="ch-grid cols-4" style="margin-bottom:16px;">' +
      '<div class="ch-card"><div class="ch-stat">' + d.resume.count + '</div><div class="ch-stat-lbl">Resumes</div></div>' +
      '<div class="ch-card"><div class="ch-stat">' + d.skills.attempts + '</div><div class="ch-stat-lbl">Skills tests</div></div>' +
      '<div class="ch-card"><div class="ch-stat">' + d.interview.practiced + '</div><div class="ch-stat-lbl">Interview Qs</div></div>' +
      '<div class="ch-card"><div class="ch-stat">' + d.jobs.saved + '</div><div class="ch-stat-lbl">Saved jobs</div></div>' +
      '</div>' +
      '<div class="ch-grid cols-2" style="margin-bottom:16px;">' +
      '<div class="ch-card"><h3>Skills badges</h3>' + bandHtml + '</div>' +
      '<div class="ch-card"><h3>Top skills gaps</h3>' + gapHtml + '</div>' +
      '</div>' +
      '<div class="ch-card"><h3>Recommended next steps</h3><ol style="margin:8px 0 0;padding-left:20px;">' + (steps || '<li class="ch-note">You\'re all caught up! 🎉</li>') + '</ol>' +
      (d.isSubscriber ? '<div id="chCoach" style="margin-top:14px;"><button class="ch-btn ch-btn-ghost ch-btn-sm" onclick="CareerHub.coach()">✨ AI coach summary</button></div>'
        : '<div class="ch-upsell" style="margin-top:14px;">Unlock the AI coach summary, Gold badges, technical interview prep and unlimited analyses with Pro.<br><button class="ch-btn ch-btn-sm" onclick="CareerHub.pro()">Upgrade — $19.99/mo</button></div>') +
      '</div>';
  }
  async function coach() {
    var c = el('chCoach'); if (c) c.innerHTML = spin();
    var res = await api('/api/career/coach');
    if (!res.ok) { if (!handleGate(res) && c) c.innerHTML = '<span class="ch-note">Coach unavailable right now.</span>'; return; }
    if (c) c.innerHTML = '<div class="ch-card" style="background:var(--ch-cream);">✨ ' + esc(res.data.summary || '') + '</div>';
  }

  // ── Skills Lab ───────────────────────────────────────────────────────────────
  var quizState = null;
  function renderSkillsLab() {
    var box = el('ch-skillslab'); if (!profile) return needProfileCard(box);
    box.innerHTML = profHeader() +
      '<div class="ch-card"><h3>' + esc(profile.label) + ' Skills Test</h3>' +
      '<p class="ch-note">10 questions, tailored to your role. Score 60%+ for a badge you can share.</p>' +
      '<div class="ch-field" style="margin-top:12px;"><label class="ch-label">Topic (optional)</label>' +
      '<input class="ch-input" id="chQuizTopic" placeholder="e.g. Patient Safety, System Design — leave blank for core skills" /></div>' +
      '<button class="ch-btn" id="chQuizStart" onclick="CareerHub.startQuiz()">Start quiz →</button>' +
      (isPro() ? '' : '<div class="ch-note" style="margin-top:10px;">Free: 1 quiz + 1 retake per day · Bronze/Silver badges. <a style="color:var(--ch-forest);cursor:pointer;" onclick="CareerHub.pro()">Go Gold with Pro →</a></div>') +
      '</div><div id="chQuizArea"></div>';
  }
  async function startQuiz() {
    var topic = (el('chQuizTopic') && el('chQuizTopic').value || '').trim();
    ga('quiz_start', { profession: profile && profile.id, topic: topic || 'general' });
    var btn = el('chQuizStart'); if (btn) { btn.disabled = true; }
    el('chQuizArea').innerHTML = spin();
    var res = await api('/api/skills-lab/quiz', { method: 'POST', headers: authH(), body: JSON.stringify({ topic: topic }) });
    if (btn) btn.disabled = false;
    if (!res.ok) { if (!handleGate(res)) el('chQuizArea').innerHTML = '<div class="ch-empty">' + esc(res.data.message || 'Could not start.') + '</div>'; return; }
    quizState = { key: res.data.quizKey, topic: res.data.topic, quiz: res.data.quiz, answers: [], orders: res.data.quiz.questions.map(function (q) { return q.order; }) };
    var q = res.data.quiz;
    var html = '<h3 style="margin:18px 0 12px;">' + esc(q.title) + '</h3>';
    q.questions.forEach(function (qq, qi) {
      html += '<div class="ch-q" data-qi="' + qi + '"><div class="ch-q-prompt">' + (qi + 1) + '. ' + esc(qq.prompt) + '</div>';
      qq.options.forEach(function (opt, oi) {
        html += '<label class="ch-opt"><input type="radio" name="q' + qi + '" value="' + oi + '" onchange="CareerHub.pickAnswer(' + qi + ',' + oi + ',this)">' + esc(opt) + '</label>';
      });
      html += '</div>';
    });
    html += '<button class="ch-btn" onclick="CareerHub.submitQuiz()">Submit answers →</button>';
    el('chQuizArea').innerHTML = html;
  }
  function pickAnswer(qi, oi, input) {
    quizState.answers[qi] = oi;
    var q = input.closest('.ch-q');
    Array.prototype.forEach.call(q.querySelectorAll('.ch-opt'), function (l) { l.classList.remove('sel'); });
    input.closest('.ch-opt').classList.add('sel');
  }
  async function submitQuiz() {
    if (!quizState) return;
    var res = await api('/api/skills-lab/submit', { method: 'POST', headers: authH(),
      body: JSON.stringify({ quizKey: quizState.key, topic: quizState.topic, answers: quizState.answers, orders: quizState.orders }) });
    if (!res.ok) { if (!handleGate(res)) toast('Could not score your quiz.'); return; }
    var d = res.data; vibrate(d.band ? [30, 40, 30] : 20);
    ga('quiz_complete', { profession: profile && profile.id, score: d.score, band: d.band || 'none' });
    var bandTxt = d.band ? '<span class="ch-pill ch-pill-' + d.band + '">' + (d.band === 'gold' ? '🥇 Gold' : d.band === 'silver' ? '🥈 Silver' : '🥉 Bronze') + '</span>' : '<span class="ch-note">No badge — aim for 60%+</span>';
    // mark options
    quizState.quiz.questions.forEach(function (qq, qi) {
      var r = d.results[qi]; var qEl = el('chQuizArea').querySelector('.ch-q[data-qi="' + qi + '"]'); if (!qEl) return;
      var opts = qEl.querySelectorAll('.ch-opt');
      if (opts[r.correctDisplay]) opts[r.correctDisplay].classList.add('correct');
      if (!r.isCorrect && r.chosenDisplay != null && opts[r.chosenDisplay]) opts[r.chosenDisplay].classList.add('wrong');
      var ex = document.createElement('div'); ex.className = 'ch-explain'; ex.textContent = '✔ ' + r.explanation; qEl.appendChild(ex);
    });
    var head = '<div class="ch-card" style="margin:18px 0;"><div class="ch-stat">' + d.score + '%</div><div class="ch-stat-lbl">' + d.correct + ' / ' + d.total + ' correct · ' + bandTxt + '</div>';
    if (d.badge) head += '<div style="margin-top:10px;"><a class="ch-btn ch-btn-sm" href="' + d.badge.url + '" target="_blank" rel="noopener" onclick="CareerHub.badgeShared()">' + t('ch_view_badge', 'View & share badge') + ' →</a></div>';
    if (d.goldLocked) head += '<div class="ch-upsell" style="margin-top:10px;">You scored Gold! Upgrade to Pro to unlock the Gold badge. <button class="ch-btn ch-btn-sm" onclick="CareerHub.pro()">Upgrade</button></div>';
    head += '<div style="margin-top:10px;"><button class="ch-btn ch-btn-ghost ch-btn-sm" onclick="CareerHub.startQuiz()">Retake</button></div></div>';
    var area = el('chQuizArea'); area.insertAdjacentHTML('afterbegin', head);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── Interview Prep ───────────────────────────────────────────────────────────
  var ivState = null;
  function renderInterview() {
    var box = el('ch-interview'); if (!profile) return needProfileCard(box);
    box.innerHTML = profHeader() +
      '<div class="ch-card"><h3>Interview Prep — ' + esc(profile.label) + '</h3>' +
      '<div class="ch-row" style="margin:10px 0;">' +
      '<button class="ch-btn ch-btn-sm" onclick="CareerHub.loadIv(\'behavioral\')">Behavioral <span class="ch-pill ch-pill-free">FREE</span></button>' +
      '<button class="ch-btn ch-btn-sm ch-btn-ghost" onclick="CareerHub.loadIv(\'technical\')">Technical <span class="ch-pill ch-pill-pro">PRO</span></button>' +
      '</div><p class="ch-note">Answer in your head (or out loud), then reveal the framework and a model answer.</p></div>' +
      '<div id="chIvArea"></div>';
  }
  async function loadIv(kind) {
    ga('interview_practice_start', { profession: profile && profile.id, kind: kind });
    el('chIvArea').innerHTML = spin();
    var res = await api('/api/interview/questions', { method: 'POST', headers: authH(), body: JSON.stringify({ kind: kind }) });
    if (!res.ok) { if (!handleGate(res)) el('chIvArea').innerHTML = '<div class="ch-empty">' + esc(res.data.message || 'Could not load.') + '</div>'; return; }
    ivState = { kind: res.data.kind, questions: res.data.questions, idx: 0 };
    renderIvCard();
  }
  function renderIvCard() {
    var q = ivState.questions[ivState.idx];
    var html = '<div class="ch-iv-card" id="chIvCard">' +
      '<div class="ch-note">Question ' + (ivState.idx + 1) + ' of ' + ivState.questions.length + '</div>' +
      '<div class="ch-iv-q">' + esc(q.prompt) + '</div>' +
      (isPro()
        ? '<div class="ch-field"><textarea class="ch-textarea" id="chIvAnswer" placeholder="Draft your answer (optional) — then Score it or Reveal the model answer"></textarea>' +
          '<button class="ch-btn ch-btn-sm" onclick="CareerHub.scoreAnswer()">✨ ' + t('ch_score_answer', 'Score my answer') + '</button> <span id="chIvScore"></span></div>'
        : '<div class="ch-upsell">🔒 ' + t('ch_score_locked', 'Upgrade to Pro to get AI feedback on your answers.') + ' <button class="ch-btn ch-btn-sm" onclick="CareerHub.pro()">' + t('ch_upgrade', 'Upgrade') + '</button></div>') +
      '<button class="ch-btn ch-btn-ghost" id="chIvRevealBtn" onclick="CareerHub.reveal()">Reveal framework & model answer</button>' +
      '<div id="chIvReveal"></div>' +
      '<div class="ch-iv-nav"><button class="ch-btn ch-btn-ghost ch-btn-sm" onclick="CareerHub.ivNav(-1)" ' + (ivState.idx === 0 ? 'disabled' : '') + '>← Prev</button>' +
      '<button class="ch-btn ch-btn-sm" onclick="CareerHub.ivNav(1)" ' + (ivState.idx === ivState.questions.length - 1 ? 'disabled' : '') + '>Next →</button></div></div>';
    el('chIvArea').innerHTML = html;
    attachSwipe(el('chIvCard'));
  }
  function reveal() {
    var q = ivState.questions[ivState.idx];
    el('chIvRevealBtn').style.display = 'none';
    el('chIvReveal').innerHTML = '<div class="ch-reveal">' +
      '<h4>Framework</h4><p>' + esc(q.framework) + '</p>' +
      '<h4>Model answer</h4><p>' + esc(q.modelAnswer) + '</p>' +
      (q.watchFor ? '<h4>Watch out for</h4><p>' + esc(q.watchFor) + '</p>' : '') +
      '<h4>How confident are you?</h4><div class="ch-conf" id="chIvConf">' +
      [1, 2, 3, 4, 5].map(function (n) { return '<button onclick="CareerHub.setConf(' + n + ',this)">' + n + '</button>'; }).join('') + '</div></div>';
  }
  async function setConf(n, btn) {
    Array.prototype.forEach.call(btn.parentNode.children, function (b) { b.classList.remove('sel'); });
    btn.classList.add('sel'); vibrate(15);
    var q = ivState.questions[ivState.idx];
    await api('/api/interview/progress', { method: 'POST', headers: authH(), body: JSON.stringify({ questionHash: q.hash, confidence: n }) });
  }
  function ivNav(delta) {
    var n = ivState.idx + delta;
    if (n < 0 || n >= ivState.questions.length) return;
    ivState.idx = n; renderIvCard();
  }
  async function scoreAnswer() {
    var ans = el('chIvAnswer') && el('chIvAnswer').value.trim(); if (!ans) { toast('Write an answer first.'); return; }
    el('chIvScore').innerHTML = '<span class="ch-spinner"></span>';
    var q = ivState.questions[ivState.idx];
    var res = await api('/api/interview/score', { method: 'POST', headers: authH(), body: JSON.stringify({ question: q.prompt, answer: ans }) });
    if (!res.ok) { if (!handleGate(res)) el('chIvScore').textContent = 'Unavailable.'; else el('chIvScore').textContent = ''; return; }
    var d = res.data;
    el('chIvScore').innerHTML = '<div class="ch-reveal" style="margin-top:10px;"><h4>Rating: ' + (d.rating || '-') + '/5</h4>' +
      '<h4>Strengths</h4><p>' + (d.strengths || []).map(esc).join('; ') + '</p>' +
      '<h4>Improve</h4><p>' + (d.improvements || []).map(esc).join('; ') + '</p>' +
      (d.revised ? '<h4>Revised</h4><p>' + esc(d.revised) + '</p>' : '') + '</div>';
  }
  function attachSwipe(node) {
    if (!node) return; var x0 = null;
    node.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    node.addEventListener('touchend', function (e) {
      if (x0 == null) return; var dx = e.changedTouches[0].clientX - x0; x0 = null;
      if (Math.abs(dx) > 60) ivNav(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  // ── Skills Gap Analyzer ──────────────────────────────────────────────────────
  async function renderGap() {
    var box = el('ch-gap'); box.innerHTML = spin();
    var rr = await api('/api/resumes');
    var resumes = (rr.ok && rr.data.resumes) || [];
    var opts = '<option value="">— paste below —</option>' + resumes.map(function (r) { return '<option value="' + r.id + '">' + esc(r.title) + '</option>'; }).join('');
    box.innerHTML = (profile ? profHeader() : '') +
      '<div class="ch-card"><h3>Skills Gap Analyzer</h3><p class="ch-note">Compare your resume to a job and get an actionable checklist.</p>' +
      '<div class="ch-field"><label class="ch-label">Your resume</label><select class="ch-select" id="chGapResume" onchange="CareerHub.gapResumeSel()">' + opts + '</select>' +
      '<textarea class="ch-textarea" id="chGapResumeText" placeholder="…or paste your resume text here" style="margin-top:8px;"></textarea></div>' +
      '<div class="ch-field"><label class="ch-label">Target job description</label><textarea class="ch-textarea" id="chGapJob" placeholder="Paste the job description here"></textarea></div>' +
      '<button class="ch-btn" id="chGapBtn" onclick="CareerHub.runGap()">Analyze gap →</button>' +
      (isPro() ? '' : '<div class="ch-note" style="margin-top:10px;">Free: 1 analysis per week. <a style="color:var(--ch-forest);cursor:pointer;" onclick="CareerHub.pro()">Unlimited with Pro →</a></div>') +
      '</div><div id="chGapArea"></div>';
    // Prefill from a cross-sell hand-off (Job Finder → Analyze this job).
    if (window._chGapPrefill) { el('chGapJob').value = window._chGapPrefill; window._chGapPrefill = null; }
  }
  var _gapResumes = {};
  function gapResumeSel() {
    var sel = el('chGapResume'); var id = sel.value; if (!id) { el('chGapResumeText').style.display = ''; return; }
    // fetched content is embedded via a cache we keep from /api/resumes
    el('chGapResumeText').style.display = 'none';
  }
  async function runGap() {
    var jobText = el('chGapJob').value.trim();
    var resumeId = el('chGapResume').value;
    var resumeText = el('chGapResumeText').value.trim();
    if (!jobText) { toast('Paste a job description.'); return; }
    if (!resumeId && !resumeText) { toast('Select or paste a resume.'); return; }
    ga('gap_analysis_run', { profession: profile && profile.id });
    var btn = el('chGapBtn'); btn.disabled = true; el('chGapArea').innerHTML = spin();
    var body = { jobText: jobText };
    if (resumeId) body.resumeId = parseInt(resumeId, 10); else body.resume = resumeText;
    var res = await api('/api/skills-gap', { method: 'POST', headers: authH(), body: JSON.stringify(body) });
    btn.disabled = false;
    if (!res.ok) { if (!handleGate(res)) el('chGapArea').innerHTML = '<div class="ch-empty">' + esc(res.data.message || 'Could not analyze.') + '</div>'; return; }
    renderGapReport(res.data);
  }
  function renderGapReport(d) {
    var gaps = (d.gaps || []).map(function (g) {
      return '<div class="ch-gap-item ' + g.severity + '"><span class="sev">' + esc(g.severity) + '</span> — <b>' + esc(g.requirement) + '</b>' +
        (g.evidence ? '<div class="ch-note">' + esc(g.evidence) + '</div>' : '') +
        (g.action ? '<div style="font-size:13px;margin-top:4px;">✅ ' + esc(g.action) + '</div>' : '') + '</div>';
    }).join('');
    var study = (d.studyPlan || []).map(function (s) { return '<li>' + esc(s.skill) + ' — ' + esc(s.how) + ' <span class="ch-note">(~' + s.estWeeks + ' wks)</span></li>'; }).join('');
    el('chGapArea').innerHTML =
      '<div class="ch-card" style="margin-top:16px;"><div class="ch-score-ring">' + d.matchScore + '%</div><div class="ch-stat-lbl">Match score</div></div>' +
      '<div class="ch-grid cols-2" style="margin-top:14px;">' +
      '<div class="ch-card"><h3>✅ Strengths</h3><ul>' + (d.strengths || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></div>' +
      '<div class="ch-card"><h3>⚡ Quick wins</h3><ul>' + (d.quickWins || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>' +
      '<a class="ch-btn ch-btn-sm ch-btn-ghost" style="margin-top:8px;" onclick="CareerHub.go(\'tailor\')">Apply in Resume Tailor →</a></div>' +
      '</div>' +
      '<div class="ch-card" style="margin-top:14px;"><h3>🎯 Gaps to close</h3>' + (gaps || '<span class="ch-note">No major gaps found.</span>') + '</div>' +
      '<div class="ch-card" style="margin-top:14px;"><h3>📚 Study plan</h3><ul>' + study + '</ul>' +
      '<a class="ch-btn ch-btn-sm ch-btn-ghost" style="margin-top:8px;" onclick="CareerHub.go(\'skillslab\')">Test these skills →</a></div>';
  }

  // ── Job Finder ───────────────────────────────────────────────────────────────
  function renderJobFinder() {
    var box = el('ch-jobfinder');
    box.innerHTML = (profile ? profHeader() : '') +
      '<div class="ch-card"><h3>Job Finder</h3>' +
      '<div class="ch-grid cols-2"><div class="ch-field"><label class="ch-label">Search</label><input class="ch-input" id="chJobQuery" placeholder="' + esc(profile ? profile.label : 'Job title') + '" /></div>' +
      '<div class="ch-field"><label class="ch-label">Location</label><input class="ch-input" id="chJobLoc" placeholder="City, state or Remote" /></div></div>' +
      '<div class="ch-row"><select class="ch-select" id="chJobRemote" style="flex:1;"><option value="">Any location type</option><option value="remote">Remote only</option></select>' +
      '<select class="ch-select" id="chJobDate" style="flex:1;"><option value="">Any date</option><option value="today">Today</option><option value="3days">Past 3 days</option><option value="week">Past week</option><option value="month">Past month</option></select>' +
      '<select class="ch-select" id="chJobType" style="flex:1;"><option value="">Any type</option><option value="FULLTIME">Full-time</option><option value="PARTTIME">Part-time</option><option value="CONTRACTOR">Contract</option><option value="INTERN">Internship</option></select></div>' +
      '<button class="ch-btn" id="chJobBtn" style="margin-top:12px;" onclick="CareerHub.searchJobs()">Search jobs →</button>' +
      (isPro() ? '' : '<div class="ch-note" style="margin-top:8px;">Free: 5 searches/day · save up to 5 jobs. <a style="color:var(--ch-forest);cursor:pointer;" onclick="CareerHub.pro()">Unlimited with Pro →</a></div>') +
      '</div>' +
      '<div class="ch-row" style="margin-top:10px;"><label style="font-size:13px;display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" id="chJobAlerts" onchange="CareerHub.toggleAlerts(this.checked)"> ' + t('ch_job_alerts', 'Email me a daily digest of new ' + esc(profile ? profile.label : '') + ' jobs') + '</label></div>' +
      '<div class="ch-jobfinder-layout" style="margin-top:16px;"><div id="chJobResults"></div>' +
      '<aside class="ch-crosssell"><h3 style="margin-top:0;">' + t('ch_before_apply', 'Before you apply') + '</h3>' +
      '<a onclick="CareerHub.go(\'skillslab\')">🧪 Take the ' + esc(profile ? profile.label : '') + ' Skills Test</a>' +
      '<a onclick="CareerHub.go(\'gap\')">📊 Analyze a job vs. your resume</a>' +
      '<a onclick="CareerHub.go(\'tailor\')">✦ Tailor your resume</a>' +
      '<div id="chSavedJobs" style="margin-top:12px;"></div></aside></div>' +
      '<div class="ch-sticky-bar"><button class="ch-btn" onclick="CareerHub.searchJobs()">Search</button><button class="ch-btn ch-btn-ghost" onclick="CareerHub.go(\'gap\')">Analyze</button></div>';
    loadSavedJobs();
    loadAlerts();
  }
  async function loadAlerts() {
    var box = el('chJobAlerts'); if (!box) return;
    var res = await api('/api/jobs/alerts');
    if (res.ok) box.checked = !!res.data.enabled;
  }
  async function toggleAlerts(on) {
    var res = await api('/api/jobs/alerts', { method: 'POST', headers: authH(), body: JSON.stringify({ enabled: !!on }) });
    if (res.ok) toast(on ? t('ch_alerts_on', 'Daily job alerts on.') : t('ch_alerts_off', 'Job alerts off.'));
  }
  async function searchJobs() {
    var qs = new URLSearchParams();
    if (el('chJobQuery').value.trim()) qs.set('query', el('chJobQuery').value.trim());
    if (el('chJobLoc').value.trim()) qs.set('location', el('chJobLoc').value.trim());
    if (el('chJobRemote').value) qs.set('remote', el('chJobRemote').value);
    if (el('chJobDate').value) qs.set('datePosted', el('chJobDate').value);
    if (el('chJobType').value) qs.set('jobType', el('chJobType').value);
    el('chJobResults').innerHTML = spin();
    var res = await api('/api/jobs/search?' + qs.toString());
    if (!res.ok) {
      if (handleGate(res)) { el('chJobResults').innerHTML = ''; return; }
      var msg = res.data.error === 'jobs_unconfigured' ? 'Job search is not configured on this server yet.' : (res.data.message || 'Search failed.');
      el('chJobResults').innerHTML = '<div class="ch-empty">' + esc(msg) + '</div>'; return;
    }
    var jobs = res.data.jobs || [];
    if (!jobs.length) { el('chJobResults').innerHTML = '<div class="ch-empty">No jobs found — try a broader search.</div>'; return; }
    el('chJobResults').innerHTML = jobs.map(function (j) {
      return '<div class="ch-job"><div class="ch-job-title">' + esc(j.title) + '</div>' +
        '<div class="ch-job-meta">' + esc(j.company) + (j.location ? ' · ' + esc(j.location) : '') + (j.remote ? ' · 🏠 Remote' : '') + '</div>' +
        '<div class="ch-note">' + esc(j.descriptionSnippet || '') + '…</div>' +
        '<div class="ch-row" style="margin-top:10px;">' +
        (j.url ? '<a class="ch-btn ch-btn-sm" href="' + esc(j.url) + '" target="_blank" rel="noopener">Apply</a>' : '') +
        '<button class="ch-btn ch-btn-sm ch-btn-ghost" onclick=\'CareerHub.saveJob(' + JSON.stringify(j).replace(/'/g, '&#39;') + ')\'>Save</button>' +
        '<button class="ch-btn ch-btn-sm ch-btn-ghost" onclick=\'CareerHub.analyzeJob(' + JSON.stringify(j).replace(/'/g, '&#39;') + ')\'>Analyze</button>' +
        '</div></div>';
    }).join('');
  }
  async function saveJob(job) {
    var res = await api('/api/jobs/save', { method: 'POST', headers: authH(), body: JSON.stringify({ job: job }) });
    if (!res.ok) { handleGate(res); return; }
    ga('job_save', { profession: profile && profile.id });
    toast(t('ch_job_saved', 'Job saved.')); vibrate(15); loadSavedJobs();
  }
  function analyzeJob(job) {
    window._chGapPrefill = [job.title, job.company, job.descriptionSnippet].filter(Boolean).join('\n');
    go('gap');
  }
  async function loadSavedJobs() {
    var box = el('chSavedJobs'); if (!box) return;
    var res = await api('/api/jobs/saved');
    var jobs = (res.ok && res.data.jobs) || [];
    box.innerHTML = '<h3 style="font-size:14px;">Saved (' + jobs.length + ')</h3>' +
      (jobs.length ? jobs.map(function (j) {
        return '<div style="font-size:13px;padding:6px 0;border-bottom:1px solid var(--ch-line);">' + esc(j.title) +
          ' <a style="color:#dc2626;cursor:pointer;float:right;" onclick="CareerHub.unsaveJob(' + j.id + ')">✕</a></div>';
      }).join('') : '<span class="ch-note">None yet.</span>');
  }
  async function unsaveJob(id) { await api('/api/jobs/saved/' + id, { method: 'DELETE', headers: authH() }); loadSavedJobs(); }

  // ── Scenario Lab ─────────────────────────────────────────────────────────────
  var scState = null;
  function renderScenarioLab() {
    var box = el('ch-scenariolab'); if (!profile) return needProfileCard(box);
    var types = { 'customer-service': 'Customer Service', 'technical-debugging': 'Technical Debugging', 'document-errors': 'Spreadsheet/Document Errors', 'team-conflict': 'Team Conflict', 'safety-compliance': 'Safety/Compliance' };
    box.innerHTML = profHeader() +
      '<div class="ch-card"><h3>Scenario Lab</h3><p class="ch-note">Work through a realistic ' + esc(profile.label) + ' problem, one decision at a time.</p>' +
      '<div class="ch-field" style="margin-top:10px;"><label class="ch-label">Scenario type</label><select class="ch-select" id="chScType">' +
      Object.keys(types).map(function (k) { return '<option value="' + k + '">' + esc(types[k]) + '</option>'; }).join('') + '</select></div>' +
      '<button class="ch-btn" id="chScBtn" onclick="CareerHub.startScenario()">Start scenario →</button>' +
      (isPro() ? '' : '<div class="ch-note" style="margin-top:8px;">Free: 1 scenario per week. <a style="color:var(--ch-forest);cursor:pointer;" onclick="CareerHub.pro()">Unlimited with Pro →</a></div>') +
      '</div><div id="chScArea"></div>';
  }
  async function startScenario() {
    var type = el('chScType').value; var btn = el('chScBtn'); btn.disabled = true;
    el('chScArea').innerHTML = spin();
    var res = await api('/api/scenario-lab/scenario', { method: 'POST', headers: authH(), body: JSON.stringify({ scenarioType: type }) });
    btn.disabled = false;
    if (!res.ok) { if (!handleGate(res)) el('chScArea').innerHTML = '<div class="ch-empty">' + esc(res.data.message || 'Could not start.') + '</div>'; return; }
    scState = { type: type, scenario: res.data.scenario, step: 0, mistakes: 0 };
    renderScStep();
  }
  function renderScStep() {
    var sc = scState.scenario; var step = sc.steps[scState.step];
    var dots = sc.steps.map(function (s, i) { return '<span class="' + (i < scState.step ? 'done' : i === scState.step ? 'cur' : '') + '"></span>'; }).join('');
    var html = '';
    if (scState.step === 0) html += '<div class="ch-scenario-situation"><h3 style="margin:0 0 8px;color:#fff;">' + esc(sc.title) + '</h3>' + esc(sc.situation) + '</div>';
    html += '<div class="ch-card ch-scenario-step"><div class="ch-progress-dots">' + dots + '</div>' +
      '<div class="ch-q-prompt">Step ' + (scState.step + 1) + ': ' + esc(step.prompt) + '</div>' +
      step.options.map(function (o, i) { return '<button class="ch-opt" style="width:100%;text-align:left;" onclick="CareerHub.scPick(' + i + ')">' + esc(o.text) + '</button>'; }).join('') +
      '<div id="chScConseq"></div></div>';
    el('chScArea').innerHTML = html;
  }
  function scPick(i) {
    var step = scState.scenario.steps[scState.step];
    var correct = i === step.correctIndex;
    var opt = step.options[i];
    var box = el('chScConseq');
    if (correct) {
      vibrate(25);
      box.innerHTML = '<div class="ch-consequence good">✅ ' + esc(opt.consequence || 'Good call.') + '</div>' +
        '<button class="ch-btn" style="margin-top:10px;" onclick="CareerHub.scNext()">' + (scState.step === scState.scenario.steps.length - 1 ? 'See outcome →' : 'Next step →') + '</button>';
    } else {
      scState.mistakes++; vibrate([20, 30, 20]);
      box.innerHTML = '<div class="ch-consequence bad">⚠️ ' + esc(opt.consequence || 'That creates a problem.') + '</div>' +
        '<button class="ch-btn ch-btn-ghost" style="margin-top:10px;" onclick="CareerHub.renderScStep()">Try again</button>';
    }
  }
  async function scNext() {
    if (scState.step < scState.scenario.steps.length - 1) { scState.step++; renderScStep(); return; }
    // completed
    var perfect = scState.mistakes === 0;
    await api('/api/scenario-lab/complete', { method: 'POST', headers: authH(), body: JSON.stringify({ scenarioType: scState.type, perfect: perfect }) });
    vibrate([30, 40, 30]);
    el('chScArea').innerHTML = '<div class="ch-card" style="margin-top:16px;"><h3>' + (perfect ? '🏆 Perfect run!' : '✅ Scenario complete') + '</h3>' +
      '<p>' + esc(scState.scenario.outcome || '') + '</p>' +
      '<button class="ch-btn ch-btn-sm ch-btn-ghost" onclick="CareerHub.go(\'scenariolab\')">Try another</button></div>';
  }

  // ── public API ───────────────────────────────────────────────────────────────
  window.CareerHub = {
    changeProfession: function () { openPicker(function () { var active = document.querySelector('.tab-content.active'); if (active) renderTool(active.id.replace('panel-', '')); }); },
    go: function (tab) { if (typeof showTab === 'function') showTab(tab); },
    pro: goPro,
    coach: coach,
    startQuiz: startQuiz, pickAnswer: pickAnswer, submitQuiz: submitQuiz,
    loadIv: loadIv, reveal: reveal, setConf: setConf, ivNav: ivNav, scoreAnswer: scoreAnswer,
    gapResumeSel: gapResumeSel, runGap: runGap,
    searchJobs: searchJobs, saveJob: saveJob, analyzeJob: analyzeJob, unsaveJob: unsaveJob, toggleAlerts: toggleAlerts,
    startScenario: startScenario, scPick: scPick, scNext: scNext, renderScStep: renderScStep,
    badgeShared: function () { ga('badge_share', { profession: profile && profile.id }); }
  };

  // ── boot ─────────────────────────────────────────────────────────────────────
  function boot() { inject(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
