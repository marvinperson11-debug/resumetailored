#!/usr/bin/env node
/**
 * Build-time installer for the Craft CLIs (run by craft/Dockerfile; also usable on a dev box).
 *   node install-tools.cjs [--lock versions.lock] [--dest /opt/craft]
 * For every entry in versions.lock: download releaseUrl, verify its SHA-256, extract it, and install the one
 * binary named `tool` to DEST/bin plus the archive's license/notice files to DEST/licenses/<tool>/.
 * A checksum mismatch, a missing binary or any download error exits 1 with a loud message — the image must
 * never build with an unpinned or swapped binary. Nothing here is committed to git; binaries live only in the image.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const LOCK = path.resolve(arg("--lock", path.join(__dirname, "versions.lock")));
const DEST = path.resolve(arg("--dest", "/opt/craft"));
const LICENSE_RE = /^(LICENSE|NOTICE|OFL|COPYING)/i;

const die = (msg) => {
  console.error(`\n!!! craft install FAILED: ${msg}\n`);
  process.exit(1);
};

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

async function download(url, file) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  const hash = crypto.createHash("sha256");
  const out = fs.createWriteStream(file);
  for await (const chunk of res.body) {
    hash.update(chunk);
    if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
  }
  await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
  return hash.digest("hex");
}

(async () => {
  let lock;
  try { lock = JSON.parse(fs.readFileSync(LOCK, "utf8")); } catch (e) { die(`cannot read ${LOCK}: ${e.message}`); }
  if (!Array.isArray(lock) || !lock.length) die(`${LOCK} must be a non-empty JSON array`);
  fs.mkdirSync(path.join(DEST, "bin"), { recursive: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "craft-install-"));
  try {
    for (const t of lock) {
      if (!/^[a-z0-9-]+$/.test(t.tool || "")) die(`bad tool name ${JSON.stringify(t.tool)}`);
      if (!/^[0-9a-f]{64}$/.test(t.sha256 || "")) die(`${t.tool}: sha256 must be 64 lowercase hex chars`);
      // CRAFT_INSTALL_ALLOW_HTTP=1 exists only so scripts/test-craft.cjs can serve a fake release from loopback.
      const scheme = process.env.CRAFT_INSTALL_ALLOW_HTTP === "1" ? /^https?:\/\// : /^https:\/\//;
      if (!scheme.test(t.releaseUrl || "") || !t.releaseUrl.includes(`/v${t.version}/`)) die(`${t.tool}: releaseUrl must be https and pinned to v${t.version}`);
      const archive = path.join(work, path.basename(new URL(t.releaseUrl).pathname));
      console.log(`craft: ${t.tool} ${t.version} <- ${t.releaseUrl}`);
      let got;
      try { got = await download(t.releaseUrl, archive); } catch (e) { die(`${t.tool}: download failed: ${e.message}`); }
      if (got !== t.sha256) die(`${t.tool} ${t.version}: CHECKSUM MISMATCH\n    expected ${t.sha256}\n    got      ${got}\n    Do not edit the lock to match without re-reviewing the release (see craft/README.md).`);
      console.log(`craft: ${t.tool} sha256 OK`);
      const x = path.join(work, t.tool);
      fs.mkdirSync(x);
      // --no-same-owner: running as root, tar would otherwise keep the release builder's uid/gid.
      execFileSync("tar", ["--no-same-owner", "-xzf", archive, "-C", x], { stdio: "inherit" });
      const files = walk(x);
      const bins = files.filter((f) => path.basename(f) === t.tool);
      if (bins.length !== 1) die(`${t.tool}: expected exactly one '${t.tool}' in the archive, found ${bins.length}`);
      const binDest = path.join(DEST, "bin", t.tool);
      fs.copyFileSync(bins[0], binDest);
      fs.chmodSync(binDest, 0o755);
      const licDir = path.join(DEST, "licenses", t.tool);
      fs.mkdirSync(licDir, { recursive: true });
      const lic = files.filter((f) => LICENSE_RE.test(path.basename(f)));
      if (!lic.length) die(`${t.tool}: no LICENSE/NOTICE files in the archive — refusing to ship it without its license`);
      for (const f of lic) fs.copyFileSync(f, path.join(licDir, path.basename(f)));
      fs.rmSync(x, { recursive: true, force: true });
      fs.rmSync(archive, { force: true });
      console.log(`craft: installed ${binDest} (+${lic.length} license files)`);
    }
    fs.copyFileSync(LOCK, path.join(DEST, "versions.lock"));
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
})().catch((e) => die(e && e.stack ? e.stack : String(e)));
