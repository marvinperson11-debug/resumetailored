#!/usr/bin/env node
/**
 * MANUAL real-browser check of the signed-out DEMO resume viewer (not part of CI — it needs a browser, like
 * scripts/e2e-guest-cap.cjs). The unit tests (test-resume-viewer.cjs) cover logic in jsdom; this proves the parts
 * that only exist in a browser: PDF.js starts its worker, paints a real <canvas>, fetches the standard-font
 * substitutes for a PDF that embeds no fonts, and the fallback iframe appears when the worker is blocked.
 *
 * The feature ships OFF, so turn it on for the build you are checking:
 *   1. set RESUME_VIEWER_ENABLED = true in lib/resume-viewer-flag.ts (do not commit it)
 *   2. npm run build
 *   3. PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core CHROME_PATH=/path/to/chrome node scripts/e2e-resume-viewer.cjs
 * Prints one PASS/FAIL line per assertion and exits non-zero on any failure. Screenshots go to $E2E_OUT (default ./out).
 */
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const ROOT = path.resolve(__dirname, "..");
const MOCK = 4661, APP = 4660;
const OUT = path.resolve(process.env.E2E_OUT || "out");
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (name, ok, detail) => {
  if (ok) console.log("PASS ", name);
  else { failures++; console.error("FAIL ", name, detail !== undefined ? "— " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""); }
};

// A guest page touches no table, but the server still wants a Supabase URL to exist.
// page.screenshot() waits for document.fonts to settle, which it never does under the fake-Clerk setup; ask CDP directly.
async function shot(ctx, page, file) {
  const cdp = await ctx.newCDPSession(page);
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(file, Buffer.from(data, "base64"));
}

const mock = http.createServer((req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end("[]"); });

