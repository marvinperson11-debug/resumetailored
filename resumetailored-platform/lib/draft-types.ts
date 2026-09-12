/**
 * Shared, dependency-free DTOs for resume drafts (FIX 7 #6/#7, FIX 8). Kept in
 * their own module so both client components and the server (Supabase) layer can
 * import them without pulling server-only code into the browser bundle.
 */

/** Everything needed to fully restore the AI Resume Builder for a saved draft. */
export interface ResumeDraftContent {
  resumeText: string;
  jobText: string;
  result: string;
  tplId: string;
  docFont?: string;
  sigFont?: string;
  signature?: string;
  photo?: string; // data URL (kept small — capped client-side)
  accentColor?: string; // custom accent hex (#rrggbb); overrides the template's color
}

/** One saved resume, as returned by the drafts API and shown in "My Resumes". */
export interface ResumeDraft {
  id: string; // client-generated id, stable across autosaves
  title: string; // job title / label
  updatedAt: string; // ISO timestamp
  content: ResumeDraftContent;
}

export function emptyDraftContent(): ResumeDraftContent {
  return { resumeText: "", jobText: "", result: "", tplId: "r1", docFont: "", sigFont: "dancing", signature: "", photo: "", accentColor: "" };
}
