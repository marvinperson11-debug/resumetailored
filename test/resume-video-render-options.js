#!/usr/bin/env node
/**
 * Resume Video render options contract (background colour, slide timings from TTS timestamps, headshot overlay,
 * quick pacing): validation is strict and every field is optional. Pure — no render. The visual proof (real
 * renders, frames inspected) lives in test/browser/resume-video-render-options.js, which is run by hand.
 */
const fs = require('fs');
const path = require('path');
const { parseRenderOptions } = require('../remotion/renderOptions');
const { syncedTotalFrames, sceneFrames, FPS } = require('../remotion/data');
let failures = 0;
const check = (n, c, d) => { if (c) console.log('PASS  ' + n); else { failures++; console.error('FAIL  ' + n + (d ? ' — ' + d : '')); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

check('nothing given → nothing set (the site\'s own videos are unchanged)', eq(parseRenderOptions({}), {}) && eq(parseRenderOptions(undefined), {}));
check('valid background colour is kept, lower-cased', parseRenderOptions({ backgroundColor: '#10223A' }).backgroundColor === '#10223a');
check('invalid background colours are ignored', ['red', '#fff', '#12345', '#GGGGGG', 'url(x)', 12, null].every((v) => parseRenderOptions({ backgroundColor: v }).backgroundColor === undefined));
check('valid sceneStarts kept', eq(parseRenderOptions({ sceneStarts: [0, 3.2, 6, 9.5] }).sceneStarts, [0, 3.2, 6, 9.5]));
check('sceneStarts must be 4 numbers starting at 0, non-decreasing, finite',
  [[0, 1, 2], [1, 2, 3, 4], [0, 3, 2, 5], [0, 1, 2, NaN], [0, 1, 2, 9999], 'abc', null, [0, -1, 2, 3]].every((v) => parseRenderOptions({ sceneStarts: v }).sceneStarts === undefined));
check('photoOverlay position is clamped to the frame and everySlide is strictly boolean',
  eq(parseRenderOptions({ photoOverlay: { x: 1.4, y: -0.2, everySlide: 'yes' } }).photoOverlay, { x: 1, y: 0, everySlide: false }) &&
  eq(parseRenderOptions({ photoOverlay: { x: 0.25, y: 0.5, everySlide: true } }).photoOverlay, { x: 0.25, y: 0.5, everySlide: true }));
check('photoOverlay without numeric x/y is ignored', parseRenderOptions({ photoOverlay: { x: 'a', y: 1 } }).photoOverlay === undefined && parseRenderOptions({ photoOverlay: 5 }).photoOverlay === undefined);
check('quick is only true for boolean true', parseRenderOptions({ quick: true }).quick === true && parseRenderOptions({ quick: 'true' }).quick === undefined);
check('unknown fields are dropped', eq(parseRenderOptions({ evil: 1, backgroundColor: '#000000' }), { backgroundColor: '#000000' }));

const q = sceneFrames(3, FPS, true), n = sceneFrames(3, FPS);
check('default timing is unchanged; quick is tighter', n.total === sceneFrames(3, FPS, false).total && q.total < n.total && q.intro < n.intro && q.skills < n.skills);
check('synced length = narration + a short hold, never shorter than the close slide', syncedTotalFrames([0, 3, 6, 9], 330, FPS) === 330 + 15 && syncedTotalFrames([0, 3, 6, 9], 100, FPS) === 9 * 30 + 36);

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
check('the render route merges the validated options', /parseRenderOptions\(req\.body\)/.test(server));
check('the composition resets the theme when no colour is given (site videos keep their look)', /applyThemeFor\(props\.backgroundColor\)/.test(fs.readFileSync(path.join(__dirname, '..', 'remotion', 'ResumeVideo.tsx'), 'utf8')));

console.log(failures ? `\nFAILED (${failures} failure${failures === 1 ? '' : 's'})` : '\nALL PASS (0 failures)');
process.exit(failures ? 1 : 0);
