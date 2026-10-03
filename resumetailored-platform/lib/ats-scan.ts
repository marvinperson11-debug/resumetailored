import { sanitizeKeywords } from "./keywords";
import { getAnthropic, buildAtsPrompt, localAtsFallback, isProviderUnavailable, CLAUDE_MODEL, type AtsResult } from "./ai";

/**
 * One ATS scoring pass — the logic behind /api/ats-scan, shared with the Pro
 * "ATS rewrite report" so both use the same prompt, model, keyword cleanup and
 * deterministic fallback. Falls back to the local keyword-overlap score when no
 * key is configured or the provider is overloaded; any other failure throws.
 */
export async function scoreResume(resume: string, jobPosting: string): Promise<AtsResult> {
  const anthropic = getAnthropic();
  if (!anthropic) return localAtsFallback(resume, jobPosting);
  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content: buildAtsPrompt(resume, jobPosting) }],
    });
    const block = msg.content[0];
    const raw = (block && block.type === "text" ? block.text : "").trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");
    const result = JSON.parse(jsonMatch[0]) as AtsResult;
    // Drop non-skill tokens (names, fragments) the model occasionally echoes.
    result.missing = sanitizeKeywords(result.missing, jobPosting);
    result.matched = sanitizeKeywords(result.matched, jobPosting);
    return result;
  } catch (err) {
    if (isProviderUnavailable(err)) return localAtsFallback(resume, jobPosting);
    throw err;
  }
}

function count(text: string, keyword: string): number {
  const k = keyword.trim().toLowerCase();
  if (!k) return 0;
  const hay = text.toLowerCase();
  let n = 0;
  for (let i = hay.indexOf(k); i !== -1; i = hay.indexOf(k, i + k.length)) n++;
  return n;
}

export interface AtsReport {
  before: { score: number; verdict: string };
  after: { score: number; verdict: string };
  delta: number;
  /** Job keywords the original resume was missing that the tailored one now contains. */
  added: string[];
  /** Keywords already present that the tailored version now uses more prominently. */
  strengthened: { keyword: string; before: number; after: number }[];
  /** Job keywords still absent after tailoring (only add where truthful). */
  stillMissing: string[];
  fallback: boolean;
}

/** Pure keyword delta between two scans of the original and tailored resume. */
export function buildAtsReport(before: AtsResult, after: AtsResult, originalText: string, tailoredText: string): AtsReport {
  const norm = (a: string[]) => (Array.isArray(a) ? a : []).map((s) => String(s).trim()).filter(Boolean);
  const beforeMatched = new Set(norm(before.matched).map((s) => s.toLowerCase()));
  const afterMatched = norm(after.matched);
  const added = afterMatched.filter((k) => !beforeMatched.has(k.toLowerCase())).slice(0, 15);
  const strengthened = afterMatched
    .filter((k) => beforeMatched.has(k.toLowerCase()))
    .map((k) => ({ keyword: k, before: count(originalText, k), after: count(tailoredText, k) }))
    .filter((x) => x.after > x.before)
    .slice(0, 10);
  return {
    before: { score: before.score, verdict: before.verdict },
    after: { score: after.score, verdict: after.verdict },
    delta: after.score - before.score,
    added,
    strengthened,
    stillMissing: norm(after.missing).slice(0, 8),
    fallback: !!(before.fallback || after.fallback),
  };
}
