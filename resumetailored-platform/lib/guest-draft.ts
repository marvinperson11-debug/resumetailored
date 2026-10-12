import { emptyDraftContent, type ResumeDraftContent } from "./draft-types";
import { createStash, type StoreLike } from "./draft-stash";

/**
 * Carrying a guest's work across sign-up.
 *
 * "Create free account" navigates away to Clerk and back, so the draft is parked in
 * sessionStorage first and put back — once — when the new account lands on /candidate.
 * sessionStorage (not localStorage) on purpose: it is per tab and dies with it, so a stash can
 * never surface in some later visit or on a shared machine. A sign-up that finishes in a different
 * tab (an emailed link) simply finds no stash and starts clean.
 *
 * The record is the shared one in lib/draft-stash.ts: the Resume Builder also autosaves into it as the
 * user types (so leaving mid-setup keeps the work), and only the sign-up path flags it as a hand-off.
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

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Is there anything here worth carrying over? An empty form is not. */
export function draftHasContent(d: GuestDraft): boolean {
  if (d.tool === "resume") return !!(d.content.resumeText.trim() || d.content.jobText.trim() || d.content.result.trim());
  const c = d.content;
  return !!(c.name.trim() || c.contact.trim() || c.company.trim() || c.role.trim() || c.highlights.trim() || c.jobText.trim() || c.result.trim());
}

function parseGuestDraft(raw: unknown): GuestDraft | null {
  const d = raw as { tool?: unknown; content?: Record<string, unknown> } | null;
  const c = d?.content;
  if (!c || typeof c !== "object") return null;
  if (d?.tool === "resume") {
    const base = emptyDraftContent();
    return {
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
  }
  if (d?.tool === "cover") {
    return {
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
  }
  return null;
}

export const guestDraftStash = createStash<GuestDraft>({
  key: GUEST_DRAFT_KEY,
  ttlMs: GUEST_DRAFT_TTL_MS,
  isEmpty: (d) => !draftHasContent(d),
  parse: parseGuestDraft,
  // A large photo is dropped first when the store is full, then the attempt is given up.
  shrink: (d) => (d.tool === "resume" && d.content.photo ? { tool: "resume", content: { ...d.content, photo: "" } } : null),
});

/**
 * Sign-up hand-off: park the draft flagged for the new account. Returns true if something was
 * stored. Never throws: a blocked or full store just means the user signs up without their draft.
 */
export function stashGuestDraft(draft: GuestDraft | null, store?: StoreLike | null, now?: number): boolean {
  return guestDraftStash.save(draft, { handoff: true, store, now });
}

/** The autosaved resume draft, left in place (the builder restores from it on return). */
export function readGuestResumeDraft(store?: StoreLike | null, now?: number): ResumeDraftContent | null {
  const d = guestDraftStash.read(store, now);
  return d?.tool === "resume" ? d.content : null;
}

/**
 * Take the sign-up hand-off: read it, REMOVE it (so a refresh or a second visit never re-applies
 * it), and return it if it is well-formed and fresh. Plain autosave is never taken here — a
 * signed-in user's autosaved draft is only restored when they open the builder themselves.
 */
export function takeGuestDraft(store?: StoreLike | null, now?: number): GuestDraft | null {
  return guestDraftStash.takeHandoff(store, now);
}

/** Where "Create free account" goes: Clerk sign-up, and straight back to the dashboard afterwards. */
export const GUEST_SIGN_UP_HREF = `/sign-up?redirect_url=${encodeURIComponent("/candidate")}`;
