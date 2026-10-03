import { OUT_TPLS } from "./resume-templates";

/**
 * Server-side template allow-list. The Platform's templates are colour/layout
 * variants identified by id; only the ones flagged `free: true` in the catalog
 * (Classic r1, Executive r5, Minimal r17; Formal c1, Bold c5, Clean c17) are
 * available without Pro. Mirrors Legacy `FREE_TPL_SIGS` (server.js:6539-6554).
 * An unknown id is NOT free, so a crafted id can never slip through.
 */
const FREE_IDS: Set<string> = new Set(
  [...OUT_TPLS.resume, ...OUT_TPLS.cover].filter((t) => t.free).map((t) => t.id)
);

export function isFreeTemplateId(id: unknown): boolean {
  return typeof id === "string" && FREE_IDS.has(id);
}

export const PRO_TEMPLATE_MESSAGE = "This template is Pro-only. Upgrade to unlock all templates, or pick a free template.";

/** True when every supplied id may be used by a non-Pro account. Empty/undefined ids are ignored. */
export function allTemplatesFree(ids: unknown[]): boolean {
  return ids.filter((i) => i !== undefined && i !== null && i !== "").every(isFreeTemplateId);
}
