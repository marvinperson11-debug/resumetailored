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
    { id: 'career',      icon: '🧭', label: 'Career Dashboard', i18n: 'ch_nav_dashboard' },
    { id: 'skillslab',   icon: '🧪', label: 'Skills Lab',       i18n: 'ch_nav_skillslab' },
    { id: 'interview',   icon: '🎤', label: 'Interview Prep',   i18n: 'ch_nav_interview' },
    { id: 'gap',         icon: '📊', label: 'Skills Gap',       i18n: 'ch_nav_gap' },
    { id: 'jobfinder',   icon: '🔎', label: 'Job Finder',       i18n: 'ch_nav_jobfinder' },
    { id: 'scenariolab', icon: '🧩', label: 'Scenario Lab',     i18n: 'ch_nav_scenariolab' }
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
  // Current UI language (drives in-language AI generation + which profession
  // label to show). Reads the same localStorage key the site's translate button
  // uses, so hitting that button flips the Career Hub too.
  function lang() { try { return localStorage.getItem('rt_lang') === 'zh' ? 'zh' : 'en'; } catch (e) { return 'en'; } }
  function withLang(url) { return url + (url.indexOf('?') === -1 ? '?' : '&') + 'lang=' + lang(); }
  function bodyLang(obj) { obj = obj || {}; obj.lang = lang(); return obj; }
  // Profession labels in the current language.
  function profDisplay(p) { return p ? (lang() === 'zh' ? (p.displayLabelZh || p.displayLabel) : p.displayLabel) : ''; }
  function profName(p) { return p ? (lang() === 'zh' ? (p.labelZh || p.label) : p.label) : ''; }
  function profCat(p) { return p ? (lang() === 'zh' ? (p.categoryLabelZh || p.categoryLabel) : p.categoryLabel) : ''; }
  // Translate a key whose text contains a {p} placeholder for the profession
  // name in the current language.
  function tp(k, fb) { return t(k, fb).replace('{p}', esc(profName(profile))); }
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

  // ── Simplified-Chinese dictionary for every Career Hub key. Merged into the
  //    app's APP_I18N.zh at boot, so the site's existing translate button swaps
  //    these too. Adding a language later is just another object like this. ────
  var CH_I18N_ZH = {
    ch_nav_dashboard: '职业仪表板', ch_nav_skillslab: '技能实验室', ch_nav_interview: '面试准备',
    ch_nav_gap: '技能差距', ch_nav_jobfinder: '职位搜索', ch_nav_scenariolab: '情景实验室',
    ch_pick_title: '你的目标职业是什么？', ch_pick_search: '搜索 60+ 种职业…',
    ch_sen_none: '资历（可选）', ch_sen_entry: '初级', ch_sen_mid: '中级', ch_sen_senior: '高级', ch_sen_lead: '资深',
    ch_save: '保存', ch_cancel: '取消', ch_change: '更改', ch_upgrade: '升级', ch_upgrade_price: '升级 — $19.99/月',
    ch_tailored: '以下所有内容都为该职业量身定制', ch_prof_set: '目标职业已设置：', ch_could_not_save: '无法保存。',
    ch_np_title: '设置你的目标职业', ch_np_blurb: '选择一次职业，每个职业中心工具都会为其量身定制。', ch_np_btn: '选择职业',
    ch_dash_fail: '无法加载你的仪表板。', ch_d_resumes: '简历', ch_d_tests: '技能测试', ch_d_ivqs: '面试题',
    ch_d_jobs: '收藏职位', ch_d_badges: '技能徽章', ch_d_nobadges: '还没有技能测试。', ch_d_topgaps: '主要技能差距',
    ch_d_lastmatch: '上次匹配', ch_d_nogap: '还没有差距分析。', ch_d_next: '推荐的后续步骤',
    ch_d_caught: '你已全部完成！🎉', ch_d_coach: 'AI 教练总结', ch_coach_unavail: '教练暂时不可用。',
    ch_d_upsell: '升级到 Pro 解锁 AI 教练总结、金牌徽章、技术面试准备和无限分析。',
    ch_skills_test: '{p}技能测试', ch_quiz_blurb: '10 道题，为你的职业量身定制。得分 60% 以上可获得可分享的徽章。',
    ch_topic_opt: '主题（可选）', ch_topic_ph: '例如 患者安全、系统设计 — 留空则测核心技能',
    ch_start_quiz: '开始测试', ch_quiz_free: '免费：每天 1 次测试 + 1 次重考 · 铜牌/银牌徽章。', ch_go_gold: '用 Pro 冲金牌',
    ch_could_not_start: '无法开始。', ch_submit: '提交答案', ch_score_fail: '无法评分。',
    ch_gold: '金牌', ch_silver: '银牌', ch_bronze: '铜牌', ch_no_badge: '未获徽章 — 争取 60% 以上', ch_correct: '正确',
    ch_view_badge: '查看并分享徽章', ch_gold_locked: '你达到了金牌水平！升级到 Pro 解锁金牌徽章。', ch_retake: '重考',
    ch_iv_title: '面试准备 — {p}', ch_behavioral: '行为面试', ch_technical: '技术面试',
    ch_iv_blurb: '先在心里（或大声）作答，然后揭示框架和参考答案。', ch_could_not_load: '无法加载。',
    ch_question: '问题', ch_iv_answer_ph: '写下你的答案（可选）— 然后评分或揭示参考答案',
    ch_score_answer: '给我的答案评分', ch_score_locked: '升级到 Pro 获得对你答案的 AI 反馈。',
    ch_iv_reveal: '揭示框架和参考答案', ch_prev: '上一题', ch_next: '下一题',
    ch_iv_fw: '框架', ch_iv_ma: '参考答案', ch_iv_watch: '注意避免', ch_iv_conf: '你有多大把握？',
    ch_write_first: '请先写一个答案。', ch_unavailable: '不可用。', ch_rating: '评分', ch_strengths: '优势',
    ch_improve: '改进', ch_revised: '修改后',
    ch_gap_title: '技能差距分析器', ch_gap_blurb: '将你的简历与职位对比，得到可操作的清单。',
    ch_gap_resume: '你的简历', ch_gap_paste: '— 在下方粘贴 —', ch_gap_resume_ph: '…或在此粘贴你的简历文本',
    ch_gap_job: '目标职位描述', ch_gap_job_ph: '在此粘贴职位描述', ch_gap_btn: '分析差距',
    ch_gap_free: '免费：每周 1 次分析。', ch_unlimited_pro: 'Pro 无限次', ch_could_not_analyze: '无法分析。',
    ch_need_job: '请粘贴职位描述。', ch_need_resume: '请选择或粘贴简历。',
    ch_sev_critical: '关键', ch_sev_important: '重要', ch_sev_nice: '加分项', ch_wks: '周',
    ch_gap_match: '匹配度', ch_quick_wins: '快速提升', ch_apply_tailor: '在简历定制中应用',
    ch_gaps_close: '待弥补的差距', ch_no_gaps: '未发现重大差距。', ch_study_plan: '学习计划', ch_test_skills: '测试这些技能',
    ch_jf_title: '职位搜索', ch_search: '搜索', ch_job_title: '职位名称', ch_location: '地点', ch_location_ph: '城市、省份或远程',
    ch_any_loc: '任何地点类型', ch_remote_only: '仅远程', ch_any_date: '任何日期', ch_today: '今天',
    ch_3days: '近 3 天', ch_pastweek: '近一周', ch_pastmonth: '近一月', ch_any_type: '任何类型',
    ch_fulltime: '全职', ch_parttime: '兼职', ch_contract: '合同', ch_intern: '实习', ch_search_jobs: '搜索职位',
    ch_jf_free: '免费：每天 5 次搜索 · 最多收藏 5 个职位。', ch_job_alerts: '每天用邮件发送最新的{p}职位',
    ch_before_apply: '申请前', ch_xsell_quiz: '参加{p}技能测试', ch_xsell_gap: '将职位与你的简历对比分析',
    ch_xsell_tailor: '定制你的简历', ch_analyze: '分析', ch_jf_unconf: '此服务器尚未配置职位搜索。',
    ch_search_failed: '搜索失败。', ch_no_jobs: '未找到职位 — 试试更宽泛的搜索。', ch_remote: '远程',
    ch_apply: '申请', ch_save2: '收藏', ch_job_saved: '职位已收藏。', ch_saved: '已收藏', ch_none_yet: '暂无。',
    ch_alerts_on: '每日职位提醒已开启。', ch_alerts_off: '职位提醒已关闭。',
    ch_scenario_lab: '情景实验室', ch_scenario_intro: '解决一个真实的{p}问题，一步一步做决定。',
    ch_sc_type: '情景类型', ch_sc_start: '开始情景', ch_sc_free: '免费：每周 1 个情景。',
    ch_st_cs: '客户服务', ch_st_debug: '技术排查', ch_st_doc: '表格/文档错误', ch_st_conflict: '团队冲突', ch_st_safety: '安全/合规',
    ch_step: '步骤', ch_good_call: '做得好。', ch_creates_problem: '这会造成问题。', ch_try_again: '再试一次',
    ch_see_outcome: '查看结果', ch_next_step: '下一步', ch_perfect_run: '完美通关！', ch_sc_done: '情景完成', ch_try_another: '再来一个'
  };
  function mergeI18n() {
    try {
      if (typeof APP_I18N !== 'undefined') {
        APP_I18N.zh = APP_I18N.zh || {};
        for (var k in CH_I18N_ZH) if (CH_I18N_ZH.hasOwnProperty(k)) APP_I18N.zh[k] = CH_I18N_ZH[k];
      }
    } catch (e) {}
  }

  // ── one-time DOM injection ───────────────────────────────────────────────────
  function inject() {
    // Sidebar buttons — prepend into the existing "Career Hub" section.
    var careerLabel = Array.prototype.find.call(
      document.querySelectorAll('.sidebar-label'),
      function (n) { return /career hub/i.test(n.textContent); });
    if (careerLabel && !el('tab-career')) {
      var anchor = careerLabel.nextSibling;
      TOOLS.forEach(function (tool) {
        var b = document.createElement('button');
        b.className = 'sidebar-btn';
        b.id = 'tab-' + tool.id;
        b.setAttribute('data-label', tool.label);
        b.onclick = function () { showTab(tool.id); };
        // data-i18n so the site's own translate button swaps the label to zh.
        // No inline flex/gap here: the base .sidebar-btn already lays this out,
        // and inline styles fought the mobile bottom-bar rules (column layout,
        // gap:0) — which, together with the FREE pill's own font-size surviving
        // the bar's font-size:0, made these buttons taller than the 56px bar and
        // clipped their tops. The pill is hidden on mobile in CSS instead.
        b.innerHTML = '<span class="sidebar-icon">' + tool.icon + '</span> <span style="flex:1;text-align:left;" data-i18n="' + tool.i18n + '">' + tool.label + '</span>' +
          '<span class="ch-pill ch-pill-free" style="margin-left:auto;">FREE</span>';
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
        '<div class="ch-picker-head"><h2 data-i18n="ch_pick_title">What\'s your target profession?</h2>' +
        '<input class="ch-input" id="chPickerSearch" data-i18n-placeholder="ch_pick_search" placeholder="Search 60+ professions…" autocomplete="off" /></div>' +
        '<div class="ch-picker-body" id="chPickerBody"></div>' +
        '<div class="ch-picker-foot">' +
        '<select class="ch-select" id="chPickerSeniority" style="flex:1;min-width:130px;">' +
        '<option value="" data-i18n="ch_sen_none">Seniority (optional)</option><option value="entry-level" data-i18n="ch_sen_entry">Entry Level</option>' +
        '<option value="mid" data-i18n="ch_sen_mid">Mid Level</option><option value="senior" data-i18n="ch_sen_senior">Senior</option><option value="lead" data-i18n="ch_sen_lead">Lead</option></select>' +
        '<button class="ch-btn" id="chPickerSave" data-i18n="ch_save" disabled>Save</button>' +
        '<button class="ch-btn ch-btn-ghost ch-btn-sm" id="chPickerClose" data-i18n="ch_cancel">Cancel</button></div></div>';
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
    // Wrap the site's language toggle so the OPEN Career Hub tool re-renders in
    // the new language (its content is built with t(), which reads rt_lang).
    if (!window._chLangWrapped && typeof window.toggleLang === 'function') {
      var origToggle = window.toggleLang;
      window.toggleLang = function () {
        origToggle();
        var active = document.querySelector('.tab-content.active');
        if (active) { var id = active.id.replace('panel-', ''); if (TOOL_IDS.indexOf(id) !== -1) renderTool(id); }
      };
      window._chLangWrapped = true;
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
          (p.labelZh && p.labelZh.indexOf(q) !== -1) ||
          (p.aliases || []).some(function (a) { return a.toLowerCase().indexOf(q) !== -1; }) ||
          cat.label.toLowerCase().indexOf(q) !== -1;
      });
      if (!matches.length) return;
      var catLabel = lang() === 'zh' ? (cat.labelZh || cat.label) : cat.label;
      html += '<div class="ch-picker-cat">' + cat.icon + ' ' + esc(catLabel) + '</div>';
      matches.forEach(function (p) {
        var plabel = lang() === 'zh' ? (p.labelZh || p.label) : p.label;
        html += '<div class="ch-picker-item" data-pid="' + esc(p.id) + '" data-sen="' + (p.seniority ? '1' : '0') + '">' + esc(plabel) + '</div>';
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
    var res = await api('/api/profession', { method: 'POST', headers: authH(), body: JSON.stringify(bodyLang({ professionId: pid, seniority: sen })) });
    if (res.ok) {
      profile = res.data; profileLoaded = true;
      toast(t('ch_prof_set', 'Target profession set:') + ' ' + profDisplay(res.data));
      vibrate(20);
      // Capture the re-render callback BEFORE closePicker() — closePicker nulls
      // pickerOnSet, so reading it afterwards always got null and the dashboard
      // (and every tool) never refreshed after a profession change until a
      // manual page reload. Capture first, then close, then fire.
      var cb = pickerOnSet;
      closePicker();
      if (cb) cb();
    } else { el('chPickerSave').disabled = false; toast(res.data.message || t('ch_could_not_save', 'Could not save.')); }
  }

  function profHeader() {
    if (!profile) return '';
    return '<div class="ch-prof-header"><span class="ch-prof-icon">🎯</span>' +
      '<div><div class="ch-prof-name">' + esc(profDisplay(profile)) + '</div>' +
      '<div class="ch-prof-sub">' + esc(profCat(profile)) + ' · ' + t('ch_tailored', 'everything below is tailored to this role') + '</div></div>' +
      '<button class="ch-prof-edit" onclick="CareerHub.changeProfession()">' + t('ch_change', 'Change') + '</button></div>';
  }
  function needProfileCard(box) {
    box.innerHTML = '<div class="ch-card ch-empty"><h3>' + t('ch_np_title', 'Set your target profession') + '</h3>' +
      '<p class="ch-note">' + t('ch_np_blurb', 'Pick your profession once and every Career Hub tool tailors itself to it.') + '</p>' +
      '<button class="ch-btn" style="margin-top:12px;" onclick="CareerHub.changeProfession()">' + t('ch_np_btn', 'Choose profession') + ' →</button></div>';
  }

  // ── Dashboard ────────────────────────────────────────────────────────────────
  async function renderDashboard() {
    var box = el('ch-career'); box.innerHTML = spin();
    var res = await api('/api/career/dashboard');
    if (!res.ok) { if (!handleGate(res)) box.innerHTML = '<div class="ch-empty">' + t('ch_dash_fail', 'Could not load your dashboard.') + '</div>'; return; }
    var d = res.data;
    profile = d.profession || profile;
    var bands = d.skills.bestBands || {};
    var bandHtml = Object.keys(bands).length
      ? Object.keys(bands).map(function (topic) { var b = bands[topic]; return '<span class="ch-pill ch-pill-' + (b.band || 'bronze') + '" style="margin:2px;">' + (b.band === 'gold' ? '🥇' : b.band === 'silver' ? '🥈' : '🥉') + ' ' + esc(topic) + '</span>'; }).join('')
      : '<span class="ch-note">' + t('ch_d_nobadges', 'No skills tests yet.') + '</span>';
    var gapHtml = d.gap
      ? '<div class="ch-stat">' + d.gap.matchScore + '%</div><div class="ch-stat-lbl">' + t('ch_d_lastmatch', 'Last match') + '</div>' +
        (d.gap.topGaps || []).map(function (g) { return '<div style="font-size:13px;margin-top:6px;">🔸 ' + esc(g.requirement) + '</div>'; }).join('')
      : '<span class="ch-note">' + t('ch_d_nogap', 'No gap analysis yet.') + '</span>';
    var steps = (d.nextSteps || []).map(function (s) {
      return '<li style="margin-bottom:8px;"><a style="color:var(--ch-forest);font-weight:700;cursor:pointer;text-decoration:none;" onclick="CareerHub.go(\'' + s.tab + '\')">' + esc(s.text) + ' →</a></li>';
    }).join('');
    box.innerHTML =
      (profile ? profHeader() : '') +
      '<div class="ch-grid cols-4" style="margin-bottom:16px;">' +
      '<div class="ch-card"><div class="ch-stat">' + d.resume.count + '</div><div class="ch-stat-lbl">' + t('ch_d_resumes', 'Resumes') + '</div></div>' +
      '<div class="ch-card"><div class="ch-stat">' + d.skills.attempts + '</div><div class="ch-stat-lbl">' + t('ch_d_tests', 'Skills tests') + '</div></div>' +
      '<div class="ch-card"><div class="ch-stat">' + d.interview.practiced + '</div><div class="ch-stat-lbl">' + t('ch_d_ivqs', 'Interview Qs') + '</div></div>' +
      '<div class="ch-card"><div class="ch-stat">' + d.jobs.saved + '</div><div class="ch-stat-lbl">' + t('ch_d_jobs', 'Saved jobs') + '</div></div>' +
      '</div>' +
      '<div class="ch-grid cols-2" style="margin-bottom:16px;">' +
      '<div class="ch-card"><h3>' + t('ch_d_badges', 'Skills badges') + '</h3>' + bandHtml + '</div>' +
      '<div class="ch-card"><h3>' + t('ch_d_topgaps', 'Top skills gaps') + '</h3>' + gapHtml + '</div>' +
      '</div>' +
      '<div class="ch-card"><h3>' + t('ch_d_next', 'Recommended next steps') + '</h3><ol style="margin:8px 0 0;padding-left:20px;">' + (steps || '<li class="ch-note">' + t('ch_d_caught', "You're all caught up! 🎉") + '</li>') + '</ol>' +
      (d.isSubscriber ? '<div id="chCoach" style="margin-top:14px;"><button class="ch-btn ch-btn-ghost ch-btn-sm" onclick="CareerHub.coach()">✨ ' + t('ch_d_coach', 'AI coach summary') + '</button></div>'
        : '<div class="ch-upsell" style="margin-top:14px;">' + t('ch_d_upsell', 'Unlock the AI coach summary, Gold badges, technical interview prep and unlimited analyses with Pro.') + '<br><button class="ch-btn ch-btn-sm" onclick="CareerHub.pro()">' + t('ch_upgrade_price', 'Upgrade — $19.99/mo') + '</button></div>') +
      '</div>' +
      '<div class="ch-card" style="margin-top:16px;" id="chCandidateCard">' + spin() + '</div>';
    renderCandidateSection();
  }

  // ── Employer marketplace opt-in: "let employers find me" + contact requests ──
  var candState = null;
  async function renderCandidateSection() {
    var box = el('chCandidateCard'); if (!box) return;
    var res = await api('/api/candidate/profile');
    if (!res.ok) { box.innerHTML = ''; return; }
    candState = res.data;
    var reqRes = await api('/api/candidate/contact-requests');
    var pending = reqRes.ok ? (reqRes.data.requests || []).filter(function (r) { return r.status === 'pending'; }) : [];
    box.innerHTML =
      '<h3>' + t('ch_cand_title', 'Let employers find you') + '</h3>' +
      '<p class="ch-note">' + t('ch_cand_blurb', 'Opt in to appear in employer candidate search on the ResumeTailored Employer Portal. Off by default — nothing is shared unless you turn this on.') + '</p>' +
      '<label style="display:block;margin:10px 0 6px;font-weight:700;font-size:14px;"><input type="checkbox" id="candSearchable"' + (candState.searchable ? ' checked' : '') + '/> ' + t('ch_cand_searchable', 'Let employers find me') + '</label>' +
      '<label style="display:block;margin-bottom:10px;font-weight:700;font-size:14px;"><input type="checkbox" id="candOpenToWork"' + (candState.openToWork ? ' checked' : '') + '/> ' + t('ch_cand_otw', 'Show an "Open to Work" badge') + '</label>' +
      '<div class="ep-2col ch-grid cols-2" style="margin-bottom:10px;">' +
      '<div class="ch-field"><label class="ch-label">' + t('ch_cand_remote', 'Remote preference') + '</label><select class="ch-select" id="candRemote">' +
        ['any', 'remote', 'hybrid', 'onsite'].map(function (v) { return '<option value="' + v + '"' + (candState.remotePref === v ? ' selected' : '') + '>' + v.charAt(0).toUpperCase() + v.slice(1) + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="ch-field"><label class="ch-label">' + t('ch_cand_loc', 'Location') + '</label><input class="ch-input" id="candLocation" value="' + esc(candState.location) + '"/></div>' +
      '</div>' +
      '<label style="display:block;margin-bottom:10px;font-weight:700;font-size:14px;"><input type="checkbox" id="candGig"' + (candState.gigAvailable ? ' checked' : '') + ' onchange="CareerHub.toggleGigFields(this.checked)"/> ' + t('ch_cand_gig', 'Available for temp/gig work') + '</label>' +
      '<div class="ch-grid cols-2" id="candGigFields" style="margin-bottom:10px;display:' + (candState.gigAvailable ? 'grid' : 'none') + ';">' +
      '<div class="ch-field"><label class="ch-label">' + t('ch_cand_rate', 'Hourly rate ($)') + '</label><input class="ch-input" id="candRate" type="number" min="0" value="' + (candState.hourlyRate == null ? '' : candState.hourlyRate) + '"/></div>' +
      '<div class="ch-field"><label class="ch-label">' + t('ch_cand_sched', 'Availability') + '</label><input class="ch-input" id="candSched" value="' + esc(candState.gigSchedule) + '" placeholder="e.g. weekends"/></div>' +
      '</div>' +
      '<button class="ch-btn ch-btn-sm" onclick="CareerHub.saveCandidateProfile()">' + t('ch_cand_save', 'Save') + '</button>' +
      (pending.length ? '<div style="margin-top:18px;"><h4 style="margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.5px;color:var(--ch-forest);">' + t('ch_cand_requests', 'Employers want to connect') + '</h4>' +
        pending.map(function (r) {
          return '<div class="ch-job"><div class="ch-job-title">' + esc(r.companyName) + '</div>' +
            (r.message ? '<div class="ch-job-meta">"' + esc(r.message) + '"</div>' : '') +
            '<div class="ch-row"><button class="ch-btn ch-btn-sm" onclick="CareerHub.answerContact(' + r.id + ',\'approved\')">' + t('ch_cand_approve', 'Approve') + '</button>' +
            '<button class="ch-btn ch-btn-sm ch-btn-ghost" onclick="CareerHub.answerContact(' + r.id + ',\'declined\')">' + t('ch_cand_decline', 'Decline') + '</button></div></div>';
        }).join('') + '</div>' : '');
  }
  function toggleGigFields(on) { var f = el('candGigFields'); if (f) f.style.display = on ? 'grid' : 'none'; }
  async function saveCandidateProfile() {
    var body = {
      searchable: el('candSearchable').checked, openToWork: el('candOpenToWork').checked,
      remotePref: el('candRemote').value, location: el('candLocation').value,
      gigAvailable: el('candGig').checked, hourlyRate: el('candRate') ? el('candRate').value : '',
      gigSchedule: el('candSched') ? el('candSched').value : ''
    };
    var res = await api('/api/candidate/profile', { method: 'POST', headers: authH(), body: JSON.stringify(body) });
    if (!res.ok) { toast(res.data.message || t('ch_cand_save_fail', 'Could not save.')); return; }
    toast(t('ch_cand_saved', 'Saved.'));
  }
  async function answerContact(id, status) {
    var res = await api('/api/candidate/contact-requests/' + id, { method: 'POST', headers: authH(), body: JSON.stringify({ status: status }) });
    if (!res.ok) { toast(t('ch_cand_answer_fail', 'Could not respond.')); return; }
    renderCandidateSection();
  }
  async function coach() {
    var c = el('chCoach'); if (c) c.innerHTML = spin();
    var res = await api(withLang('/api/career/coach'));
    if (!res.ok) { if (!handleGate(res) && c) c.innerHTML = '<span class="ch-note">' + t('ch_coach_unavail', 'Coach unavailable right now.') + '</span>'; return; }
    if (c) c.innerHTML = '<div class="ch-card" style="background:var(--ch-cream);">✨ ' + esc(res.data.summary || '') + '</div>';
  }

  // ── Skills Lab ───────────────────────────────────────────────────────────────
  var quizState = null;
  function renderSkillsLab() {
    var box = el('ch-skillslab'); if (!profile) return needProfileCard(box);
    box.innerHTML = profHeader() +
      '<div class="ch-card"><h3>' + tp('ch_skills_test', '{p} Skills Test') + '</h3>' +
      '<p class="ch-note">' + t('ch_quiz_blurb', '10 questions, tailored to your role. Score 60%+ for a badge you can share.') + '</p>' +
      '<div class="ch-field" style="margin-top:12px;"><label class="ch-label">' + t('ch_topic_opt', 'Topic (optional)') + '</label>' +
      '<input class="ch-input" id="chQuizTopic" placeholder="' + t('ch_topic_ph', 'e.g. Patient Safety, System Design — leave blank for core skills') + '" /></div>' +
      '<button class="ch-btn" id="chQuizStart" onclick="CareerHub.startQuiz()">' + t('ch_start_quiz', 'Start quiz') + ' →</button>' +
      (isPro() ? '' : '<div class="ch-note" style="margin-top:10px;">' + t('ch_quiz_free', 'Free: 1 quiz + 1 retake per day · Bronze/Silver badges.') + ' <a style="color:var(--ch-forest);cursor:pointer;" onclick="CareerHub.pro()">' + t('ch_go_gold', 'Go Gold with Pro') + ' →</a></div>') +
      '</div><div id="chQuizArea"></div>';
  }
  async function startQuiz() {
    var topic = (el('chQuizTopic') && el('chQuizTopic').value || '').trim();
    ga('quiz_start', { profession: profile && profile.id, topic: topic || 'general' });
    var btn = el('chQuizStart'); if (btn) { btn.disabled = true; }
    el('chQuizArea').innerHTML = spin();
    var res = await api('/api/skills-lab/quiz', { method: 'POST', headers: authH(), body: JSON.stringify(bodyLang({ topic: topic })) });
    if (btn) btn.disabled = false;
    if (!res.ok) { if (!handleGate(res)) el('chQuizArea').innerHTML = '<div class="ch-empty">' + esc(res.data.message || t('ch_could_not_start', 'Could not start.')) + '</div>'; return; }
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
    html += '<button class="ch-btn" onclick="CareerHub.submitQuiz()">' + t('ch_submit', 'Submit answers') + ' →</button>';
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
    if (!res.ok) { if (!handleGate(res)) toast(t('ch_score_fail', 'Could not score your quiz.')); return; }
    var d = res.data; vibrate(d.band ? [30, 40, 30] : 20);
    ga('quiz_complete', { profession: profile && profile.id, score: d.score, band: d.band || 'none' });
    var bandTxt = d.band ? '<span class="ch-pill ch-pill-' + d.band + '">' + (d.band === 'gold' ? '🥇 ' + t('ch_gold', 'Gold') : d.band === 'silver' ? '🥈 ' + t('ch_silver', 'Silver') : '🥉 ' + t('ch_bronze', 'Bronze')) + '</span>' : '<span class="ch-note">' + t('ch_no_badge', 'No badge — aim for 60%+') + '</span>';
    // mark options
    quizState.quiz.questions.forEach(function (qq, qi) {
      var r = d.results[qi]; var qEl = el('chQuizArea').querySelector('.ch-q[data-qi="' + qi + '"]'); if (!qEl) return;
      var opts = qEl.querySelectorAll('.ch-opt');
      if (opts[r.correctDisplay]) opts[r.correctDisplay].classList.add('correct');
      if (!r.isCorrect && r.chosenDisplay != null && opts[r.chosenDisplay]) opts[r.chosenDisplay].classList.add('wrong');
      var ex = document.createElement('div'); ex.className = 'ch-explain'; ex.textContent = '✔ ' + r.explanation; qEl.appendChild(ex);
    });
    var head = '<div class="ch-card" style="margin:18px 0;"><div class="ch-stat">' + d.score + '%</div><div class="ch-stat-lbl">' + d.correct + ' / ' + d.total + ' ' + t('ch_correct', 'correct') + ' · ' + bandTxt + '</div>';
    if (d.badge) head += '<div style="margin-top:10px;"><a class="ch-btn ch-btn-sm" href="' + withLang(d.badge.url) + '" target="_blank" rel="noopener" onclick="CareerHub.badgeShared()">' + t('ch_view_badge', 'View & share badge') + ' →</a></div>';
    if (d.goldLocked) head += '<div class="ch-upsell" style="margin-top:10px;">' + t('ch_gold_locked', 'You scored Gold! Upgrade to Pro to unlock the Gold badge.') + ' <button class="ch-btn ch-btn-sm" onclick="CareerHub.pro()">' + t('ch_upgrade', 'Upgrade') + '</button></div>';
    head += '<div style="margin-top:10px;"><button class="ch-btn ch-btn-ghost ch-btn-sm" onclick="CareerHub.startQuiz()">' + t('ch_retake', 'Retake') + '</button></div></div>';
    var area = el('chQuizArea'); area.insertAdjacentHTML('afterbegin', head);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ── Interview Prep ───────────────────────────────────────────────────────────
  var ivState = null;
  function renderInterview() {
    var box = el('ch-interview'); if (!profile) return needProfileCard(box);
    box.innerHTML = profHeader() +
      '<div class="ch-card"><h3>' + tp('ch_iv_title', 'Interview Prep — {p}') + '</h3>' +
      '<div class="ch-row" style="margin:10px 0;">' +
      '<button class="ch-btn ch-btn-sm" onclick="CareerHub.loadIv(\'behavioral\')">' + t('ch_behavioral', 'Behavioral') + ' <span class="ch-pill ch-pill-free">FREE</span></button>' +
      '<button class="ch-btn ch-btn-sm ch-btn-ghost" onclick="CareerHub.loadIv(\'technical\')">' + t('ch_technical', 'Technical') + ' <span class="ch-pill ch-pill-pro">PRO</span></button>' +
      '</div><p class="ch-note">' + t('ch_iv_blurb', 'Answer in your head (or out loud), then reveal the framework and a model answer.') + '</p></div>' +
      '<div id="chIvArea"></div>';
  }
  async function loadIv(kind) {
    ga('interview_practice_start', { profession: profile && profile.id, kind: kind });
    el('chIvArea').innerHTML = spin();
    var res = await api('/api/interview/questions', { method: 'POST', headers: authH(), body: JSON.stringify(bodyLang({ kind: kind })) });
    if (!res.ok) { if (!handleGate(res)) el('chIvArea').innerHTML = '<div class="ch-empty">' + esc(res.data.message || t('ch_could_not_load', 'Could not load.')) + '</div>'; return; }
    ivState = { kind: res.data.kind, questions: res.data.questions, idx: 0 };
    renderIvCard();
  }
  function renderIvCard() {
    var q = ivState.questions[ivState.idx];
    var html = '<div class="ch-iv-card" id="chIvCard">' +
      '<div class="ch-note">' + t('ch_question', 'Question') + ' ' + (ivState.idx + 1) + ' / ' + ivState.questions.length + '</div>' +
      '<div class="ch-iv-q">' + esc(q.prompt) + '</div>' +
      (isPro()
        ? '<div class="ch-field"><textarea class="ch-textarea" id="chIvAnswer" placeholder="' + t('ch_iv_answer_ph', 'Draft your answer (optional) — then Score it or Reveal the model answer') + '"></textarea>' +
          '<button class="ch-btn ch-btn-sm" onclick="CareerHub.scoreAnswer()">✨ ' + t('ch_score_answer', 'Score my answer') + '</button> <span id="chIvScore"></span></div>'
        : '<div class="ch-upsell">🔒 ' + t('ch_score_locked', 'Upgrade to Pro to get AI feedback on your answers.') + ' <button class="ch-btn ch-btn-sm" onclick="CareerHub.pro()">' + t('ch_upgrade', 'Upgrade') + '</button></div>') +
      '<button class="ch-btn ch-btn-ghost" id="chIvRevealBtn" onclick="CareerHub.reveal()">' + t('ch_iv_reveal', 'Reveal framework & model answer') + '</button>' +
      '<div id="chIvReveal"></div>' +
      '<div class="ch-iv-nav"><button class="ch-btn ch-btn-ghost ch-btn-sm" onclick="CareerHub.ivNav(-1)" ' + (ivState.idx === 0 ? 'disabled' : '') + '>← ' + t('ch_prev', 'Prev') + '</button>' +
      '<button class="ch-btn ch-btn-sm" onclick="CareerHub.ivNav(1)" ' + (ivState.idx === ivState.questions.length - 1 ? 'disabled' : '') + '>' + t('ch_next', 'Next') + ' →</button></div></div>';
    el('chIvArea').innerHTML = html;
    attachSwipe(el('chIvCard'));
  }
  function reveal() {
    var q = ivState.questions[ivState.idx];
    el('chIvRevealBtn').style.display = 'none';
    el('chIvReveal').innerHTML = '<div class="ch-reveal">' +
      '<h4>' + t('ch_iv_fw', 'Framework') + '</h4><p>' + esc(q.framework) + '</p>' +
      '<h4>' + t('ch_iv_ma', 'Model answer') + '</h4><p>' + esc(q.modelAnswer) + '</p>' +
      (q.watchFor ? '<h4>' + t('ch_iv_watch', 'Watch out for') + '</h4><p>' + esc(q.watchFor) + '</p>' : '') +
      '<h4>' + t('ch_iv_conf', 'How confident are you?') + '</h4><div class="ch-conf" id="chIvConf">' +
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
    var ans = el('chIvAnswer') && el('chIvAnswer').value.trim(); if (!ans) { toast(t('ch_write_first', 'Write an answer first.')); return; }
    el('chIvScore').innerHTML = '<span class="ch-spinner"></span>';
    var q = ivState.questions[ivState.idx];
    var res = await api('/api/interview/score', { method: 'POST', headers: authH(), body: JSON.stringify(bodyLang({ question: q.prompt, answer: ans })) });
    if (!res.ok) { if (!handleGate(res)) el('chIvScore').textContent = t('ch_unavailable', 'Unavailable.'); else el('chIvScore').textContent = ''; return; }
    var d = res.data;
    el('chIvScore').innerHTML = '<div class="ch-reveal" style="margin-top:10px;"><h4>' + t('ch_rating', 'Rating') + ': ' + (d.rating || '-') + '/5</h4>' +
      '<h4>' + t('ch_strengths', 'Strengths') + '</h4><p>' + (d.strengths || []).map(esc).join('; ') + '</p>' +
      '<h4>' + t('ch_improve', 'Improve') + '</h4><p>' + (d.improvements || []).map(esc).join('; ') + '</p>' +
      (d.revised ? '<h4>' + t('ch_revised', 'Revised') + '</h4><p>' + esc(d.revised) + '</p>' : '') + '</div>';
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
    var opts = '<option value="">' + t('ch_gap_paste', '— paste below —') + '</option>' + resumes.map(function (r) { return '<option value="' + r.id + '">' + esc(r.title) + '</option>'; }).join('');
    box.innerHTML = (profile ? profHeader() : '') +
      '<div class="ch-card"><h3>' + t('ch_gap_title', 'Skills Gap Analyzer') + '</h3><p class="ch-note">' + t('ch_gap_blurb', 'Compare your resume to a job and get an actionable checklist.') + '</p>' +
      '<div class="ch-field"><label class="ch-label">' + t('ch_gap_resume', 'Your resume') + '</label><select class="ch-select" id="chGapResume" onchange="CareerHub.gapResumeSel()">' + opts + '</select>' +
      '<textarea class="ch-textarea" id="chGapResumeText" placeholder="' + t('ch_gap_resume_ph', '…or paste your resume text here') + '" style="margin-top:8px;"></textarea></div>' +
      '<div class="ch-field"><label class="ch-label">' + t('ch_gap_job', 'Target job description') + '</label><textarea class="ch-textarea" id="chGapJob" placeholder="' + t('ch_gap_job_ph', 'Paste the job description here') + '"></textarea></div>' +
      '<button class="ch-btn" id="chGapBtn" onclick="CareerHub.runGap()">' + t('ch_gap_btn', 'Analyze gap') + ' →</button>' +
      (isPro() ? '' : '<div class="ch-note" style="margin-top:10px;">' + t('ch_gap_free', 'Free: 1 analysis per week.') + ' <a style="color:var(--ch-forest);cursor:pointer;" onclick="CareerHub.pro()">' + t('ch_unlimited_pro', 'Unlimited with Pro') + ' →</a></div>') +
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
    if (!jobText) { toast(t('ch_need_job', 'Paste a job description.')); return; }
    if (!resumeId && !resumeText) { toast(t('ch_need_resume', 'Select or paste a resume.')); return; }
    ga('gap_analysis_run', { profession: profile && profile.id });
    var btn = el('chGapBtn'); btn.disabled = true; el('chGapArea').innerHTML = spin();
    var body = { jobText: jobText };
    if (resumeId) body.resumeId = parseInt(resumeId, 10); else body.resume = resumeText;
    var res = await api('/api/skills-gap', { method: 'POST', headers: authH(), body: JSON.stringify(bodyLang(body)) });
    btn.disabled = false;
    if (!res.ok) { if (!handleGate(res)) el('chGapArea').innerHTML = '<div class="ch-empty">' + esc(res.data.message || t('ch_could_not_analyze', 'Could not analyze.')) + '</div>'; return; }
    renderGapReport(res.data);
  }
  var SEV_LABEL = { critical: 'ch_sev_critical', important: 'ch_sev_important', 'nice-to-have': 'ch_sev_nice' };
  function renderGapReport(d) {
    var gaps = (d.gaps || []).map(function (g) {
      return '<div class="ch-gap-item ' + g.severity + '"><span class="sev">' + esc(t(SEV_LABEL[g.severity] || '', g.severity)) + '</span> — <b>' + esc(g.requirement) + '</b>' +
        (g.evidence ? '<div class="ch-note">' + esc(g.evidence) + '</div>' : '') +
        (g.action ? '<div style="font-size:13px;margin-top:4px;">✅ ' + esc(g.action) + '</div>' : '') + '</div>';
    }).join('');
    var study = (d.studyPlan || []).map(function (s) { return '<li>' + esc(s.skill) + ' — ' + esc(s.how) + ' <span class="ch-note">(~' + s.estWeeks + ' ' + t('ch_wks', 'wks') + ')</span></li>'; }).join('');
    el('chGapArea').innerHTML =
      '<div class="ch-card" style="margin-top:16px;"><div class="ch-score-ring">' + d.matchScore + '%</div><div class="ch-stat-lbl">' + t('ch_gap_match', 'Match score') + '</div></div>' +
      '<div class="ch-grid cols-2" style="margin-top:14px;">' +
      '<div class="ch-card"><h3>✅ ' + t('ch_strengths', 'Strengths') + '</h3><ul>' + (d.strengths || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></div>' +
      '<div class="ch-card"><h3>⚡ ' + t('ch_quick_wins', 'Quick wins') + '</h3><ul>' + (d.quickWins || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>' +
      '<a class="ch-btn ch-btn-sm ch-btn-ghost" style="margin-top:8px;" onclick="CareerHub.go(\'tailor\')">' + t('ch_apply_tailor', 'Apply in Resume Tailor') + ' →</a></div>' +
      '</div>' +
      '<div class="ch-card" style="margin-top:14px;"><h3>🎯 ' + t('ch_gaps_close', 'Gaps to close') + '</h3>' + (gaps || '<span class="ch-note">' + t('ch_no_gaps', 'No major gaps found.') + '</span>') + '</div>' +
      '<div class="ch-card" style="margin-top:14px;"><h3>📚 ' + t('ch_study_plan', 'Study plan') + '</h3><ul>' + study + '</ul>' +
      '<a class="ch-btn ch-btn-sm ch-btn-ghost" style="margin-top:8px;" onclick="CareerHub.go(\'skillslab\')">' + t('ch_test_skills', 'Test these skills') + ' →</a></div>';
  }

  // ── Job Finder ───────────────────────────────────────────────────────────────
  function renderJobFinder() {
    var box = el('ch-jobfinder');
    box.innerHTML = (profile ? profHeader() : '') +
      '<div class="ch-card"><h3>' + t('ch_jf_title', 'Job Finder') + '</h3>' +
      '<div class="ch-grid cols-2"><div class="ch-field"><label class="ch-label">' + t('ch_search', 'Search') + '</label><input class="ch-input" id="chJobQuery" placeholder="' + esc(profile ? profName(profile) : t('ch_job_title', 'Job title')) + '" /></div>' +
      '<div class="ch-field"><label class="ch-label">' + t('ch_location', 'Location') + '</label><input class="ch-input" id="chJobLoc" placeholder="' + t('ch_location_ph', 'City, state or Remote') + '" /></div></div>' +
      '<div class="ch-row"><select class="ch-select" id="chJobRemote" style="flex:1;"><option value="">' + t('ch_any_loc', 'Any location type') + '</option><option value="remote">' + t('ch_remote_only', 'Remote only') + '</option></select>' +
      '<select class="ch-select" id="chJobDate" style="flex:1;"><option value="">' + t('ch_any_date', 'Any date') + '</option><option value="today">' + t('ch_today', 'Today') + '</option><option value="3days">' + t('ch_3days', 'Past 3 days') + '</option><option value="week">' + t('ch_pastweek', 'Past week') + '</option><option value="month">' + t('ch_pastmonth', 'Past month') + '</option></select>' +
      '<select class="ch-select" id="chJobType" style="flex:1;"><option value="">' + t('ch_any_type', 'Any type') + '</option><option value="FULLTIME">' + t('ch_fulltime', 'Full-time') + '</option><option value="PARTTIME">' + t('ch_parttime', 'Part-time') + '</option><option value="CONTRACTOR">' + t('ch_contract', 'Contract') + '</option><option value="INTERN">' + t('ch_intern', 'Internship') + '</option></select></div>' +
      '<button class="ch-btn" id="chJobBtn" style="margin-top:12px;" onclick="CareerHub.searchJobs()">' + t('ch_search_jobs', 'Search jobs') + ' →</button>' +
      (isPro() ? '' : '<div class="ch-note" style="margin-top:8px;">' + t('ch_jf_free', 'Free: 5 searches/day · save up to 5 jobs.') + ' <a style="color:var(--ch-forest);cursor:pointer;" onclick="CareerHub.pro()">' + t('ch_unlimited_pro', 'Unlimited with Pro') + ' →</a></div>') +
      '</div>' +
      '<div class="ch-row" style="margin-top:10px;"><label style="font-size:13px;display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" id="chJobAlerts" onchange="CareerHub.toggleAlerts(this.checked)"> ' + tp('ch_job_alerts', 'Email me a daily digest of new {p} jobs') + '</label></div>' +
      '<div class="ch-jobfinder-layout" style="margin-top:16px;"><div id="chJobResults"></div>' +
      '<aside class="ch-crosssell"><h3 style="margin-top:0;">' + t('ch_before_apply', 'Before you apply') + '</h3>' +
      '<a onclick="CareerHub.go(\'skillslab\')">🧪 ' + tp('ch_xsell_quiz', 'Take the {p} Skills Test') + '</a>' +
      '<a onclick="CareerHub.go(\'gap\')">📊 ' + t('ch_xsell_gap', 'Analyze a job vs. your resume') + '</a>' +
      '<a onclick="CareerHub.go(\'tailor\')">✦ ' + t('ch_xsell_tailor', 'Tailor your resume') + '</a>' +
      '<div id="chSavedJobs" style="margin-top:12px;"></div></aside></div>' +
      '<div class="ch-sticky-bar"><button class="ch-btn" onclick="CareerHub.searchJobs()">' + t('ch_search', 'Search') + '</button><button class="ch-btn ch-btn-ghost" onclick="CareerHub.go(\'gap\')">' + t('ch_analyze', 'Analyze') + '</button></div>';
    loadSavedJobs();
    loadAlerts();
  }
  async function loadAlerts() {
    var box = el('chJobAlerts'); if (!box) return;
    var res = await api('/api/jobs/alerts');
    if (res.ok) box.checked = !!res.data.enabled;
  }
  async function toggleAlerts(on) {
    var res = await api('/api/jobs/alerts', { method: 'POST', headers: authH(), body: JSON.stringify(bodyLang({ enabled: !!on })) });
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
      var msg = res.data.error === 'jobs_unconfigured' ? t('ch_jf_unconf', 'Job search is not configured on this server yet.') : (res.data.message || t('ch_search_failed', 'Search failed.'));
      el('chJobResults').innerHTML = '<div class="ch-empty">' + esc(msg) + '</div>'; return;
    }
    var jobs = res.data.jobs || [];
    if (!jobs.length) { el('chJobResults').innerHTML = '<div class="ch-empty">' + t('ch_no_jobs', 'No jobs found — try a broader search.') + '</div>'; return; }
    el('chJobResults').innerHTML = jobs.map(function (j) {
      return '<div class="ch-job"><div class="ch-job-title">' + esc(j.title) + '</div>' +
        '<div class="ch-job-meta">' + esc(j.company) + (j.location ? ' · ' + esc(j.location) : '') + (j.remote ? ' · 🏠 ' + t('ch_remote', 'Remote') : '') + '</div>' +
        '<div class="ch-note">' + esc(j.descriptionSnippet || '') + '…</div>' +
        '<div class="ch-row" style="margin-top:10px;">' +
        (j.url ? '<a class="ch-btn ch-btn-sm" href="' + esc(j.url) + '" target="_blank" rel="noopener">' + t('ch_apply', 'Apply') + '</a>' : '') +
        '<button class="ch-btn ch-btn-sm ch-btn-ghost" onclick=\'CareerHub.saveJob(' + JSON.stringify(j).replace(/'/g, '&#39;') + ')\'>' + t('ch_save2', 'Save') + '</button>' +
        '<button class="ch-btn ch-btn-sm ch-btn-ghost" onclick=\'CareerHub.analyzeJob(' + JSON.stringify(j).replace(/'/g, '&#39;') + ')\'>' + t('ch_analyze', 'Analyze') + '</button>' +
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
    box.innerHTML = '<h3 style="font-size:14px;">' + t('ch_saved', 'Saved') + ' (' + jobs.length + ')</h3>' +
      (jobs.length ? jobs.map(function (j) {
        return '<div style="font-size:13px;padding:6px 0;border-bottom:1px solid var(--ch-line);">' + esc(j.title) +
          ' <a style="color:#dc2626;cursor:pointer;float:right;" onclick="CareerHub.unsaveJob(' + j.id + ')">✕</a></div>';
      }).join('') : '<span class="ch-note">' + t('ch_none_yet', 'None yet.') + '</span>');
  }
  async function unsaveJob(id) { await api('/api/jobs/saved/' + id, { method: 'DELETE', headers: authH() }); loadSavedJobs(); }

  // ── Scenario Lab ─────────────────────────────────────────────────────────────
  var scState = null;
  function renderScenarioLab() {
    var box = el('ch-scenariolab'); if (!profile) return needProfileCard(box);
    var types = { 'customer-service': t('ch_st_cs', 'Customer Service'), 'technical-debugging': t('ch_st_debug', 'Technical Debugging'), 'document-errors': t('ch_st_doc', 'Spreadsheet/Document Errors'), 'team-conflict': t('ch_st_conflict', 'Team Conflict'), 'safety-compliance': t('ch_st_safety', 'Safety/Compliance') };
    box.innerHTML = profHeader() +
      '<div class="ch-card"><h3>' + t('ch_scenario_lab', 'Scenario Lab') + '</h3><p class="ch-note">' + tp('ch_scenario_intro', 'Work through a realistic {p} problem, one decision at a time.') + '</p>' +
      '<div class="ch-field" style="margin-top:10px;"><label class="ch-label">' + t('ch_sc_type', 'Scenario type') + '</label><select class="ch-select" id="chScType">' +
      Object.keys(types).map(function (k) { return '<option value="' + k + '">' + esc(types[k]) + '</option>'; }).join('') + '</select></div>' +
      '<button class="ch-btn" id="chScBtn" onclick="CareerHub.startScenario()">' + t('ch_sc_start', 'Start scenario') + ' →</button>' +
      (isPro() ? '' : '<div class="ch-note" style="margin-top:8px;">' + t('ch_sc_free', 'Free: 1 scenario per week.') + ' <a style="color:var(--ch-forest);cursor:pointer;" onclick="CareerHub.pro()">' + t('ch_unlimited_pro', 'Unlimited with Pro') + ' →</a></div>') +
      '</div><div id="chScArea"></div>';
  }
  async function startScenario() {
    var type = el('chScType').value; var btn = el('chScBtn'); btn.disabled = true;
    el('chScArea').innerHTML = spin();
    var res = await api('/api/scenario-lab/scenario', { method: 'POST', headers: authH(), body: JSON.stringify(bodyLang({ scenarioType: type })) });
    btn.disabled = false;
    if (!res.ok) { if (!handleGate(res)) el('chScArea').innerHTML = '<div class="ch-empty">' + esc(res.data.message || t('ch_could_not_start', 'Could not start.')) + '</div>'; return; }
    scState = { type: type, scenario: res.data.scenario, step: 0, mistakes: 0 };
    renderScStep();
  }
  function renderScStep() {
    var sc = scState.scenario; var step = sc.steps[scState.step];
    var dots = sc.steps.map(function (s, i) { return '<span class="' + (i < scState.step ? 'done' : i === scState.step ? 'cur' : '') + '"></span>'; }).join('');
    var html = '';
    if (scState.step === 0) html += '<div class="ch-scenario-situation"><h3 style="margin:0 0 8px;color:#fff;">' + esc(sc.title) + '</h3>' + esc(sc.situation) + '</div>';
    html += '<div class="ch-card ch-scenario-step"><div class="ch-progress-dots">' + dots + '</div>' +
      '<div class="ch-q-prompt">' + t('ch_step', 'Step') + ' ' + (scState.step + 1) + ': ' + esc(step.prompt) + '</div>' +
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
      box.innerHTML = '<div class="ch-consequence good">✅ ' + esc(opt.consequence || t('ch_good_call', 'Good call.')) + '</div>' +
        '<button class="ch-btn" style="margin-top:10px;" onclick="CareerHub.scNext()">' + (scState.step === scState.scenario.steps.length - 1 ? t('ch_see_outcome', 'See outcome') : t('ch_next_step', 'Next step')) + ' →</button>';
    } else {
      scState.mistakes++; vibrate([20, 30, 20]);
      box.innerHTML = '<div class="ch-consequence bad">⚠️ ' + esc(opt.consequence || t('ch_creates_problem', 'That creates a problem.')) + '</div>' +
        '<button class="ch-btn ch-btn-ghost" style="margin-top:10px;" onclick="CareerHub.renderScStep()">' + t('ch_try_again', 'Try again') + '</button>';
    }
  }
  async function scNext() {
    if (scState.step < scState.scenario.steps.length - 1) { scState.step++; renderScStep(); return; }
    // completed
    var perfect = scState.mistakes === 0;
    await api('/api/scenario-lab/complete', { method: 'POST', headers: authH(), body: JSON.stringify({ scenarioType: scState.type, perfect: perfect }) });
    vibrate([30, 40, 30]);
    el('chScArea').innerHTML = '<div class="ch-card" style="margin-top:16px;"><h3>' + (perfect ? '🏆 ' + t('ch_perfect_run', 'Perfect run!') : '✅ ' + t('ch_sc_done', 'Scenario complete')) + '</h3>' +
      '<p>' + esc(scState.scenario.outcome || '') + '</p>' +
      '<button class="ch-btn ch-btn-sm ch-btn-ghost" onclick="CareerHub.go(\'scenariolab\')">' + t('ch_try_another', 'Try another') + '</button></div>';
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
    badgeShared: function () { ga('badge_share', { profession: profile && profile.id }); },
    toggleGigFields: toggleGigFields, saveCandidateProfile: saveCandidateProfile, answerContact: answerContact
  };

  // ── boot ─────────────────────────────────────────────────────────────────────
  function boot() { mergeI18n(); inject(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
