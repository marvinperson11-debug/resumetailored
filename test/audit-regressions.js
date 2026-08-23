#!/usr/bin/env node
/** Regression coverage for the 2026-08 full-audit fixes. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

let failures = 0;
function check(name, condition, detail) {
  if (condition) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
}

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-audit-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';
const { app } = require('../server.js');
const Database = require('better-sqlite3');
const db = new Database(path.join(process.env.DATA_DIR, 'resumetailor.db'));
db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run('free@x.com', 'Free User', 'x');
db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('tokFree', 'free@x.com');
db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run('pro@x.com', 'Pro User', 'x');
db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('tokPro', 'pro@x.com');
db.prepare('INSERT INTO subscribers (email,customer_id) VALUES (?,?)').run('pro@x.com', 'cus_test');

let PORT;
function request(method, urlPath, token, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch (_) {}
        resolve({ status: res.statusCode, text, json, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const server = app.listen(0, async () => {
  PORT = server.address().port;
  try {
    const appRoutes = ['/tailor', '/cover-letter', '/website', '/video', '/tools', '/app/tailor', '/app/video', '/app/website', '/app/cover-letter'];
    for (const route of appRoutes) {
      const r = await request('GET', route);
      check(`${route} serves the dashboard shell`, r.status === 200 && r.text.includes('DASHBOARD LAYOUT'), `HTTP ${r.status}`);
    }
    for (const route of ['/pricing', '/checkout']) {
      const r = await request('GET', route);
      check(`${route} serves the pricing landing shell`, r.status === 200 && r.text.includes('id="pricing"'), `HTTP ${r.status}`);
    }
    const forgot = await request('GET', '/forgot-password');
    check('/forgot-password serves the login shell', forgot.status === 200 && forgot.text.includes('Forgot password?'), `HTTP ${forgot.status}`);
    const health = await request('GET', '/api/health');
    check('/api/health returns JSON without an internal error', health.status === 200 && health.json && health.json.status, health.text);

    const spoofedStatus = await request('GET', '/api/status?email=pro%40x.com');
    check('anonymous status cannot spoof a Pro email', spoofedStatus.status === 200 && spoofedStatus.json.isSubscriber === false, spoofedStatus.text);
    const freeStatus = await request('GET', '/api/status?email=pro%40x.com', 'tokFree');
    check('free session wins over spoofed Pro query', freeStatus.json.isSubscriber === false, freeStatus.text);
    const proStatus = await request('GET', '/api/status', 'tokPro');
    check('authenticated Pro session is recognized', proStatus.json.isSubscriber === true, proStatus.text);

    const proTemplate = { layout: 'rSidebar', colors: { primary: '#0f172a', accent: '#38bdf8', light: '#e0f2fe' } };
    const docxSpoof = await request('POST', '/api/download-docx', null, { text: 'NAME\nSUMMARY\nEnough resume text for a document.', mode: 'resume', email: 'pro@x.com', primary: proTemplate });
    check('DOCX Pro access ignores a body-supplied subscriber email', docxSpoof.status === 402 && docxSpoof.json.error === 'pro_template', docxSpoof.text);

    const videoBody = { resume: 'NAME\nSUMMARY\nA sufficiently long resume body.', email: 'pro@x.com' };
    const anonVideo = await request('POST', '/api/resume-video', null, videoBody);
    check('anonymous video request is login-gated', anonVideo.status === 401, anonVideo.text);
    const freeVideo = await request('POST', '/api/resume-video', 'tokFree', videoBody);
    check('free user cannot spoof Pro video access', freeVideo.status === 402, freeVideo.text);
    check('anonymous video status is private', (await request('GET', '/api/resume-video/status/not-real')).status === 401);
    check('anonymous video download is private', (await request('GET', '/api/resume-video/file/not-real')).status === 401);

    const ats = await request('POST', '/api/ats-scan', null, { resume: 'resume', jobPosting: 'job' });
    check('anonymous ATS generation is publicly usable', ats.status === 200, ats.text);
    const linkedin = await request('POST', '/api/optimize-linkedin', null, { profileText: 'profile', targetRole: 'Engineer' });
    check('anonymous LinkedIn generation is publicly usable', linkedin.status === 200, linkedin.text);
    const share = await request('POST', '/api/share', null, { text: 'This is a long enough resume body to share publicly.' });
    check('anonymous share-link generation is login-gated', share.status === 401, share.text);

    const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.html'), 'utf8');
    check('DOCX export sends the resume photo, not the video-only photo', /photoUrl:\s*\(window\.rtResumePhoto\s*\|\|\s*undefined\)/.test(appSource));
    check('only Tailor and Cover Letter use the session-aware generation gate', appSource.includes('requireFreeActionLogin(tailor') && !appSource.includes('requireFreeActionLogin(optimizeLinkedIn') && !appSource.includes('requireFreeActionLogin(runDashboardATS'));
    check('free generators preserve and replay their pending action after login', /showAuthModal\('login', true\)/.test(appSource) && /setTimeout\(fn, 300\)/.test(appSource));
    const appCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'app.css'), 'utf8');
    check('New Tools leaves the mobile bottom controls visible', /#newToolsOverlay\s*\{[^}]*bottom:\s*calc\(62px/.test(appCss));
    check('creator tools hide the mobile controls only while immersive', /body\.wb-immersive:not\(\.wb-picker\)[\s\S]*body\.video-immersive\s+\.sidebar\s*\{\s*display:\s*none\s*!important/.test(appCss));
  } catch (err) {
    failures++;
    console.error(err && err.stack || err);
  } finally {
    server.close(() => {
      db.close();
      try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch (_) {}
      console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
      process.exitCode = failures ? 1 : 0;
    });
  }
});
