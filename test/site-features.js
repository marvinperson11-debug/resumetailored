#!/usr/bin/env node
/**
 * FORMS · MAPS · SOCIAL · ANIMATIONS · FONTS · BUTTONS
 *
 * Six features that all end up in the same place: a `style` attribute, a URL,
 * or an `<iframe src>` on a page the world can load. So most of what is checked
 * here is what happens to input that is wrong, hostile, or simply absent —
 * because the happy path is the easy half and the other half is where a
 * portfolio site starts serving something its owner never wrote.
 *
 * Usage: node test/site-features.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-feat-'));
process.env.RT_DISABLE_RATE_LIMIT = '1';
const { app, _renderPersonalSite } = require('../server.js');
const Database = require('better-sqlite3');

const db = new Database(path.join(process.env.DATA_DIR, 'resumetailor.db'));
db.prepare('INSERT INTO users (email,username,password_hash) VALUES (?,?,?)').run('a@x.com', 'alice', 'x');
db.prepare('INSERT INTO sessions (token,email) VALUES (?,?)').run('tokA', 'a@x.com');
db.prepare('INSERT INTO subscribers (email,customer_id) VALUES (?,?)').run('a@x.com', 'cA');

const RESUME = 'Alice Nakamura\nalice@example.com | Seattle\n\nSUMMARY\nEngineer.\n\nEXPERIENCE\nStaff Engineer\n• Did things\n\nSKILLS\nGo';

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

// One element, rendered. `sec` merges into the section, `opts` into the render.
const render = (el, sec, opts) => {
  const doc = {
    v: 2, lang: 'en', theme: Object.assign({ primary: '6366F1', accent: '8B5CF6' }, (opts && opts.theme) || {}),
    pages: [{ id: 'home', name: 'Home', slug: 'home', isHome: true,
      sections: [Object.assign({ id: 's1', h: 600, bg: { type: 'color', value: '#ffffff' },
        els: [Object.assign({ id: 'only', x: 40, y: 40, w: 400, h: 200 }, el)] }, sec || {})] }],
  };
  return _renderPersonalSite(
    { subdomain: 'feat', name: 'Alice', text: RESUME, accent: '8b5cf6', primary_hex: '4a1042', hide_contact: 0, config: JSON.stringify(doc) },
    'https://resumetailored.com',
    Object.assign({ indexable: true, footer: '' }, (opts && opts.render) || {}),
  );
};
const bodyOf = (h) => (h.match(/<body[^>]*>([\s\S]*)<\/body>/) || [])[1] || '';

const server = app.listen(0, async () => {
  const B = `http://127.0.0.1:${server.address().port}`;
  const AJ = { Authorization: 'Bearer tokA', 'Content-Type': 'application/json' };
  try {
    // ══ MAPS ═══════════════════════════════════════════════════════════════
    const map = bodyOf(render({ type: 'map', props: { address: '1 Market St, San Francisco', zoom: 15, label: 'Where I am' } }));
    check('a map renders an embed for the address given',
      /<iframe class="sd-map"[^>]*src="https:\/\/maps\.google\.com\/maps\?q=1%20Market%20St%2C%20San%20Francisco/.test(map), map.slice(0, 400));
    check('at the zoom the user chose', /&amp;z=15&amp;output=embed/.test(map));
    check('and lazily, so a map never delays the page', /loading="lazy"/.test(map));
    check('the label is shown above it', /Where I am/.test(map));

    /* An address is free text that lands in a URL and a title. Quotes and angle
       brackets must not be able to leave the attribute they are in — checked on
       the ELEMENT's own markup, because the page legitimately contains script
       tags elsewhere and a whole-document search would always fail. */
    const evilEl = (bodyOf(render({ type: 'map', props: { address: '" onload="alert(1)" x="<script>' } }))
      .match(/<iframe class="sd-map"[\s\S]*?<\/iframe>/) || [''])[0];
    check('an address cannot break out of the attribute it lands in',
      evilEl.length > 0 && !/ onload="/.test(evilEl) && !/<script>/.test(evilEl), evilEl);
    check('it is percent-encoded in the URL and entity-escaped in the title',
      /%22%20onload/.test(evilEl) && /&quot;/.test(evilEl) && /&lt;script&gt;/.test(evilEl), evilEl);

    check('zoom is clamped rather than trusted',
      /&amp;z=20&amp;/.test(bodyOf(render({ type: 'map', props: { address: 'Berlin', zoom: 9999 } })))
      && /&amp;z=1&amp;/.test(bodyOf(render({ type: 'map', props: { address: 'Berlin', zoom: -5 } }))));

    check('a map with no address is invisible to visitors',
      !/sd-map/.test(bodyOf(render({ type: 'map', props: {} }))));
    check('but the owner is told to add one',
      /Add an address/.test(bodyOf(render({ type: 'map', props: {} }, null, { render: { editable: true } }))));

    // ══ SOCIAL ═════════════════════════════════════════════════════════════
    const soc = bodyOf(render({ type: 'social', props: { display: 'icons', items: [
      { network: 'linkedin', url: 'marvinperson' },
      { network: 'github', url: 'https://github.com/someone' },
      { network: 'email', url: 'me@example.com' },
    ] } }));
    check('a bare handle becomes the right profile URL',
      /href="https:\/\/www\.linkedin\.com\/in\/marvinperson"/.test(soc), soc.slice(0, 500));
    check('a full URL is left exactly as pasted',
      /href="https:\/\/github\.com\/someone"/.test(soc));
    check('an email address becomes a mailto', /href="mailto:me@example\.com"/.test(soc));
    check('each one carries its real icon, not two letters of text',
      (soc.match(/<svg viewBox="0 0 24 24"/g) || []).length === 3, soc.slice(0, 300));
    check('and an accessible name a screen reader can use',
      /aria-label="LinkedIn"/.test(soc) && /aria-label="GitHub"/.test(soc));

    const socLink = bodyOf(render({ type: 'social', props: { display: 'link', items: [{ network: 'linkedin', url: 'marvinperson' }] } }));
    check('the same links can read as "Find me on LinkedIn" instead',
      /sd-soclink/.test(socLink) && /Find me on LinkedIn/.test(socLink), socLink.slice(0, 400));
    check('and switching between the two never loses the handle',
      /marvinperson/.test(socLink) && /marvinperson/.test(soc));

    const socBad = bodyOf(render({ type: 'social', props: { items: [
      { network: 'website', url: 'javascript:alert(1)' },
      { network: 'linkedin', url: 'ok-person' },
    ] } }));
    check('a javascript: URL is dropped, not rendered', !/javascript:/i.test(socBad), socBad.slice(0, 300));
    check('and the rest of the row still renders', /ok-person/.test(socBad));

    check('an unknown platform does not blank the element',
      /href="https:\/\/example\.com"/.test(bodyOf(render({ type: 'social', props: { items: [{ network: 'myspace', url: 'example.com' }] } }))));
    check('social with no handles yet is invisible to visitors',
      !/sd-socs|sd-soclinks/.test(bodyOf(render({ type: 'social', props: { items: [{ network: 'linkedin', url: '' }] } }))));

    // ══ BUTTONS ════════════════════════════════════════════════════════════
    const btn = bodyOf(render({ type: 'button', props: { text: 'Book a call', href: 'https://cal.com/me', color: '#e11d48' } }));
    check('a button links where it says', /href="https:\/\/cal\.com\/me"/.test(btn));
    check('an external link opens in a new tab, safely',
      /target="_blank" rel="noopener"/.test(btn));
    check('a chosen colour fills it', /background:#e11d48/.test(btn), btn.slice(0, 300));
    const ghost = bodyOf(render({ type: 'button', props: { text: 'Email me', href: 'mailto:a@b.com', style: 'ghost', color: '#0ea5e9' } }));
    /* An outline button coloured only on its background would be invisible —
       the colour has to move to the border and the text instead. */
    check('an outline button takes the colour on its edge and its text',
      /border-color:#0ea5e9;color:#0ea5e9/.test(ghost), ghost.slice(0, 300));
    check('a mailto button does not get target=_blank', !/mailto:a@b\.com"[^>]*target/.test(ghost));
    check('a bad colour is ignored rather than emitted',
      !/background:red;/.test(bodyOf(render({ type: 'button', props: { text: 'x', color: 'red; background:url(javascript:1)' } }))));

    // ══ FORMS ══════════════════════════════════════════════════════════════
    const dflt = bodyOf(render({ type: 'form', props: { mode: 'contact' } }));
    check('a form with no configuration still asks name, email and message',
      /name="name"/.test(dflt) && /name="email"/.test(dflt) && /<textarea name="message"/.test(dflt));

    const custom = bodyOf(render({ type: 'form', props: { fields: [
      { key: 'name', type: 'text', label: 'Your name' },
      { key: 'company', type: 'text', label: 'Company' },
      { key: 'role', type: 'text', label: 'Role you are hiring for' },
    ] } }));
    check('custom fields are rendered as configured',
      /name="company"[^>]*placeholder="Company"/.test(custom) && /name="role"/.test(custom), custom.slice(0, 600));
    /* THE ONE THING A FORM CANNOT LOSE. The server needs a valid visitor
       address to store a lead and to let the owner reply, so a form without an
       email field collects nothing — a user removing that row would be quietly
       breaking their own contact page. */
    check('an email field is inserted even when the document omits one',
      /<input type="email" name="email"[^>]*required/.test(custom), custom.slice(0, 600));
    check('and it is always required',
      /required/.test((custom.match(/<input type="email"[^>]*>/) || [''])[0]));

    const messy = bodyOf(render({ type: 'form', props: { fields: [
      { key: 'a b!@#', type: 'nonsense', label: '<img src=x onerror=alert(1)>' },
      { key: 'dup', type: 'text', label: 'One' },
      { key: 'dup', type: 'text', label: 'Two' },
    ] } }));
    check('a field name is sanitised to something submittable', /name="ab"/.test(messy), (messy.match(/name="[^"]*"/g) || []).join(' '));
    check('an unknown field type falls back to text rather than emitting itself',
      !/type="nonsense"/.test(messy));
    /* The label reaches a `placeholder` attribute. Escaping the angle brackets
       is what makes it text; the word "onerror" surviving inside that text is
       harmless and is not what to assert on. */
    check('a label cannot inject markup', !/<img/.test(messy) && /&lt;img/.test(messy), (messy.match(/placeholder="[^"]*"/g) || []).join(' '));
    check('duplicate keys collapse, so one answer cannot overwrite another',
      (messy.match(/name="dup"/g) || []).length === 1);

    // The round trip: a submission with custom fields reaches the owner's list.
    await fetch(`${B}/api/personal-site`, { method: 'POST', headers: AJ,
      body: JSON.stringify({ subdomain: 'feat', text: RESUME, name: 'Alice',
        config: { v: 2, pages: [{ id: 'home', slug: 'home', isHome: true, sections: [{ id: 's1', h: 400, els: [] }] }] }, publish: true }) });
    const lead = await fetch(`${B}/api/site-lead`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sub: 'feat', email: 'visitor@example.com', name: 'Sam', message: 'Hello',
        extra: { company: 'Northwind', role: 'Staff Engineer' } }) });
    check('a submission with custom fields is accepted', lead.status === 200);
    const mine = await (await fetch(`${B}/api/site-leads`, { headers: AJ })).json();
    const row = (mine.leads || [])[0];
    check('and reaches the owner with the custom answers intact',
      row && JSON.parse(row.extra || '{}').company === 'Northwind'
      && JSON.parse(row.extra || '{}').role === 'Staff Engineer', JSON.stringify(row));

    const junk = await fetch(`${B}/api/site-lead`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sub: 'feat', email: 'v2@example.com', extra: { ok: 'yes', bad: { nested: 1 }, 'we ird!': 'x' } }) });
    const after = await (await fetch(`${B}/api/site-leads`, { headers: AJ })).json();
    const j = JSON.parse((after.leads || [])[0].extra || '{}');
    check('a hostile extras payload is filtered, not stored whole',
      junk.status === 200 && j.ok === 'yes' && j.bad === undefined && j.weird === 'x', JSON.stringify(j));

    // ══ ANIMATIONS ═════════════════════════════════════════════════════════
    const anim = render({ type: 'heading', props: { text: 'Hi' } }, { anim: 'up' });
    check('a section that asks to animate says so in its markup',
      /<section class="sd-sec[^"]*sd-anim"[^>]*data-anim="up"/.test(anim), (anim.match(/<section[^>]*>/) || [''])[0]);
    /* The starting state is opacity:0. If it applied without the script, a
       visitor with JavaScript off — or a crawler — would be served a page whose
       content is permanently invisible. So it hangs off a class the script sets. */
    check('the invisible starting state is gated behind a class the script sets',
      /html\.sd-anim-on \.sd-anim\{opacity:0/.test(anim));
    check('and the script sets it', /sd-anim-on/.test(anim) && /IntersectionObserver/.test(anim));
    check('someone who asked for less motion gets none',
      /prefers-reduced-motion: reduce/.test(anim));
    check('content already on screen reveals without waiting for a scroll',
      /r\.top<innerHeight&&r\.bottom>0/.test(anim));

    /* Read the SECTION TAG, not the document: the animation stylesheet ships on
       every page whether anything uses it or not, so a whole-document search for
       "sd-anim" can never come back false. */
    const secTag = (h) => (h.match(/<section[^>]*>/) || [''])[0];
    check('no section animates unless it asked to',
      !/sd-anim/.test(secTag(render({ type: 'heading', props: { text: 'Hi' } }))),
      secTag(render({ type: 'heading', props: { text: 'Hi' } })));
    check('an unknown animation name is ignored rather than emitted',
      !/data-anim/.test(secTag(render({ type: 'heading', props: { text: 'Hi' } }, { anim: 'explode' }))),
      secTag(render({ type: 'heading', props: { text: 'Hi' } }, { anim: 'explode' })));
    /* Never on the canvas: an element that faded in on every re-render would
       flicker under the hands of whoever is editing it. */
    check('the editor never animates',
      !/data-anim/.test(secTag(render({ type: 'heading', props: { text: 'Hi' } }, { anim: 'up' }, { render: { editable: true } }))),
      secTag(render({ type: 'heading', props: { text: 'Hi' } }, { anim: 'up' }, { render: { editable: true } })));

    // ══ FONTS ══════════════════════════════════════════════════════════════
    const font = render({ type: 'heading', props: { text: 'Hi' } }, null, { theme: { fontHeading: 'playfair', fontBody: 'karla' } });
    check('a chosen heading font is requested', /family=Playfair\+Display/.test(font), (font.match(/fonts\.googleapis[^"]*/) || [''])[0]);
    check('and a chosen body font too', /family=Karla/.test(font));
    check('Inter is still requested, since the templates fall back to it',
      /family=Inter/.test(font));
    check('one stylesheet request, not three',
      (font.match(/fonts\.googleapis\.com\/css2/g) || []).length === 1);
    check('the heading font reaches headings', /--fh:'Playfair Display'/.test(font));
    check('the body font reaches the body', /--fb:'Karla'/.test(font) && /body\{font-family:var\(--fb\)/.test(font));

    /* A font name goes into a URL and a CSS font-family on a public page. A
       document that names something not on the list must not be able to decide
       what the page fetches. */
    const badFont = render({ type: 'heading', props: { text: 'Hi' } }, null,
      { theme: { fontHeading: 'Evil");@import url(//attacker.test/x.css);a{b:"' } });
    check('an unknown font falls back to Inter rather than being echoed',
      !/attacker\.test/.test(badFont) && /--fh:'Inter'/.test(badFont), (badFont.match(/--fh:[^;]*/) || [''])[0]);
    check('and nothing it contained reaches the stylesheet URL',
      !/attacker/.test((badFont.match(/fonts\.googleapis[^"]*/) || [''])[0]));

    check('a site that chose no fonts still gets Inter',
      /--fh:'Inter'/.test(render({ type: 'heading', props: { text: 'Hi' } })));
  } catch (e) {
    failures++;
    console.error('FAIL  unexpected error —', e && e.stack);
  }

  console.log(`\n${failures ? 'FAILED' : 'ALL PASS'} (${failures} failure${failures === 1 ? '' : 's'})`);
  server.close();
  db.close();
  try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch (_) {}
  process.exit(failures ? 1 : 0);
});
