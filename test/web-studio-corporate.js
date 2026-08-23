#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
let failures = 0;
function check(name, ok) {
  if (ok) console.log('PASS', name);
  else { failures++; console.error('FAIL', name); }
}

const server = read('server.js');
const app = read('public/app.html');
const css = read('public/web-studio-luxury.css');

check('status publishes authoritative Web Studio entitlement', /webStudioAccess: hasWebStudioAccess\(email\)/.test(server));
check('Web Studio access follows job-seeker Pro, not an employer tier', /function hasWebStudioAccess\(email\) \{\s*return isSubscriber\(email\);/.test(server));
for (const route of ['personal-site', 'personal-site/autogen', 'personal-site/preview']) {
  const escaped = route.replace(/\//g, '\\/');
  check(`${route} route has Pro gate`, new RegExp(`app\\.post\\('/api/${escaped}'[\\s\\S]{0,260}hasWebStudioAccess\\(email\\)`).test(server));
}
check('site media upload has Pro gate', /app\.post\('\/api\/site-media'[\s\S]{0,700}hasWebStudioAccess\(email\)/.test(server));
check('locked users see the Pro teaser instead of a login redirect', /if \(!webStudioAccessFlag\) \{ showTab\('website'\); return; \}/.test(app));
check('teaser exposes direct Pro checkout', /Available in Pro/.test(app) && /data-checkout-plan="pro"/.test(app));
check('locked tab never initializes the editor', /name === 'website' && webStudioAccessFlag && typeof loadWebsiteCreator/.test(app) && /async function loadWebsiteCreator\(opts\) \{\s*if \(!webStudioAccessFlag\) return;/.test(app));
check('luxury palette uses exact brand colors', ['#0a1628', '#1a4d3a', '#c9a227'].every(color => css.includes(color)));
check('teaser uses a navy scrim and gold border', /ws-corporate-teaser::before/.test(css) && /border:1px solid var\(--ws-gold\)/.test(css));
check('Corporate does not grant or advertise Web Studio', !/webStudio:\s*true/.test(read('employer-hub.js')) && !/Corporate[\s\S]{0,180}Web Studio/.test(read('public/index.html')));

if (failures) { console.error(`\nFAILED (${failures})`); process.exit(1); }
console.log('\nALL PASS (0 failures)');
