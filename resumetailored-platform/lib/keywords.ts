/**
 * Keyword sanitizer for match / ATS output.
 *
 * The deterministic fallbacks tokenize raw text, so they surfaced company and
 * person names ("amiad") and other non-skill fragments as "missing keywords".
 * There is no dictionary in the bundle, so this is a conservative heuristic:
 * keep anything that looks like a real skill/term, drop what is clearly not.
 */

/** Short / unusual-looking terms that ARE legitimate skills — never dropped. */
const KEEP = new Set(
  "sql css html aws gcp api apis sdk ui ux qa seo sem crm erp etl ci cd php c++ c# go r js ts node react vue java python ruby rust kafka redis docker k8s git jira figma excel tableau ios android saas b2b b2c kpi okr roi ml ai llm nlp agile scrum lean".split(/\s+/)
);

/** True when the token is almost certainly not a skill/keyword. */
export function isJunkKeyword(word: string, sourceText = ""): boolean {
  const w = String(word || "").trim().toLowerCase();
  if (!w) return true;
  if (KEEP.has(w)) return false;
  if (w.length < 3) return true;
  if (/^\d+$/.test(w) || /^[a-z]+\d{3,}$/.test(w)) return true; // numbers, ids, hashes
  if (/(.)\1{3,}/.test(w)) return true; // "aaaa"
  if (!/[aeiouy]/.test(w) && !/[+#]/.test(w)) return true; // no vowels: "xkcd", "hmm"
  // Proper nouns (company / person names) only ever appear capitalized in the
  // source and are never skills. Only applied when we can see the source.
  if (sourceText) {
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const all = sourceText.match(new RegExp(`\\b${esc}\\b`, "gi")) || [];
    if (all.length > 0 && all.length <= 2 && all.every((m) => m[0] === m[0].toUpperCase() && m !== m.toUpperCase())) {
      // Capitalized at a sentence start is ambiguous, so require that it is
      // never preceded by sentence punctuation / a newline.
      const lead = new RegExp(`(^|[.!?\\n]\\s*)${esc}\\b`, "i");
      if (!lead.test(sourceText)) return true;
    }
  }
  return false;
}

/** Drop junk tokens from a keyword list, preserving order and de-duplicating. */
export function sanitizeKeywords(list: unknown, sourceText = ""): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const k = String(item ?? "").trim();
    const key = k.toLowerCase();
    if (!k || seen.has(key)) continue;
    // Multi-word phrases are judged by their words: drop only if every word is junk.
    const words = k.split(/\s+/);
    if (words.every((w) => isJunkKeyword(w, sourceText))) continue;
    seen.add(key);
    out.push(k);
  }
  return out;
}
