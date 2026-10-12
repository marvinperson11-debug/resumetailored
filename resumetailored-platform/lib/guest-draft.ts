import { emptyDraftContent, type ResumeDraftContent } from "./draft-types";

/**
 * Carrying a guest's work across sign-up.
 *
 * "Create free account" navigates away to Clerk and back, so the draft is parked in
 * sessionStorage first and put back — once — when the new account lands on /candidate.
 * sessionStorage (not localStorage) on purpose: it is per tab and dies with it, so a stash can
 * never surface in some later visit or on a shared machine. A sign-up that finishes in a different
 * tab (an emailed link) simply finds no stash and starts clean.
 *
 * A stash is only ever DATA for a form. It carries no quota state and restoring it never calls a
 * model: the new account's allowance is its own (unlimited), decided by the server.
 */
export const GUEST_DRAFT_KEY = "rt_guest_draft";
/** A stash older than this is dropped unread (an abandoned sign-up must not resurface much later). */
export const GUEST_DRAFT_TTL_MS = 2 * 60 * 60 * 1000;

export interface CoverDraftContent {
  name: string;
  contact: string;
  company: string;
  role: string;
  highlights: string;
  jobText: string;
  tplId: string;
  result: string;
}

export type GuestDraft = { tool: "resume"; content: ResumeDraftContent } | { tool: "cover"; content: CoverDraftContent };

export function emptyCoverDraft(): CoverDraftContent {
  return { name: "", contact: "", company: "", role: "", highlights: "", jobText: "", tplId: "c1", result: "" };
}

type StoreLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStore(): StoreLike | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Is there anything here worth carrying over? An empty form is not. */
export function draftHasContent(d: GuestDraft): boolean {
  if (d.tool === "resume") return !!(d.content.resumeText.trim() || d.content.jobText.trim() || d.content.result.trim());
  const c = d.content;
  return !!(c.name.trim() || c.contact.trim() || c.company.trim() || c.role.trim() || c.highlights.trim() || c.jobText.trim() || c.result.trim());
}

/**
 * Park the draft. Returns true if something was stored. Never throws: a blocked or full store just
 * means the user signs up without their draft (a large photo is dropped first, then the attempt is
 * given up).
 */
export function stashGuestDraft(draft: GuestDraft | null, store: StoreLike | null = defaultStore(), now: number = Date.now()): boolean {
  if (!store) return false;
  try {
    store.removeItem(GUEST_DRAFT_KEY); // never leave an older stash behind
    if (!draft || !draftHasContent(draft)) return false;
    const write = (d: GuestDraft) => store.setItem(GUEST_DRAFT_KEY, JSON.stringify({ v: 1, savedAt: now, draft: d }));
    try {
      write(draft);
    } catch {
      if (draft.tool !== "resume" || !draft.content.photo) return false;
      write({ tool: "resume", content: { ...draft.content, photo: "" } });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Take the stash: read it, REMOVE it (restoring clears it, so a refresh or a second visit never
 * re-applies it), and return it if it is well-formed and fresh.
 */
export function takeGuestDraft(store: StoreLike | null = defaultStore(), now: number = Date.now()): GuestDraft | null {
  if (!store) return null;
  let raw: string | null = null;
  try {
    raw = store.getItem(GUEST_DRAFT_KEY);
    if (raw !== null) store.removeItem(GUEST_DRAFT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { v?: unknown; savedAt?: unknown; draft?: { tool?: unknown; content?: Record<string, unknown> } };
    if (parsed.v !== 1 || typeof parsed.savedAt !== "number" || now - parsed.savedAt > GUEST_DRAFT_TTL_MS || now < parsed.savedAt - 60_000) return null;
    const c = parsed.draft?.content;
    if (!c || typeof c !== "object") return null;
    if (parsed.draft?.tool === "resume") {
      const base = emptyDraftContent();
      const draft: GuestDraft = {
        tool: "resume",
        content: {
          resumeText: str(c.resumeText),
          jobText: str(c.jobText),
          result: str(c.result),
          tplId: str(c.tplId) || base.tplId,
          docFont: str(c.docFont),
          sigFont: str(c.sigFont) || base.sigFont,
          signature: str(c.signature),
          photo: str(c.photo),
          accentColor: str(c.accentColor),
        },
      };
      return draftHasContent(draft) ? draft : null;
    }
    if (parsed.draft?.tool === "cover") {
      const draft: GuestDraft = {
        tool: "cover",
        content: {
          name: str(c.name),
          contact: str(c.contact),
          company: str(c.company),
          role: str(c.role),
          highlights: str(c.highlights),
          jobText: str(c.jobText),
          tplId: str(c.tplId) || "c1",
          result: str(c.result),
        },
      };
      return draftHasContent(draft) ? draft : null;
    }
  } catch {
    /* malformed — already removed above */
  }
  return null;
}

/** Where "Create free account" goes: Clerk sign-up, and straight back to the dashboard afterwards. */
export const GUEST_SIGN_UP_HREF = `/sign-up?redirect_url=${encodeURIComponent("/candidate")}`;
