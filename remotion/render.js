// Server-side rendering helper. Bundles the Remotion project once (cached for
// the life of the process) and renders an MP4 for a given set of input props.
//
// The heavy Remotion packages (@remotion/bundler, @remotion/renderer) and the
// headless browser are only loaded the first time a video is requested, so the
// rest of the server boots fine even if they are not installed.
const path = require('path');
const { execSync } = require('child_process');

let bundlePromise = null;
let cachedExecutable;

// Prefer a system Chromium (installed via nixpacks on Railway, see
// nixpacks.toml) so we don't depend on Remotion downloading a browser at
// runtime. Falls back to Remotion's own headless shell when none is found.
function getBrowserExecutable() {
  if (cachedExecutable !== undefined) return cachedExecutable;
  const fromEnv = process.env.REMOTION_BROWSER_EXECUTABLE || process.env.CHROME_PATH;
  if (fromEnv) {
    cachedExecutable = fromEnv;
    return cachedExecutable;
  }
  for (const bin of ['chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome']) {
    try {
      const found = execSync(`command -v ${bin}`, { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
      if (found) {
        cachedExecutable = found;
        return cachedExecutable;
      }
    } catch (_) {
      // not on PATH — try the next candidate
    }
  }
  cachedExecutable = null;
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
