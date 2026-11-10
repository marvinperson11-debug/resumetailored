import { listTrainingDocs, createTrainingDoc, replaceTrainingDocContent } from "./training-store";
import type { TrainingDoc } from "./employee-hub";

/**
 * The onboarding paperwork packet's "handbook acknowledgment" item
 * deliberately reuses the Training Library's existing doc + acknowledgment
 * mechanism (lib/training-store.ts) rather than a new table — a `policy`
 * TrainingDoc with `requireSignature: true` and `assignTo: "all"` already IS
 * "the employer's own document, signed by the new hire, with the signature
 * + date stored" (Decision #4: ship a starter template AND let the employer
 * replace it). Replacing it is the existing Training tab's own edit/upload
 * flow for a `policy`-kind doc — not rebuilt here.
 */
const HANDBOOK_TITLE = "Employee Handbook";

const STARTER_HANDBOOK_HTML = `
<h2>Welcome</h2>
<p>This handbook covers the basics every new team member should know on day one. Your employer should replace this starter text with their own policies.</p>
<h2>Work hours and attendance</h2>
<p>Follow the schedule your manager gives you. Let your manager know as early as possible if you'll be late or absent.</p>
<h2>Conduct</h2>
<p>Treat coworkers and customers with respect. Harassment and discrimination of any kind are not tolerated.</p>
<h2>Safety</h2>
<p>Report unsafe conditions immediately. Complete any safety training assigned to you before starting hands-on work.</p>
<h2>Pay and benefits</h2>
<p>Pay schedule, benefits enrollment, and time-off policy details are provided separately by your employer.</p>
<p><em>By acknowledging this handbook, you confirm you have read and understood it.</em></p>
`.trim();

/** Idempotent: the employer's handbook policy doc, seeded with starter
 *  content on first use. There's no separate "this is THE handbook" flag on
 *  `training_docs`, so this is identified structurally — a `policy` doc
 *  requiring a signature, assigned to everyone — rather than by title, so
 *  that "replace it" (the Training tab's own delete + "New training item"
 *  flow, there is no in-place edit route) is picked up under any title the
 *  employer gives it, not just the seeded one. Returns null if Supabase
 *  isn't configured (same best-effort contract as every store in this
 *  area) — the caller treats that as "no handbook assigned" rather than
 *  throwing. */
export async function getOrCreateHandbookDoc(employerId: string): Promise<TrainingDoc | null> {
  const docs = await listTrainingDocs(employerId);
  const existing = docs.find((d) => d.docKind === "policy" && d.requireSignature && d.assignTo === "all");
  if (existing) return existing;
  return createTrainingDoc(employerId, { title: HANDBOOK_TITLE, docKind: "policy", bodyHtml: STARTER_HANDBOOK_HTML, assignTo: "all", requireSignature: true });
}

/** Replace the handbook's content in place, bumping its version (Corporate
 *  only — lib/employer-plan.ts `canManageHandbookVersions`). Unlike the
 *  generic Training tab's delete-then-recreate, this keeps the SAME doc row
 *  (and so every past acknowledgment, each already carrying the version IT
 *  was signed under — see migration 0097) rather than losing the handbook's
 *  signing history the moment it's updated. Creates the starter doc first
 *  if somehow none exists yet. Returns null on an empty body (never clears
 *  the handbook to nothing). */
export async function replaceHandbookDoc(employerId: string, bodyHtml: string): Promise<TrainingDoc | null> {
  const html = (bodyHtml || "").trim();
  if (!html) return null;
  const doc = await getOrCreateHandbookDoc(employerId);
  if (!doc) return null;
  return replaceTrainingDocContent(employerId, doc.id, { bodyHtml: html });
}
