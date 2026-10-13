#!/usr/bin/env node
/**
 * Publishes what the resume viewer needs at runtime to public/pdfjs/ (gitignored, rebuilt on every
 * `npm run dev` / `npm run build` via the pre-hooks): the PDF.js worker, the CMaps that let CJK fonts decode, and
 * the standard-font substitutes used when a PDF does not embed its fonts. ~2.5 MB on disk, but fetched by a
 * visitor only if a PDF actually needs a given file — and only on the employer candidate page.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const pkg = dirname(require.resolve("pdfjs-dist/package.json"));
const out = join(root, "public", "pdfjs");
rmSync(out, { recursive: true, force: true });
for (const dir of ["cmaps", "standard_fonts"]) {
  const from = join(pkg, dir);
  if (!existsSync(from)) throw new Error(`pdfjs-dist is missing ${dir}/ (${from})`);
  mkdirSync(join(out, dir), { recursive: true });
  cpSync(from, join(out, dir), { recursive: true });
}
// The worker is published as a plain static file rather than bundled: webpack would emit it as a hashed asset and
// Next's Terser pass then fails parsing its `export` statements. The version is in the file name so a PDF.js upgrade
// can never pair a new API with a cached old worker (PDF.js refuses mismatched halves — the viewer would fall back).
const version = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")).version;
cpSync(join(pkg, "legacy", "build", "pdf.worker.min.mjs"), join(out, `pdf.worker.min.${version}.mjs`));
console.log(`copy-pdfjs-assets: public/pdfjs ready (worker ${version})`);
