// Server-side rendering helper. Bundles the Remotion project once (cached for
// the life of the process) and renders an MP4 for a given set of input props.
//
// The heavy Remotion packages (@remotion/bundler, @remotion/renderer) and the
// headless browser are only loaded the first time a video is requested, so the
// rest of the server boots fine even if they are not installed.
const path = require('path');

let bundlePromise = null;
let cachedExecutable;

// By default, let Remotion download and use its own chrome-headless-shell — the
// standalone "old headless" implementation Chrome split out in v132. We
// deliberately do NOT auto-detect a system Chrome/Chromium on PATH anymore:
// recent Chromium builds (132+, e.g. the one nixpacks installs) removed old
// headless mode, so handing that binary to Remotion fails to launch with
// "Old Headless mode has been removed from the Chrome binary". The bundled
// chrome-headless-shell has no such problem. An explicit
// REMOTION_BROWSER_EXECUTABLE / CHROME_PATH still wins as an escape hatch.
function getBrowserExecutable() {
  if (cachedExecutable !== undefined) return cachedExecutable;
  cachedExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || process.env.CHROME_PATH || null;
  return cachedExecutable;
}

// Bundle the compositions to a static site Remotion can render from. Cached:
// bundling is the slow part and the output does not change between requests.
function getServeUrl() {
  if (!bundlePromise) {
    const { bundle } = require('@remotion/bundler');
    bundlePromise = bundle({
      entryPoint: path.resolve(__dirname, 'index.ts'),
      onProgress: () => {},
    }).catch((err) => {
      // Reset so a later request can retry instead of caching the failure.
      bundlePromise = null;
      throw err;
    });
  }
  return bundlePromise;
}

async function renderResumeVideo(inputProps, outputLocation, onProgress) {
  const { selectComposition, renderMedia, ensureBrowser } = require('@remotion/renderer');

  const browserExecutable = getBrowserExecutable();
  if (!browserExecutable) {
    // Downloads the Remotion headless browser shell on first use (no-op after).
    await ensureBrowser();
  }

  const serveUrl = await getServeUrl();
  const composition = await selectComposition({
    serveUrl,
    id: 'ResumeVideo',
    inputProps,
    browserExecutable: browserExecutable || undefined,
    // Cap the browser launch/eval so a stalled headless shell surfaces as an
    // error instead of hanging the request (and its one-at-a-time lock) forever.
    timeoutInMilliseconds: 60000,
  });

  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation,
    inputProps,
    browserExecutable: browserExecutable || undefined,
    // Headless-server hardening: software GL (no GPU on Railway), single
    // concurrency to stay within memory, and a generous frame timeout.
    concurrency: 1,
    chromiumOptions: { gl: 'swiftshader', headless: true },
    timeoutInMilliseconds: 120000,
    onProgress: onProgress ? ({ progress }) => onProgress(progress) : undefined,
  });

  return outputLocation;
}

module.exports = { renderResumeVideo, getServeUrl };
