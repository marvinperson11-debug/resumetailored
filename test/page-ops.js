#!/usr/bin/env node
/**
 * Page-operations test (V5).
 *
 * Multi-page management is where a builder quietly corrupts documents: two pages
 * claiming to be home, duplicate slugs colliding in the URL, a duplicated page
 * sharing element ids with its original, or deleting the last page and leaving a
 * site with nothing to render. These are pure document mutators, so all of that
 * is testable without a browser.
 */
const S = require('../public/site-doc-store.js');

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { fails++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const baseDoc = () => ({
  v: 2, theme: {},
  pages: [
    { id: 'p1', name: 'Home', slug: 'home', isHome: true, seo: {}, sections: [{ id: 's1', h: 400, els: [{ id: 'e1', type: 'heading', x: 0, y: 0, w: 100, h: 50, props: { text: 'Hi' } }] }] },
    { id: 'p2', name: 'Work', slug: 'work', isHome: false, seo: {}, sections: [{ id: 's2', h: 400, els: [] }] },
  ],
});
const homes = (d) => d.pages.filter((p) => p.isHome).length;

// ── slugify ────────────────────────────────────────────────────────────────
{
  ok('slugify lowercases and dashes', S.slugify('About Me!') === 'about-me');
  ok('slugify strips leading/trailing dashes', S.slugify('  --Hello--  ') === 'hello');
  ok('slugify falls back for empty input', S.slugify('') === 'page');
  ok('slugify handles non-latin input', S.slugify('关于我') === 'page');
  ok('slugify dedupes against taken slugs', S.slugify('Work', ['work']) === 'work-2');
  ok('slugify dedupes repeatedly', S.slugify('Work', ['work', 'work-2']) === 'work-3');
  ok('slugify avoids reserved words', S.RESERVED_SLUGS.every((r) => S.slugify(r) !== r), 'a reserved slug leaked through');
  ok('slugify caps length', S.slugify('x'.repeat(200)).length <= 40);
}

// ── addPage ────────────────────────────────────────────────────────────────
{
  const d = baseDoc();
  const id = S.addPage(d, 'About Me');
  ok('addPage appends a page', d.pages.length === 3 && d.pages[2].id === id);
  ok('addPage slugifies the name', d.pages[2].slug === 'about-me');
  ok('addPage is not home when others exist', d.pages[2].isHome === false && homes(d) === 1);
  ok('addPage starts with one section', d.pages[2].sections.length === 1);
  // A brand-new page must not be a navigational dead end.
  const seeded = d.pages[2].sections[0].els.map((e) => e.type);
  ok('addPage seeds a nav element', seeded.includes('nav'));
  ok('addPage seeds a heading using the page name', seeded.includes('heading') && d.pages[2].sections[0].els.filter((e) => e.type === 'heading')[0].props.text === 'About Me');
  ok('seeded elements have unique ids', new Set(d.pages[2].sections[0].els.map((e) => e.id)).size === seeded.length);

  const empty = { v: 2, pages: [] };
  S.addPage(empty, 'First');
  ok('first page in an empty doc becomes home', empty.pages[0].isHome === true);

  const dupe = baseDoc();
  S.addPage(dupe, 'Work');
  ok('addPage avoids slug collisions', dupe.pages[2].slug === 'work-2');
}

// ── rename / slug ──────────────────────────────────────────────────────────
{
  const d = baseDoc();
  S.renamePage(d, 'p2', 'Portfolio');
  ok('renamePage changes the name', d.pages[1].name === 'Portfolio');
  ok('renamePage leaves the slug alone (URLs are stable)', d.pages[1].slug === 'work');
  ok('renamePage rejects an unknown id', S.renamePage(d, 'nope', 'X') === false);
  ok('renamePage ignores an empty name', S.renamePage(d, 'p2', '') && d.pages[1].name === 'Portfolio');

  S.setPageSlug(d, 'p2', 'My Portfolio!');
  ok('setPageSlug slugifies', d.pages[1].slug === 'my-portfolio');
  S.setPageSlug(d, 'p2', 'home');
  ok('setPageSlug avoids colliding with another page', d.pages[1].slug === 'home-2');
}

// ── duplicatePage ──────────────────────────────────────────────────────────
{
  const d = baseDoc();
  const id = S.duplicatePage(d, 'p1');
  ok('duplicatePage inserts right after the original', d.pages.length === 3 && d.pages[1].id === id);
  ok('duplicate is never home', d.pages[1].isHome === false && homes(d) === 1);
  ok('duplicate gets a unique slug', d.pages[1].slug !== 'home' && new Set(d.pages.map((p) => p.slug)).size === 3);
  ok('duplicate gets fresh section ids', d.pages[1].sections[0].id !== 's1');
  ok('duplicate gets fresh element ids', d.pages[1].sections[0].els[0].id !== 'e1');
  ok('duplicate copies content', d.pages[1].sections[0].els[0].props.text === 'Hi');
  // deep copy, not aliased
  d.pages[1].sections[0].els[0].props.text = 'Changed';
  ok('duplicate is a deep copy', d.pages[0].sections[0].els[0].props.text === 'Hi');
  ok('duplicatePage rejects an unknown id', S.duplicatePage(d, 'nope') === null);
}

// ── deletePage ─────────────────────────────────────────────────────────────
{
  const d = baseDoc();
  ok('deletePage removes a non-home page', S.deletePage(d, 'p2') === true && d.pages.length === 1);
  ok('deletePage refuses to remove the last page', S.deletePage(d, 'p1') === false && d.pages.length === 1);

  const d2 = baseDoc();
  S.deletePage(d2, 'p1'); // delete the home page
  ok('deleting home reassigns home to another page', homes(d2) === 1 && d2.pages[0].isHome === true);
  ok('deletePage rejects an unknown id', S.deletePage(baseDoc(), 'nope') === false);
}

// ── movePage ───────────────────────────────────────────────────────────────
{
  const d = baseDoc();
  ok('movePage reorders', S.movePage(d, 'p2', -1) === true && d.pages[0].id === 'p2');
  ok('movePage clamps at the start', S.movePage(d, 'p2', -5) === false);
  const d2 = baseDoc();
  ok('movePage clamps at the end', S.movePage(d2, 'p2', 5) === false);
  ok('movePage does not change home', homes(d) === 1);
  ok('movePage rejects an unknown id', S.movePage(d, 'nope', 1) === false);
}

// ── setHome ────────────────────────────────────────────────────────────────
{
  const d = baseDoc();
  S.setHome(d, 'p2');
  ok('setHome moves the flag', d.pages[1].isHome === true && d.pages[0].isHome === false);
  ok('setHome keeps exactly one home', homes(d) === 1);
  ok('setHome rejects an unknown id', S.setHome(d, 'nope') === false && homes(d) === 1);
}

// ── setPageSeo ─────────────────────────────────────────────────────────────
{
  const d = baseDoc();
  S.setPageSeo(d, 'p1', { title: 'My Home', description: 'Welcome' });
  ok('setPageSeo stores title/description', d.pages[0].seo.title === 'My Home' && d.pages[0].seo.description === 'Welcome');
  S.setPageSeo(d, 'p1', { title: 'x'.repeat(500) });
  ok('setPageSeo caps title length', d.pages[0].seo.title.length === 120);
  ok('setPageSeo leaves untouched fields alone', d.pages[0].seo.description === 'Welcome');
  ok('setPageSeo rejects an unknown id', S.setPageSeo(d, 'nope', { title: 'x' }) === false);
}

// ── integration with the store: page ops are undoable ──────────────────────
{
  const st = S.createStore(baseDoc());
  st.apply((d) => { S.addPage(d, 'Contact'); });
  ok('page op through the store commits', st.getDoc().pages.length === 3);
  st.undo();
  ok('page op is undoable', st.getDoc().pages.length === 2);
  st.redo();
  ok('page op is redoable', st.getDoc().pages.length === 3);

  // a refused op (deleting the last page) must not create an undo step
  const st2 = S.createStore({ v: 2, pages: [{ id: 'only', name: 'Only', slug: 'only', isHome: true, seo: {}, sections: [] }] });
  st2.apply((d) => { S.deletePage(d, 'only'); });
  ok('refused delete creates no undo step', !st2.canUndo() && st2.getDoc().pages.length === 1);
}

console.log(`\n${fails ? 'FAILED' : 'ALL PASS'} (${fails} failure${fails === 1 ? '' : 's'})`);
process.exit(fails ? 1 : 0);
