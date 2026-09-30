#!/usr/bin/env node
/**
 * Message-catalog guard (runs in CI via `npm run lint:i18n`):
 *   1. every messages/<locale>.json has exactly the same keys as en.json
 *   2. placeholders ({name}) and rich-text tags (<strong>) match en for every key
 *      (ICU plural messages are exempt: their branches legitimately differ per language)
 *   3. every message formats with next-intl in its own locale (catches broken ICU
 *      syntax, e.g. a stray apostrophe before "{")
 * No new dependencies: next-intl is already installed.
 */
import fs from "node:fs";
import path from "node:path";
import { createTranslator } from "next-intl";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const LOCALES = ["en", "zh", "es", "hi", "fr"];
const load = (l) => JSON.parse(fs.readFileSync(path.join(ROOT, "messages", `${l}.json`), "utf8"));
const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, `${p}${k}.`) : [[`${p}${k}`, v]]));

const catalogs = Object.fromEntries(LOCALES.map((l) => [l, load(l)]));
const flats = Object.fromEntries(LOCALES.map((l) => [l, new Map(flat(catalogs[l]))]));
const errors = [];
const en = flats.en;

for (const l of LOCALES.slice(1)) {
  for (const k of en.keys()) if (!flats[l].has(k)) errors.push(`[${l}] missing key: ${k}`);
  for (const k of flats[l].keys()) if (!en.has(k)) errors.push(`[${l}] extra key (not in en): ${k}`);
}

const tokens = (s) => [...[...s.matchAll(/\{(\w+)/g)].map((m) => m[1]), ...[...s.matchAll(/<\/?(\w+)>/g)].map((m) => `<${m[1]}>`)].sort().join(",");
for (const [k, v] of en) {
  if (/plural,|select,/.test(v)) continue;
  for (const l of LOCALES.slice(1)) {
    const other = flats[l].get(k);
    if (typeof other === "string" && tokens(v) !== tokens(other)) errors.push(`[${l}] placeholder/tag mismatch: ${k}`);
  }
}

for (const l of LOCALES) {
  const t = createTranslator({ locale: l, messages: catalogs[l], onError: (e) => errors.push(`[${l}] ${e.message}`) });
  for (const [k, v] of flats[l]) {
    if (typeof v !== "string") continue;
    const values = Object.fromEntries([...v.matchAll(/\{(\w+)/g)].map((m) => [m[1], 1]));
    const tags = Object.fromEntries([...v.matchAll(/<(\w+)>/g)].map((m) => [m[1], (c) => c]));
    try {
      t.rich(k, { ...values, ...tags });
    } catch (e) {
      errors.push(`[${l}] cannot format ${k}: ${e.message}`);
    }
  }
}

if (errors.length) {
  console.error(errors.slice(0, 60).join("\n"));
  if (errors.length > 60) console.error(`… and ${errors.length - 60} more`);
  process.exit(1);
}
console.log(`messages OK: ${en.size} keys × ${LOCALES.length} locales — parity, placeholders and ICU formatting all pass.`);
