#!/usr/bin/env node
/**
 * MANUAL real-browser check of the employer "Improve with AI" guest cap (not part of CI — it needs a
 * browser, like test/browser/editor.js in the root app). Starts `next start` (run `npm run build` first)
 * against mock Supabase + mock Claude, opens /employer/jobs?new=1 in Chromium as a fresh logged-out
 * visitor, taps "Improve with AI" three times, and prints what happened: the response status, the
 * Set-Cookie / Cookie headers, and whether the bottom cap prompt appeared.
 *
 *   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core CHROME_PATH=/path/to/chrome node scripts/e2e-guest-cap.cjs
 *
 * Expected: tap 1 -> 200 + Set-Cookie (rt_guest), no prompt; taps 2 and 3 -> 402 with the Cookie sent
 * back, and the "You've used today's free employer preview" prompt; exactly 1 Claude call.
 * (Clerk's script is left hanging on purpose: an aborted one makes Clerk throw and the app error out,
 * which is an artifact of fake keys, not of the page.)
 */
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
const ROOT = path.resolve(__dirname, "..");
const MOCK = 4651, APP = 4650;
const seen = { claude: 0, quotas: new Map() };
const mock = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const url = new URL(req.url, "http://x");
    const body = raw ? JSON.parse(raw) : {};
    const json = (c, v) => { res.writeHead(c, { "content-type": "application/json" }); res.end(JSON.stringify(v)); };
    if (url.pathname === "/v1/messages") { seen.claude++; return json(200, { id: "m", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: "POLISHED #" + seen.claude }], stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 100 } }); }
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      const fn = url.pathname.split("/").pop();
      const k = (id) => `${id}|${body.p_day}|${body.p_tool}`;
      if (fn === "guest_quota_reserve") {
        const g = seen.quotas.get(k(body.p_guest)) || 0; if (g >= body.p_limit) return json(200, "guest_cap");
        const ip = seen.quotas.get(k(body.p_ip_key)) || 0; if (ip >= body.p_ip_limit) return json(200, "ip_cap");
        seen.quotas.set(k(body.p_guest), g + 1); seen.quotas.set(k(body.p_ip_key), ip + 1); return json(200, "ok");
      }
      if (fn === "guest_quota_refund") { res.writeHead(204); return res.end(); }
      return json(200, 1);
    }
    json(200, []);
  });
});
(async () => {
  await new Promise((r) => mock.listen(MOCK, "127.0.0.1", r));
  const env = { ...process.env, NODE_ENV: "production", PORT: String(APP), NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_Y2xlcmsuZXhhbXBsZS5jb20k", CLERK_SECRET_KEY: "sk_live_test_not_real", NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: "a", SUPABASE_SERVICE_ROLE_KEY: "s", ANTHROPIC_API_KEY: "k", ANTHROPIC_BASE_URL: `http://127.0.0.1:${MOCK}`, GUEST_QUOTA_SALT: "test-only-guest-quota-salt-0123456789" };
  const srv = spawn(process.execPath, [path.join(ROOT, "node_modules/next/dist/bin/next"), "start", "-p", String(APP)], { cwd: ROOT, env, stdio: "ignore" });
  for (let i = 0; i < 100; i++) { try { await fetch(`http://localhost:${APP}/api/health-probe`); break; } catch { await new Promise((r) => setTimeout(r, 300)); } }
  const b = await chromium.launch({ executablePath: process.env.CHROME_PATH, args: ["--no-sandbox"] });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route(/clerk|googleapis|gstatic/, () => {});
  const pg = await ctx.newPage();
  const net = [];
  pg.on("response", async (r) => { if (r.url().includes("/api/employer/jobs/assist")) net.push({ status: r.status(), setCookie: (await r.allHeaders())["set-cookie"] || null, cookieSent: !!(await r.request().allHeaders())["cookie"] }); });
  await pg.goto(`http://localhost:${APP}/employer/jobs?new=1`, { waitUntil: "domcontentloaded" });
  await pg.waitForTimeout(3000);
  const hideGate = () => pg.evaluate(() => document.querySelectorAll("div").forEach((d) => { if (/Loading ResumeTailored/.test(d.textContent) && getComputedStyle(d).position === "fixed" && !d.querySelector("textarea") && d.children.length < 4) d.style.display = "none"; }));
  const area = pg.getByPlaceholder(/Rough notes/);
  const taps = [];
  for (let i = 1; i <= 3; i++) {
    await area.fill("We need a customer success manager who owns renewals and onboarding.");
    await hideGate();
    await pg.locator('button:has-text("Improve with AI")').click({ force: true });
    await pg.waitForTimeout(600);
    taps.push({ tap: i, result: (await area.inputValue()).slice(0, 24), capPrompt: await pg.locator("[data-guest-cap] h3").first().textContent().catch(() => null) });
    if (await pg.locator("[data-guest-later]").count()) await pg.locator("[data-guest-later]").click();
  }
  console.log(JSON.stringify({ taps, net, claudeCalls: seen.claude }, null, 2));
  const pass = net[0]?.status === 200 && !!net[0].setCookie && net[1]?.status === 402 && net[1].cookieSent && net[2]?.status === 402 && !!taps[1].capPrompt && seen.claude === 1;
  console.log(pass ? "PASS" : "FAIL");
  await b.close(); srv.kill(); mock.close();
  process.exit(pass ? 0 : 1);
})();
