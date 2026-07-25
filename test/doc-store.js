#!/usr/bin/env node
/**
 * Foundation test for the Website Builder editor (V3a).
 *
 * The undo/redo stack is built before the canvas, so it gets tested before the
 * canvas too. If these guarantees hold, the editor cannot corrupt a document or
 * lose a step no matter how the drag handlers are written on top.
 */
const S = require('../public/site-doc-store.js');

let fails = 0;
const ok = (name, cond, detail) => {
  if (cond) console.log(`PASS  ${name}`);
  else { fails++; console.error(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

const DOC = {
  v: 2, theme: { primary: '6366F1' },
  pages: [{
    id: 'home', name: 'Home', slug: 'home', isHome: true,
    sections: [{
      id: 's1', h: 400, bg: { type: 'color', value: '#fff' },
      els: [
        { id: 'e1', type: 'heading', x: 80, y: 40, w: 600, h: 90, props: { text: 'Hello' } },
        { id: 'e2', type: 'paragraph', x: 80, y: 160, w: 500, h: 60, props: { text: 'World' } },
      ],
    }],
  }],
};

// ── immutability ───────────────────────────────────────────────────────────
{
  const st = S.createStore(DOC);
  const d = st.getDoc();
  let threw = false;
  try { d.pages[0].sections[0].els[0].x = 999; } catch (_) { threw = true; }
  ok('getDoc() is frozen (write throws or is ignored)', threw || d.pages[0].sections[0].els[0].x === 80);

  // mutating the source object must not affect the store
  const src = JSON.parse(JSON.stringify(DOC));
  const st2 = S.createStore(src);
  src.pages[0].sections[0].els[0].x = 1;
  ok('store clones its input', st2.getDoc().pages[0].sections[0].els[0].x === 80);
}

// ── apply + undo/redo ──────────────────────────────────────────────────────
{
  const st = S.createStore(DOC);
  ok('starts with empty history', !st.canUndo() && !st.canRedo());

  st.apply((d) => { d.pages[0].sections[0].els[0].props.text = 'Changed'; });
  ok('apply commits a change', st.getDoc().pages[0].sections[0].els[0].props.text === 'Changed');
  ok('apply creates an undo step', st.canUndo());

  st.undo();
  ok('undo restores the previous revision', st.getDoc().pages[0].sections[0].els[0].props.text === 'Hello');
  ok('undo enables redo', st.canRedo());

  st.redo();
  ok('redo re-applies', st.getDoc().pages[0].sections[0].els[0].props.text === 'Changed');

  // a new change after undo clears the redo branch
  st.undo();
  st.apply((d) => { d.pages[0].sections[0].els[0].props.text = 'Divergent'; });
  ok('new edit after undo clears redo', !st.canRedo());
}

// ── no-op edits must not pollute history ───────────────────────────────────
{
  const st = S.createStore(DOC);
  const changed = st.apply((d) => { d.pages[0].sections[0].els[0].x = 80; }); // same value
  ok('no-op apply returns false', changed === false);
  ok('no-op apply creates no undo step', !st.canUndo());
}

// ── a throwing mutator leaves the store untouched ──────────────────────────
{
  const st = S.createStore(DOC);
  let threw = false;
  try { st.apply(() => { throw new Error('boom'); }); } catch (_) { threw = true; }
  ok('throwing mutator propagates', threw);
  ok('throwing mutator leaves doc unchanged', st.getDoc().pages[0].sections[0].els[0].props.text === 'Hello');
  ok('throwing mutator creates no undo step', !st.canUndo());
}

// ── gesture coalescing: a drag is ONE undo step ────────────────────────────
{
  const st = S.createStore(DOC);
  for (let x = 81; x <= 120; x++) {
    st.apply((d) => { d.pages[0].sections[0].els[0].x = x; }, { coalesce: 'move:e1' });
  }
  ok('drag moved the element', st.getDoc().pages[0].sections[0].els[0].x === 120);
  ok('drag collapsed into one undo step', st.depth().undo === 1, `undo depth ${st.depth().undo}`);
  st.undo();
  ok('undo reverts the whole drag', st.getDoc().pages[0].sections[0].els[0].x === 80);

  // a second gesture after endGesture() is a separate step
  const st2 = S.createStore(DOC);
  st2.apply((d) => { d.pages[0].sections[0].els[0].x = 90; }, { coalesce: 'move:e1' });
  st2.endGesture();
  st2.apply((d) => { d.pages[0].sections[0].els[0].x = 100; }, { coalesce: 'move:e1' });
  ok('endGesture() separates gestures', st2.depth().undo === 2, `undo depth ${st2.depth().undo}`);

  // dragging a different element is also a separate step
  const st3 = S.createStore(DOC);
  st3.apply((d) => { d.pages[0].sections[0].els[0].x = 90; }, { coalesce: 'move:e1' });
  st3.apply((d) => { d.pages[0].sections[0].els[1].x = 90; }, { coalesce: 'move:e2' });
  ok('different element = new undo step', st3.depth().undo === 2);
}

// ── history cap ────────────────────────────────────────────────────────────
{
  const st = S.createStore(DOC);
  for (let i = 0; i < S.HISTORY_LIMIT + 25; i++) {
    st.apply((d) => { d.pages[0].sections[0].els[0].x = 100 + i; });
  }
  ok('history is capped', st.depth().undo === S.HISTORY_LIMIT, `undo depth ${st.depth().undo}`);
}

// ── subscribers ────────────────────────────────────────────────────────────
{
  const st = S.createStore(DOC);
  const seen = [];
  const off = st.subscribe((d, meta) => seen.push(meta.reason));
  st.apply((d) => { d.pages[0].sections[0].els[0].x = 200; });
  st.undo();
  st.redo();
  ok('subscriber sees apply/undo/redo', seen.join(',') === 'apply,undo,redo', seen.join(','));
  off();
  st.apply((d) => { d.pages[0].sections[0].els[0].x = 300; });
  ok('unsubscribe stops notifications', seen.length === 3);

  // a throwing listener must not break the store
  const st2 = S.createStore(DOC);
  st2.subscribe(() => { throw new Error('bad listener'); });
  let broke = false;
  try { st2.apply((d) => { d.pages[0].sections[0].els[0].x = 5; }); } catch (_) { broke = true; }
  ok('throwing listener does not break apply', !broke && st2.getDoc().pages[0].sections[0].els[0].x === 5);
}

// ── replace (adopting a template) ──────────────────────────────────────────
{
  const st = S.createStore(DOC);
  st.replace({ v: 2, pages: [{ id: 'p', name: 'P', slug: 'p', isHome: true, sections: [] }] });
  ok('replace swaps the document', st.getDoc().pages[0].id === 'p');
  ok('replace is undoable', st.canUndo());
  st.undo();
  ok('undo after replace restores the original', st.getDoc().pages[0].id === 'home');
}

// ── document helpers ───────────────────────────────────────────────────────
{
  const hit = S.findElement(DOC, 'e2');
  ok('findElement locates an element with its section/page', !!hit && hit.el.type === 'paragraph' && hit.section.id === 's1' && hit.page.id === 'home');
  ok('findElement returns null for unknown id', S.findElement(DOC, 'nope') === null);
  let n = 0; S.eachElement(DOC, () => n++);
  ok('eachElement visits every element', n === 2);
  ok('newId generates unique ids', S.newId('e') !== S.newId('e'));
}

console.log(`\n${fails ? 'FAILED' : 'ALL PASS'} (${fails} failure${fails === 1 ? '' : 's'})`);
process.exit(fails ? 1 : 0);
