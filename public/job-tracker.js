/* job-tracker.js — the Job Application Tracker UI, shared by both placements:
 *  - the standalone free tool at /job-tracker (public/job-tracker.html)
 *  - the Pro dashboard tab in app.html
 *
 * One module, one backend (/api/applications). The only differences between the
 * two placements are injected via mount() options: the toast host and an
 * upgrade handler. Free vs Pro is decided by the server (the list response
 * carries isPro + limit); the UI only mirrors those gates.
 *
 * Usage:  JobTracker.mount({ container, toast, onUpgrade, getTailorJob })
 */
(function () {
  'use strict';

  var STATUSES = ['Applied', 'Phone Screen', 'Interview', 'Offer', 'Rejected', 'Withdrawn', 'Ghosted'];
  var STATUS_COLOR = {
    'Applied':     { bg: '#EAF2EC', fg: '#1F5C3D' },
    'Phone Screen':{ bg: '#E6F0FA', fg: '#1D4ED8' },
    'Interview':   { bg: '#FBF0DA', fg: '#B4832A' },
    'Offer':       { bg: '#E8F0E9', fg: '#1F5C3D' },
    'Rejected':    { bg: '#FBE7E3', fg: '#B23A2E' },
    'Withdrawn':   { bg: '#ECE7DF', fg: '#57514A' },
    'Ghosted':     { bg: '#EDEDED', fg: '#6B7280' }
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function token() { return localStorage.getItem('rt_token') || ''; }
  function headers() { var h = { 'Content-Type': 'application/json' }; var t = token(); if (t) h.Authorization = 'Bearer ' + t; return h; }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function daysBetween(a, b) { return Math.round((b - a) / 86400000); }
  function parseDate(s) { return s ? new Date(s + 'T12:00:00') : null; }

  async function api(method, path, body) {
    var res = await fetch('/api/applications' + path, {
      method: method, headers: headers(), body: body ? JSON.stringify(body) : undefined
    });
    var json = null; try { json = await res.json(); } catch (e) {}
    return { status: res.status, json: json };
  }

  function JT(opts) {
    this.root = typeof opts.container === 'string' ? document.getElementById(opts.container) : opts.container;
    this.toast = opts.toast || function (m) { try { console.log(m); } catch (e) {} };
    this.onUpgrade = opts.onUpgrade || function () { window.location = '/#pricing'; };
    this.getTailorJob = opts.getTailorJob || function () { return null; };
    this.apps = [];
    this.isPro = false;
    this.limit = 20;
    this.view = localStorage.getItem('jt_view') || 'kanban';
    this.sortKey = 'date'; this.sortDir = -1;
    this.injectStyles();
  }

  JT.prototype.injectStyles = function () {
    if (document.getElementById('jt-styles')) return;
    var css = [
      '.jt-wrap{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#57514A;}',
      '.jt-head{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-bottom:18px;}',
      '.jt-head h2{font-family:Fraunces,Georgia,serif;font-size:24px;font-weight:700;color:#191512;margin:0;}',
      '.jt-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}',
      '.jt-btn{font-size:13px;font-weight:700;padding:9px 14px;border-radius:9px;border:1px solid #D9CFBC;background:#fff;color:#191512;cursor:pointer;font-family:inherit;white-space:nowrap;}',
      '.jt-btn:hover{border-color:#1F5C3D;color:#1F5C3D;}',
      '.jt-btn--primary{background:#1F5C3D;color:#fff;border-color:#1F5C3D;}',
      '.jt-btn--primary:hover{background:#153F2A;color:#fff;}',
      '.jt-btn--lock{opacity:.85;}',
      '.jt-seg{display:inline-flex;background:#F1EADD;border:1px solid #E7DFD1;border-radius:9px;padding:3px;}',
      '.jt-seg button{border:none;background:transparent;font-size:13px;font-weight:700;color:#57514A;padding:6px 12px;border-radius:7px;cursor:pointer;font-family:inherit;}',
      '.jt-seg button.on{background:#fff;color:#1F5C3D;box-shadow:0 1px 3px rgba(25,21,18,.1);}',
      '.jt-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px;}',
      '.jt-stat{background:#fff;border:1px solid #E7DFD1;border-radius:14px;padding:16px;}',
      '.jt-stat .n{font-size:26px;font-weight:900;color:#191512;line-height:1;}',
      '.jt-stat .l{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#918A7E;margin-top:6px;}',
      '.jt-chart{background:#fff;border:1px solid #E7DFD1;border-radius:14px;padding:16px;margin-bottom:16px;}',
      '.jt-chart .t{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#918A7E;margin-bottom:12px;}',
      '.jt-bars{display:flex;align-items:flex-end;gap:8px;height:90px;}',
      '.jt-bars .col{flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;height:100%;justify-content:flex-end;}',
      '.jt-bars .bar{width:100%;max-width:34px;background:#1F5C3D;border-radius:5px 5px 0 0;min-height:3px;}',
      '.jt-bars .bl{font-size:9px;color:#918A7E;}',
      '.jt-bars .bv{font-size:10px;font-weight:800;color:#1F5C3D;}',
      '.jt-followups{background:#FBF0DA;border:1px solid #EBD9A8;border-radius:14px;padding:14px 16px;margin-bottom:16px;}',
      '.jt-followups.overdue{background:#FBE7E3;border-color:#F0C4BC;}',
      '.jt-followups .t{font-size:12px;font-weight:800;color:#B4832A;margin-bottom:8px;}',
      '.jt-followups.overdue .t{color:#B23A2E;}',
      '.jt-fu-item{font-size:13px;color:#57514A;padding:3px 0;}',
      '.jt-banner{background:linear-gradient(135deg,rgba(31,92,61,.1),rgba(46,125,83,.06));border:1px solid rgba(31,92,61,.3);border-radius:14px;padding:16px;margin-bottom:16px;display:flex;gap:14px;align-items:center;justify-content:space-between;flex-wrap:wrap;}',
      '.jt-banner .txt{font-size:14px;font-weight:600;color:#191512;}',
      '.jt-board{display:flex;gap:14px;overflow-x:auto;padding-bottom:8px;}',
      '.jt-col{flex:0 0 250px;min-width:250px;background:#F4F1EA;border:1px solid #E7DFD1;border-radius:14px;padding:10px;}',
      '.jt-col.drag{outline:2px dashed #1F5C3D;outline-offset:-4px;}',
      '.jt-col-h{display:flex;align-items:center;justify-content:space-between;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#57514A;padding:4px 6px 10px;}',
      '.jt-col-h .c{background:#fff;border:1px solid #E7DFD1;border-radius:20px;padding:1px 8px;font-size:11px;color:#918A7E;}',
      '.jt-card{background:#fff;border:1px solid #E7DFD1;border-radius:11px;padding:12px;margin-bottom:9px;cursor:grab;box-shadow:0 1px 2px rgba(25,21,18,.05);}',
      '.jt-card:hover{border-color:#1F5C3D;}',
      '.jt-card .co{font-size:14px;font-weight:800;color:#191512;}',
      '.jt-card .ro{font-size:12.5px;color:#57514A;margin-top:1px;}',
      '.jt-card .me{font-size:11px;color:#918A7E;margin-top:7px;display:flex;justify-content:space-between;gap:8px;}',
      '.jt-badge{display:inline-block;font-size:10px;font-weight:800;padding:2px 8px;border-radius:20px;}',
      '.jt-due{color:#B23A2E;font-weight:800;}',
      '.jt-table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #E7DFD1;border-radius:14px;overflow:hidden;}',
      '.jt-table th{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#918A7E;text-align:left;padding:11px 12px;border-bottom:1px solid #E7DFD1;cursor:pointer;user-select:none;background:#F4F1EA;}',
      '.jt-table td{font-size:13px;color:#57514A;padding:11px 12px;border-bottom:1px solid #F1EADD;}',
      '.jt-table tr:last-child td{border-bottom:none;}',
      '.jt-table tr:hover td{background:#FBF9F4;cursor:pointer;}',
      '.jt-empty{background:#fff;border:1px dashed #D9CFBC;border-radius:16px;padding:48px 24px;text-align:center;}',
      '.jt-empty .e{font-size:40px;margin-bottom:10px;}',
      '.jt-empty h3{font-family:Fraunces,Georgia,serif;font-size:20px;color:#191512;margin:0 0 6px;}',
      '.jt-empty p{font-size:14px;color:#918A7E;margin:0 0 18px;}',
      '.jt-modal-bg{position:fixed;inset:0;background:rgba(25,21,18,.5);z-index:12000;display:flex;align-items:center;justify-content:center;padding:16px;}',
      '.jt-modal{background:#FAF7F0;border-radius:18px;width:100%;max-width:540px;max-height:92vh;overflow:auto;box-shadow:0 30px 80px rgba(25,21,18,.35);}',
      '.jt-modal-h{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid #E7DFD1;}',
      '.jt-modal-h h3{font-family:Fraunces,Georgia,serif;font-size:19px;color:#191512;margin:0;}',
      '.jt-x{background:none;border:none;font-size:26px;line-height:1;color:#918A7E;cursor:pointer;}',
      '.jt-form{padding:18px 20px;display:grid;grid-template-columns:1fr 1fr;gap:12px;}',
      '.jt-field{display:flex;flex-direction:column;gap:5px;}',
      '.jt-field.full{grid-column:1/-1;}',
      '.jt-field label{font-size:12px;font-weight:700;color:#57514A;}',
      '.jt-field input,.jt-field select,.jt-field textarea{border:1px solid #D9CFBC;border-radius:9px;padding:9px 11px;font-size:14px;font-family:inherit;color:#191512;background:#fff;outline:none;}',
      '.jt-field input:focus,.jt-field select:focus,.jt-field textarea:focus{border-color:#1F5C3D;box-shadow:0 0 0 3px rgba(31,92,61,.12);}',
      '.jt-modal-f{display:flex;gap:10px;justify-content:space-between;align-items:center;padding:16px 20px;border-top:1px solid #E7DFD1;}',
      '.jt-lock{font-size:12px;}',
      '@media(max-width:640px){.jt-form{grid-template-columns:1fr;}.jt-col{flex-basis:80vw;min-width:80vw;}}'
    ].join('\n');
    var s = document.createElement('style'); s.id = 'jt-styles'; s.textContent = css; document.head.appendChild(s);
  };

  JT.prototype.mount = async function () {
    if (!this.root) return;
    if (!token()) { this.renderLoggedOut(); return; }
    this.root.innerHTML = '<div class="jt-wrap"><p style="color:#918A7E;font-size:14px;">Loading your applications…</p></div>';
    await this.load();
  };

  JT.prototype.renderLoggedOut = function () {
    var here = (location.pathname || '/') + (location.search || '');
    var loginHref = '/login?redirect=' + encodeURIComponent(here.indexOf('/login') === 0 ? '/job-tracker' : here);
    this.root.innerHTML = '<div class="jt-wrap"><div class="jt-empty"><div class="e">🔑</div>' +
      '<h3>Log in to track your applications</h3>' +
      '<p>The Job Tracker saves your applications to your free account.</p>' +
      '<a class="jt-btn jt-btn--primary" href="' + loginHref + '">Log in / Sign up →</a></div></div>';
  };

  JT.prototype.load = async function () {
    var r = await api('GET', '');
    if (r.status === 401) { this.renderLoggedOut(); return; }
    if (r.status !== 200 || !r.json) { this.root.innerHTML = '<div class="jt-wrap"><p style="color:#B23A2E;">Could not load applications. Please refresh.</p></div>'; return; }
    this.apps = r.json.applications || [];
    this.isPro = !!r.json.isPro;
    this.limit = r.json.limit;
    var s = await api('GET', '/stats');
    this.stats = (s.status === 200 && s.json) ? s.json : null;
    this.render();
  };

  JT.prototype.render = function () {
    var self = this;
    var atLimit = !this.isPro && this.apps.length >= (this.limit || 20);
    var h = '<div class="jt-wrap">';
    // Header
    h += '<div class="jt-head"><h2>Job Tracker</h2><div class="jt-actions">';
    h += '<div class="jt-seg"><button data-view="kanban" class="' + (this.view === 'kanban' ? 'on' : '') + '">Board</button>' +
         '<button data-view="list" class="' + (this.view === 'list' ? 'on' : '') + '">List</button></div>';
    h += this.isPro
      ? '<button class="jt-btn" data-act="autofill">✨ Auto-fill</button><button class="jt-btn" data-act="export">⬇ Export CSV</button>'
      : '<button class="jt-btn jt-btn--lock" data-act="lock-autofill">🔒 Auto-fill</button><button class="jt-btn jt-btn--lock" data-act="lock-export">🔒 Export CSV</button>';
    h += '<button class="jt-btn jt-btn--primary" data-act="add"' + (atLimit ? ' disabled style="opacity:.5;cursor:not-allowed;"' : '') + '>+ Add Application</button>';
    h += '</div></div>';

    // Stats
    if (this.stats && this.apps.length) h += this.statsHtml();
    // Follow-ups
    h += this.followupsHtml();
    // Free limit banner
    if (!this.isPro) {
      if (atLimit) {
        h += '<div class="jt-banner"><span class="txt">You\'ve reached the free limit of ' + (this.limit || 20) + ' applications.</span>' +
             '<button class="jt-btn jt-btn--primary" data-act="upgrade">Track unlimited with Pro →</button></div>';
      } else {
        h += '<div style="font-size:12px;color:#918A7E;margin-bottom:14px;">Free plan · ' + this.apps.length + ' / ' + (this.limit || 20) +
             ' applications · <a href="#" data-act="upgrade" style="color:#1F5C3D;font-weight:700;">Upgrade for unlimited →</a></div>';
      }
    }

    if (!this.apps.length) {
      h += '<div class="jt-empty"><div class="e">📋</div><h3>Start tracking your first application</h3>' +
           '<p>Add a job you\'ve applied to and watch it move from Applied to Offer.</p>' +
           '<button class="jt-btn jt-btn--primary" data-act="add">+ Add your first application</button></div>';
    } else {
      h += this.view === 'kanban' ? this.boardHtml() : this.listHtml();
    }
    h += '</div>';
    this.root.innerHTML = h;
    this.wire();
  };

  JT.prototype.statsHtml = function () {
    var s = this.stats;
    function tile(n, l) { return '<div class="jt-stat"><div class="n">' + n + '</div><div class="l">' + l + '</div></div>'; }
    var html = '<div class="jt-stats">' +
      tile(s.totalThisMonth, 'Applied This Month') +
      tile(s.responseRate + '%', 'Response Rate') +
      tile(s.interviews, 'Interviews') +
      tile(s.offers, 'Offers') +
      tile(s.avgDaysToResponse == null ? '—' : s.avgDaysToResponse + 'd', 'Avg Days to Response') +
      '</div>';
    if (s.weekly && s.weekly.length) {
      var max = Math.max(1, Math.max.apply(null, s.weekly.map(function (w) { return w.count; })));
      html += '<div class="jt-chart"><div class="t">Applications per week (last 8 weeks)</div><div class="jt-bars">';
      s.weekly.forEach(function (w) {
        var pct = Math.round((w.count / max) * 100);
        html += '<div class="col"><div class="bv">' + (w.count || '') + '</div>' +
                '<div class="bar" style="height:' + (w.count ? Math.max(6, pct) : 3) + '%"></div>' +
                '<div class="bl">' + esc(w.label) + '</div></div>';
      });
      html += '</div></div>';
    }
    return html;
  };

  JT.prototype.followupsHtml = function () {
    var today = todayISO();
    var due = this.apps.filter(function (a) { return a.followUpDate && a.followUpDate <= today && a.status !== 'Rejected' && a.status !== 'Withdrawn'; });
    // "this week" upcoming
    var wk = new Date(); wk.setDate(wk.getDate() + 7); var wkISO = wk.toISOString().slice(0, 10);
    var soon = this.apps.filter(function (a) { return a.followUpDate && a.followUpDate > today && a.followUpDate <= wkISO && a.status !== 'Rejected' && a.status !== 'Withdrawn'; });
    if (!due.length && !soon.length) return '';
    var overdue = due.length > 0;
    var h = '<div class="jt-followups' + (overdue ? ' overdue' : '') + '"><div class="t">' +
      (overdue ? '⏰ Follow-ups due (' + due.length + ' overdue)' : '⏰ Follow-ups this week') + '</div>';
    due.concat(soon).slice(0, 6).forEach(function (a) {
      var od = a.followUpDate <= today;
      h += '<div class="jt-fu-item">' + esc(a.company) + ' · ' + esc(a.jobTitle) +
        ' <span class="' + (od ? 'jt-due' : '') + '">— ' + (od ? 'overdue since ' : 'by ') + esc(a.followUpDate) + '</span></div>';
    });
    return h + '</div>';
  };

  JT.prototype.boardHtml = function () {
    var self = this;
    var h = '<div class="jt-board">';
    STATUSES.forEach(function (st) {
      var col = self.apps.filter(function (a) { return a.status === st; });
      h += '<div class="jt-col" data-col="' + st + '"><div class="jt-col-h"><span>' + esc(st) + '</span><span class="c">' + col.length + '</span></div>';
      col.forEach(function (a) { h += self.cardHtml(a); });
      h += '</div>';
    });
    return h + '</div>';
  };

  JT.prototype.cardHtml = function (a) {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var applied = parseDate(a.dateApplied);
    var days = applied ? daysBetween(applied.getTime(), Date.now()) : 0;
    var c = STATUS_COLOR[a.status] || STATUS_COLOR['Applied'];
    var overdue = a.followUpDate && a.followUpDate <= todayISO() && a.status !== 'Rejected' && a.status !== 'Withdrawn';
    // Stale-application nudge: once an "Applied" card sits 7+ days, offer a
    // one-click jump to the Follow-Up Email Generator, prefilled from the card.
    var followBtn = '';
    if (a.status === 'Applied' && days >= 7) {
      var fq = 'company=' + encodeURIComponent(a.company || '') + '&role=' + encodeURIComponent(a.jobTitle || '') + '&days=' + days;
      followBtn = '<a href="/tools/follow-up-generator?' + fq + '" onclick="event.stopPropagation();" ' +
        'style="display:block;margin-top:9px;text-align:center;background:#1F5C3D;color:#fff;font-size:12px;font-weight:800;padding:7px;border-radius:8px;text-decoration:none;">✉️ Generate Follow-Up</a>';
    }
    return '<div class="jt-card" draggable="true" data-id="' + a.id + '">' +
      '<div class="co">' + esc(a.company) + '</div>' +
      '<div class="ro">' + esc(a.jobTitle) + (a.location ? ' · ' + esc(a.location) : '') + '</div>' +
      '<div class="me"><span class="jt-badge" style="background:' + c.bg + ';color:' + c.fg + ';">' + esc(a.status) + '</span>' +
      '<span>' + (days === 0 ? 'today' : days + 'd ago') + (overdue ? ' · <span class="jt-due">follow up</span>' : '') + '</span></div>' +
      followBtn +
      '</div>';
  };

  JT.prototype.listHtml = function () {
    var self = this;
    var rows = this.apps.slice();
    var k = this.sortKey, dir = this.sortDir;
    rows.sort(function (a, b) {
      var va, vb;
      if (k === 'company') { va = a.company.toLowerCase(); vb = b.company.toLowerCase(); }
      else if (k === 'status') { va = STATUSES.indexOf(a.status); vb = STATUSES.indexOf(b.status); }
      else { va = a.dateApplied; vb = b.dateApplied; }
      return va < vb ? -dir : va > vb ? dir : 0;
    });
    var arrow = function (key) { return self.sortKey === key ? (self.sortDir === 1 ? ' ▲' : ' ▼') : ''; };
    var h = '<div style="overflow-x:auto;"><table class="jt-table"><thead><tr>' +
      '<th data-sort="company">Company' + arrow('company') + '</th>' +
      '<th>Role</th>' +
      '<th data-sort="date">Applied' + arrow('date') + '</th>' +
      '<th>Days</th>' +
      '<th data-sort="status">Status' + arrow('status') + '</th>' +
      '<th></th></tr></thead><tbody>';
    rows.forEach(function (a) {
      var applied = parseDate(a.dateApplied);
      var days = applied ? daysBetween(applied.getTime(), Date.now()) : 0;
      var c = STATUS_COLOR[a.status] || STATUS_COLOR['Applied'];
      h += '<tr data-id="' + a.id + '"><td><strong style="color:#191512;">' + esc(a.company) + '</strong></td>' +
        '<td>' + esc(a.jobTitle) + '</td><td>' + esc(a.dateApplied) + '</td><td>' + (days === 0 ? 'today' : days + 'd') + '</td>' +
        '<td><span class="jt-badge" style="background:' + c.bg + ';color:' + c.fg + ';">' + esc(a.status) + '</span></td>' +
        '<td style="text-align:right;"><button class="jt-btn" data-edit="' + a.id + '" style="padding:5px 10px;">Edit</button></td></tr>';
    });
    return h + '</tbody></table></div>';
  };

  // ── Event wiring ─────────────────────────────────────────────────────────────
  JT.prototype.wire = function () {
    var self = this;
    this.root.querySelectorAll('[data-view]').forEach(function (b) {
      b.addEventListener('click', function () { self.view = b.getAttribute('data-view'); localStorage.setItem('jt_view', self.view); self.render(); });
    });
    this.root.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.preventDefault();
        var act = b.getAttribute('data-act');
        if (act === 'add') self.openModal(null);
        else if (act === 'upgrade' || act === 'lock-export' || act === 'lock-autofill') {
          if (act === 'lock-export') self.toast('CSV export is a Pro feature.');
          if (act === 'lock-autofill') self.toast('Auto-fill is a Pro feature.');
          self.onUpgrade();
        }
        else if (act === 'export') self.doExport();
        else if (act === 'autofill') self.openAutofill();
      });
    });
    // list: sort + row edit
    this.root.querySelectorAll('[data-sort]').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-sort');
        if (self.sortKey === k) self.sortDir = -self.sortDir; else { self.sortKey = k; self.sortDir = k === 'date' ? -1 : 1; }
        self.render();
      });
    });
    this.root.querySelectorAll('[data-edit]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); self.openModal(self.byId(b.getAttribute('data-edit'))); });
    });
    this.root.querySelectorAll('.jt-table tbody tr').forEach(function (tr) {
      tr.addEventListener('click', function () { self.openModal(self.byId(tr.getAttribute('data-id'))); });
    });
    // kanban: click to edit + drag/drop
    this.root.querySelectorAll('.jt-card').forEach(function (card) {
      card.addEventListener('click', function () { self.openModal(self.byId(card.getAttribute('data-id'))); });
      card.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', card.getAttribute('data-id')); e.dataTransfer.effectAllowed = 'move'; });
    });
    this.root.querySelectorAll('.jt-col').forEach(function (col) {
      col.addEventListener('dragover', function (e) { e.preventDefault(); col.classList.add('drag'); });
      col.addEventListener('dragleave', function () { col.classList.remove('drag'); });
      col.addEventListener('drop', function (e) {
        e.preventDefault(); col.classList.remove('drag');
        var id = e.dataTransfer.getData('text/plain');
        var st = col.getAttribute('data-col');
        self.move(id, st);
      });
    });
  };

  JT.prototype.byId = function (id) { id = parseInt(id, 10); return this.apps.find(function (a) { return a.id === id; }); };

  JT.prototype.move = async function (id, status) {
    var a = this.byId(id); if (!a || a.status === status) return;
    var prev = a.status; a.status = status; this.render();  // optimistic
    var r = await api('PUT', '/' + id, { status: status });
    if (r.status !== 200) { a.status = prev; this.render(); this.toast('Could not update status.'); }
    else { await this.refreshStats(); this.render(); }
  };

  JT.prototype.refreshStats = async function () {
    var s = await api('GET', '/stats'); if (s.status === 200 && s.json) this.stats = s.json;
  };

  // ── Add / Edit modal ─────────────────────────────────────────────────────────
  JT.prototype.openModal = function (a, prefill) {
    var self = this;
    var isEdit = !!a; var d = a || prefill || {};
    var bg = document.createElement('div'); bg.className = 'jt-modal-bg';
    function field(label, name, val, type, full) {
      return '<div class="jt-field' + (full ? ' full' : '') + '"><label>' + label + '</label>' +
        '<input name="' + name + '" type="' + (type || 'text') + '" value="' + esc(val || '') + '"/></div>';
    }
    var statusOpts = STATUSES.map(function (s) { return '<option value="' + s + '"' + ((d.status || 'Applied') === s ? ' selected' : '') + '>' + s + '</option>'; }).join('');
    bg.innerHTML = '<div class="jt-modal"><div class="jt-modal-h"><h3>' + (isEdit ? 'Edit Application' : 'Add Application') + '</h3><button class="jt-x" data-x>&times;</button></div>' +
      '<div class="jt-form">' +
      field('Company *', 'company', d.company, 'text') +
      field('Job Title *', 'jobTitle', d.jobTitle, 'text') +
      field('Location', 'location', d.location, 'text') +
      field('Application URL', 'applicationUrl', d.applicationUrl, 'url') +
      field('Date Applied', 'dateApplied', d.dateApplied || todayISO(), 'date') +
      '<div class="jt-field"><label>Status</label><select name="status">' + statusOpts + '</select></div>' +
      field('Salary Range', 'salaryRange', d.salaryRange, 'text') +
      field('Follow Up By', 'followUpDate', d.followUpDate, 'date') +
      field('Contact Name', 'contactName', d.contactName, 'text') +
      field('Contact Email', 'contactEmail', d.contactEmail, 'email') +
      '<div class="jt-field full"><label>Notes</label><textarea name="notes" rows="3">' + esc(d.notes || '') + '</textarea></div>' +
      '</div>' +
      '<div class="jt-modal-f">' +
      (isEdit ? '<button class="jt-btn" data-del style="color:#B23A2E;border-color:#F0C4BC;">Delete</button>' : '<span></span>') +
      '<div style="display:flex;gap:10px;"><button class="jt-btn" data-x>Cancel</button>' +
      '<button class="jt-btn jt-btn--primary" data-save>' + (isEdit ? 'Save' : 'Add Application') + '</button></div>' +
      '</div></div>';
    document.body.appendChild(bg);
    function close() { bg.remove(); }
    bg.addEventListener('click', function (e) { if (e.target === bg) close(); });
    bg.querySelectorAll('[data-x]').forEach(function (b) { b.addEventListener('click', close); });
    var del = bg.querySelector('[data-del]');
    if (del) del.addEventListener('click', async function () {
      if (!confirm('Delete this application?')) return;
      var r = await api('DELETE', '/' + a.id);
      if (r.status === 200) { self.apps = self.apps.filter(function (x) { return x.id !== a.id; }); close(); self.toast('Application deleted.'); await self.refreshStats(); self.render(); }
      else self.toast('Could not delete.');
    });
    bg.querySelector('[data-save]').addEventListener('click', async function () {
      var form = {};
      bg.querySelectorAll('[name]').forEach(function (el) { form[el.getAttribute('name')] = el.value; });
      if (!form.company.trim() || !form.jobTitle.trim()) { self.toast('Company and job title are required.'); return; }
      var r = isEdit ? await api('PUT', '/' + a.id, form) : await api('POST', '', form);
      if (r.status === 403 && r.json && r.json.error === 'free_limit') { close(); self.toast(r.json.message || 'Free limit reached.'); self.onUpgrade(); return; }
      if (r.status !== 200) { self.toast((r.json && r.json.error) || 'Could not save.'); return; }
      close();
      self.toast(isEdit ? 'Application updated.' : 'Application added.');
      await self.load();
    });
  };

  JT.prototype.doExport = function () {
    // Authenticated download: fetch as blob (the endpoint needs the bearer token).
    var self = this;
    fetch('/api/applications/export', { headers: headers() }).then(function (res) {
      if (res.status === 403) { self.toast('CSV export is a Pro feature.'); self.onUpgrade(); return null; }
      if (!res.ok) { self.toast('Export failed.'); return null; }
      return res.blob();
    }).then(function (blob) {
      if (!blob) return;
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a'); a.href = url; a.download = 'job-applications.csv'; document.body.appendChild(a); a.click();
      a.remove(); URL.revokeObjectURL(url);
      self.toast('Exported to CSV.');
    }).catch(function () { self.toast('Export failed.'); });
  };

  // Pro auto-fill: pick from saved Job Finder jobs, or the current Tailor job.
  JT.prototype.openAutofill = async function () {
    var self = this;
    var tailorJob = this.getTailorJob && this.getTailorJob();
    var r = await api('GET', '/autofill/jobs');
    if (r.status === 403) { this.toast('Auto-fill is a Pro feature.'); this.onUpgrade(); return; }
    var jobs = (r.json && r.json.jobs) || [];
    // Saved Job Finder jobs are structured, so they take priority. The Resume
    // Tailor only exposes the job URL you tailored against, so it's a fallback
    // prefill when there are no saved jobs.
    if (!jobs.length) {
      if (tailorJob && (tailorJob.company || tailorJob.jobTitle || tailorJob.url)) {
        this.openModal(null, { company: tailorJob.company || '', jobTitle: tailorJob.jobTitle || '', applicationUrl: tailorJob.url || '', location: tailorJob.location || '', source: 'resume_tailor' });
        return;
      }
      this.toast('No saved jobs to auto-fill from. Save jobs in the Job Finder first.'); return;
    }
    // Simple picker
    var bg = document.createElement('div'); bg.className = 'jt-modal-bg';
    var opts = jobs.map(function (j, i) { return '<option value="' + i + '">' + esc(j.company || '—') + ' — ' + esc(j.title || '') + '</option>'; }).join('');
    bg.innerHTML = '<div class="jt-modal"><div class="jt-modal-h"><h3>Auto-fill from a saved job</h3><button class="jt-x" data-x>&times;</button></div>' +
      '<div style="padding:18px 20px;"><div class="jt-field"><label>Saved jobs</label><select id="jt-af-sel">' + opts + '</select></div></div>' +
      '<div class="jt-modal-f"><span></span><div style="display:flex;gap:10px;"><button class="jt-btn" data-x>Cancel</button><button class="jt-btn jt-btn--primary" data-pick>Use this job</button></div></div></div>';
    document.body.appendChild(bg);
    function close() { bg.remove(); }
    bg.addEventListener('click', function (e) { if (e.target === bg) close(); });
    bg.querySelectorAll('[data-x]').forEach(function (b) { b.addEventListener('click', close); });
    bg.querySelector('[data-pick]').addEventListener('click', function () {
      var j = jobs[parseInt(bg.querySelector('#jt-af-sel').value, 10)]; close();
      self.openModal(null, { company: j.company, jobTitle: j.title, location: j.location, applicationUrl: j.url, source: 'job_finder' });
    });
  };

  window.JobTracker = {
    mount: function (opts) { var jt = new JT(opts || {}); jt.mount(); return jt; }
  };
})();