(async () => {
  await new Promise((r) => mock.listen(MOCK, "127.0.0.1", r));
  const env = {
    ...process.env, NODE_ENV: "production", PORT: String(APP), NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_Y2xlcmsuZXhhbXBsZS5jb20k", CLERK_SECRET_KEY: "sk_live_test_not_real",
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service",
    GUEST_QUOTA_SALT: "e2e-only-salt-0123456789", ANTHROPIC_API_KEY: "sk-ant-test",
  };
  const srv = spawn(process.execPath, [path.join(ROOT, "node_modules/next/dist/bin/next"), "start", "-p", String(APP)], { cwd: ROOT, env, stdio: "ignore" });
  for (let i = 0; i < 100; i++) { try { await fetch(`http://localhost:${APP}/api/health-probe`); break; } catch { await new Promise((r) => setTimeout(r, 300)); } }

  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ["--no-sandbox"] });
  try {
    for (const scenario of ["viewer", "fallback"]) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      // Clerk's script is left hanging on purpose (fake keys): an aborted one makes Clerk throw and the app error out.
      await ctx.route(/clerk\.example\.com/, () => {});
      await ctx.route(/googleapis|gstatic/, (r) => r.abort()); // web fonts: aborting (not hanging) lets screenshots complete
      if (scenario === "fallback") await ctx.route(/\/pdfjs\/pdf\.worker/, (r) => r.abort());
      const page = await ctx.newPage();
      const requests = [];
      const errors = [];
      page.on("response", (r) => requests.push({ url: r.url(), status: r.status() }));
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`http://localhost:${APP}/employer/candidates`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("[data-employer-pipeline]", { timeout: 30000 });
      // With fake Clerk keys the app's "Loading ResumeTailored…" splash never lifts and covers the page — drop it,
      // exactly as scripts/e2e-guest-cap.cjs does. (It is an artifact of the fake keys, not of the viewer.)
      const hideSplash = () => page.evaluate(() => document.querySelectorAll('[aria-label^="Loading ResumeTailored"]').forEach((d) => d.remove()));
      await hideSplash();
      const before = requests.map((r) => r.url);
      check(`[${scenario}] before opening a resume, PDF.js is not downloaded (no pdf-viewer chunk, no worker, no fonts)`, !before.some((u) => /pdfjs\//.test(u)), before.filter((u) => /pdfjs/.test(u)));

      const btn = page.getByRole("button", { name: "View resume" }).first();
      check(`[${scenario}] the demo shows a "View resume" button`, (await btn.count()) === 1);
      await hideSplash();
      await btn.click({ force: true });

      if (scenario === "viewer") {
        await page.waitForSelector("[data-pdf-viewer] canvas", { timeout: 30000 });
        await page.waitForFunction(() => { const c = document.querySelector("[data-pdf-viewer] canvas"); if (!c || !c.width) return false; const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4) if (d[i] < 120) return true; return false; }, null, { timeout: 30000 });
        const ink = await page.evaluate(() => { const c = document.querySelector("[data-pdf-viewer] canvas"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 140) n++; return { w: c.width, h: c.height, inkPct: (100 * n) / (c.width * c.height) }; });
        check("[viewer] the PDF is painted on a real canvas with real ink (text, not a blank page)", ink.inkPct > 0.3 && ink.inkPct < 40, ink);
        const worker = requests.find((r) => /\/pdfjs\/pdf\.worker\.min\.[\d.]+\.mjs$/.test(r.url));
        check("[viewer] the PDF.js worker was fetched from /pdfjs/ (a static file, version in the name) with 200", worker && worker.status === 200, worker);
        const pdfjsReqs = requests.filter((r) => /\/pdfjs\//.test(r.url));
        check("[viewer] every /pdfjs/ asset the viewer asked for (worker, and any CMap / standard font a PDF needs) came back 200", pdfjsReqs.length >= 1 && pdfjsReqs.every((r) => r.status === 200), pdfjsReqs);
        const pdfReq = requests.find((r) => /\/demo-resumes\/maya\.pdf$/.test(r.url));
        check("[viewer] the demo opens the checked-in fixture; no /api/employer call and no signed URL", pdfReq && pdfReq.status === 200 && !requests.some((r) => /\/api\/employer\//.test(r.url) || /supabase|\/object\/sign\//.test(r.url)), requests.filter((r) => /api|supabase/.test(r.url)));
        check("[viewer] two sample annotations are drawn over the page (a highlight and a note pin)", (await page.locator("[data-annotation]").count()) === 2 && (await page.locator("[data-annotation][data-kind=highlight]").count()) === 1 && (await page.locator("[data-annotation][data-kind=note]").count()) === 1);
        const box = await page.locator("[data-annotation][data-kind=highlight]").boundingBox();
        const pageBox = await page.locator("[data-page='1']").boundingBox();
        const rel = { x: (box.x - pageBox.x) / pageBox.width, y: (box.y - pageBox.y) / pageBox.height };
        check("[viewer] the highlight sits where its page-normalised coordinates say (x≈0.098, y≈0.261)", Math.abs(rel.x - 0.098) < 0.01 && Math.abs(rel.y - 0.2607) < 0.01, rel);
        check("[viewer] read-only: no Highlight / Add note tools and no colour swatches are offered", (await page.getByRole("button", { name: "Highlight", exact: true }).count()) === 0 && (await page.getByRole("button", { name: "Add note", exact: true }).count()) === 0 && (await page.getByRole("button", { name: "Yellow", exact: true }).count()) === 0);
        // try to draw a highlight anyway — straight into the page overlay
        await page.mouse.move(pageBox.x + pageBox.width * 0.2, pageBox.y + pageBox.height * 0.6);
        await page.mouse.down();
        await page.mouse.move(pageBox.x + pageBox.width * 0.6, pageBox.y + pageBox.height * 0.7, { steps: 6 });
        await page.mouse.up();
        check("[viewer] read-only: dragging on the page creates nothing", (await page.locator("[data-annotation]").count()) === 2 && (await page.locator("[data-draft-highlight]").count()) === 0);
        await hideSplash();
        await page.locator("[data-annotation][data-kind=highlight]").click({ force: true });
        check("[viewer] clicking a sample annotation shows its (translated) text and nothing editable", /Strong, quantified result/.test(await page.locator("[data-annotation-popover]").innerText()) && (await page.locator("[data-annotation-popover] textarea").count()) === 0);
        await shot(ctx, page, path.join(OUT, "resume-viewer-demo.png"));
        // zoom keeps the annotation glued to the words
        await hideSplash();
        await page.getByRole("button", { name: "Zoom in" }).click({ force: true });
        await page.waitForTimeout(600);
        const box2 = await page.locator("[data-annotation][data-kind=highlight]").boundingBox();
        const pageBox2 = await page.locator("[data-page='1']").boundingBox();
        check("[viewer] after zooming, the annotation still sits at the same page-normalised position", Math.abs((box2.x - pageBox2.x) / pageBox2.width - 0.098) < 0.01 && pageBox2.width > pageBox.width, { before: pageBox.width, after: pageBox2.width });
        check("[viewer] no uncaught page errors", errors.filter((e) => !/clerk/i.test(e)).length === 0, errors);
      } else {
        await page.waitForSelector("[data-resume-fallback] iframe", { timeout: 30000 });
        check("[fallback] with the PDF.js worker blocked, the browser's own viewer opens in an <iframe> on the SAME fixture PDF", /\/demo-resumes\/maya\.pdf$/.test(await page.locator("[data-resume-fallback] iframe").getAttribute("src")));
        check("[fallback] ...with a notice that highlights and notes are unavailable and a way back", /built-in PDF viewer/.test(await page.locator("[data-resume-fallback]").innerText()) && (await page.getByRole("button", { name: "Try the full viewer again" }).count()) === 1);
        await shot(ctx, page, path.join(OUT, "resume-viewer-fallback.png"));
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.kill();
    mock.close();
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
