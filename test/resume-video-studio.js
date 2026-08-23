#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const page = fs.readFileSync(path.join(root, 'public', 'tools', 'resume-video.html'), 'utf8');
const landing = fs.readFileSync(path.join(root, 'public', 'resume-video-landing.html'), 'utf8');
const preview = fs.readFileSync(path.join(root, 'public', 'preview.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'resume-video-luxury.css'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
let failures = 0;
function check(name, ok) { if (ok) console.log('PASS', name); else { failures++; console.error('FAIL', name); } }

check('studio uses the exact navy, emerald, and gold palette', /--rv-navy:#0a1628/.test(css) && /--rv-emerald:#1a4d3a/.test(css) && /--rv-gold:#c9a227/.test(css));
check('studio has left tools, center preview, right AI and bottom timeline', /studio-rail[\s\S]*studio-stage[\s\S]*studio-rail studio-rail--right[\s\S]*scene-strip/.test(page));
check('resume text updates the embedded preview', /send\('resume'/.test(page) && /msg\.type === 'resume'/.test(preview));
check('file upload is size checked and sent to the preview parser', /5\*1024\*1024/.test(page) && /msg\.type === 'file'/.test(preview));
check('transport controls play, pause and seek the player', ['play','pause','seek'].every(x => page.includes(`send('${x}'`)) && /playerRef\.current/.test(preview));
check('voice and accent controls update the preview', /send\('voice'/.test(page) && /send\('accent'/.test(page) && /msg\.type === 'voice'/.test(preview) && /msg\.type === 'accent'/.test(preview));
check('embedded preview removes duplicate form chrome', /body\.is-embedded[\s\S]*\.panel/.test(preview) && /controls=\$\{!embedded\}/.test(preview));
check('Remotion license warning is acknowledged', /acknowledgeRemotionLicense/.test(preview));
check('public landing offers direct Pro and Lifetime checkout', /data-checkout-plan="pro"/.test(landing) && /data-checkout-plan="lifetime"/.test(landing));
check('public landing contains no creation interface', !/id="studioResume"|class="studio-workspace"/.test(landing));
check('studio and preview HTML are protected by subscriber routes', /app\.get\(\['\/video', '\/app\/video'\][\s\S]{0,260}!isSubscriber\(email\)/.test(server) && /app\.get\(\['\/preview', '\/preview\.html'\][\s\S]{0,260}!isSubscriber\(email\)/.test(server));
check('free dashboard navigation exits to the public explanation page', /name === 'video' && !isSubscriberFlag[\s\S]{0,120}location\.assign\('\/resume-video'\)/.test(fs.readFileSync(path.join(root, 'public', 'app.html'), 'utf8')));

if (failures) { console.error(`\nFAILED (${failures})`); process.exit(1); }
console.log('\nALL PASS (0 failures)');
