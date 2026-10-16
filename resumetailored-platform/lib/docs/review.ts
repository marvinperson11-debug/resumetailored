/**
 * Per-item review status for the batch status API, in the same { kind, code, message } shape as an item's
 * recorded errors[] (and so as the smoke harness's DIAG echo). Lets a user see why an item is incomplete without
 * opening _REVIEW_REQUIRED.txt inside the ZIP. Pure; fed straight from the stored row.
 */
export interface ReviewEntry {
  kind: string;
  code: string;
  message: string;
}

export function itemReview(flags: unknown, errors: unknown): ReviewEntry[] {
  const out: ReviewEntry[] = [];
  const f = (Array.isArray(flags) ? flags : []) as { message?: unknown }[];
  const msgs = f.map((x) => (typeof x?.message === "string" ? x.message : "")).filter(Boolean);
  // A resume with unverified details is withheld (runner.ts); same wording as the ZIP's review note.
  if (f.length) out.push({ kind: "resume", code: "needs_review", message: `Resume withheld. ${msgs.join(" ")}`.trim() });
  for (const e of (Array.isArray(errors) ? errors : []) as { kind?: unknown; code?: unknown; message?: unknown }[]) {
    if (!e || typeof e !== "object") continue;
    out.push({ kind: String(e.kind ?? "run"), code: String(e.code ?? "failed"), message: String(e.message ?? "") });
  }
  return out;
}
