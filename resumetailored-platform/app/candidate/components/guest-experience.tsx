"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@clerk/nextjs";
import { Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseGuestCap, parseGuestRuns, isGuestToolKey, type GuestCap, type GuestRuns } from "@/lib/guest-cap";
import { GUEST_SIGN_UP_HREF, stashGuestDraft, takeGuestDraft, type GuestDraft } from "@/lib/guest-draft";
import { useTools } from "./tools-context";

/**
 * The signed-out free tier's conversion moments (the server side is lib/guest.ts):
 *
 *  1. CAP PROMPT — when a guest action comes back "you're out for today" (402 guest_quota, or the
 *     503 capacity/unavailable declines), a prompt anchored to the BOTTOM of the viewport, above the
 *     tool's button bar. It used to be a thin red line at the top of the form, which a phone user
 *     standing at the "Build My Resume" button at the bottom never saw — the button just looked broken.
 *  2. VALUE NUDGE — after a guest's first successful tailor / cover letter, a one-time card near the
 *     result: "Love it? Create a free account…".
 *  2b. RUNS NOTE — a quiet "free run used — resets tomorrow" / "2 of 3 free scans left today" beside the
 *     tool's action button, fed by the `used`/`limit` a guest's responses carry. Advance notice only: the
 *     cap prompt above still fires the moment a capped guest actually tries. Held in memory for the
 *     page's life, never stored — the server is the only source of truth for a quota.
 *  3. SIGN-UP ROUND TRIP — every "Create free account" parks the current draft in sessionStorage and
 *     goes to Clerk sign-up with a redirect back to /candidate, where the draft is restored once.
 *
 * Nothing here renders for a signed-in user: the server only sends guest payloads to guests, and every
 * entry point below also checks the Clerk session.
 */

const NUDGE_FLAG = "rt_guest_nudge_seen"; // localStorage — the value nudge has been shown on this device
let nudgeShownThisLoad = false; // fallback when storage is blocked: at least once per page load

export interface GuestContextValue {
  /** Clerk says there is a session. False while Clerk is still loading, and for guests. */
  signedIn: boolean;
  /**
   * Call with a response's status and parsed body BEFORE any generic 402/"upgrade" handling. Returns
   * true when it was a guest decline and the prompt is now showing — the caller should just stop
   * (no inline error, no Pro redirect). Always false for a signed-in user.
   */
  handleCap: (status: number, data: unknown) => boolean;
  /**
   * The same check for a raw fetch Response (it reads a CLONE of the body, so the caller's own
   * `res.json()` still works). The one-liner every gated call site uses, right after its `fetch`:
   * `if (await guest.handleCapResponse(res)) return;`
   */
  handleCapResponse: (res: Response) => Promise<boolean>;
  /** Park the current draft and go to Clerk sign-up (back to /candidate afterwards). */
  startSignUp: () => void;
  /** First call per device returns true (and remembers it); every later call false. Always false when signed in. */
  claimNudge: () => boolean;
  /** A tool registers how to read its current draft; returns the unregister function. */
  registerDraftSource: (read: () => GuestDraft | null) => () => void;
  /** What the server last reported for each metered tool this page load (never for a signed-in user). */
  runs: Record<string, GuestRuns>;
}

const inert: GuestContextValue = {
  signedIn: false,
  handleCap: () => false,
  handleCapResponse: async () => false,
  startSignUp: () => {},
  claimNudge: () => false,
  registerDraftSource: () => () => {},
  runs: {},
};
const GuestContext = createContext<GuestContextValue>(inert);

export function useGuest(): GuestContextValue {
  return useContext(GuestContext);
}

/** Let the guest experience read this tool's draft when the user chooses to sign up. */
export function useGuestDraftSource(read: () => GuestDraft | null): void {
  const { registerDraftSource } = useGuest();
  const ref = useRef(read);
  ref.current = read; // always the latest closure — the draft changes on every keystroke
  useEffect(() => registerDraftSource(() => ref.current()), [registerDraftSource]);
}

function readNudgeFlag(): boolean {
  try {
    return window.localStorage.getItem(NUDGE_FLAG) === "1";
  } catch {
    return false;
  }
}
function writeNudgeFlag() {
  try {
    window.localStorage.setItem(NUDGE_FLAG, "1");
  } catch {
    /* storage blocked — nudgeShownThisLoad still caps it at once per page load */
  }
}

/**
 * How far above the viewport's bottom edge the prompt should sit so it clears the tool's button bar:
 * on a phone the tool modal is full-screen, so its footer (the Build / download buttons) is pinned to
 * the bottom of the viewport and the prompt stacks directly above it. When there is no such bar (a
 * centered desktop modal, no tool open) the prompt sits at the bottom edge.
 */
export function barClearance(doc: Document, viewportHeight: number): number {
  const bars = doc.querySelectorAll('[role="dialog"] footer');
  const bar = bars[bars.length - 1];
  if (!bar) return 0;
  const r = bar.getBoundingClientRect();
  if (!(r.height > 0) || viewportHeight - r.bottom > 8 || r.top >= viewportHeight) return 0;
  return Math.min(Math.round(viewportHeight - r.top), Math.round(viewportHeight * 0.4));
}

export function GuestExperienceProvider({ children, navigate }: { children: ReactNode; navigate?: (url: string) => void }) {
  const { isLoaded, isSignedIn } = useAuth();
  const signedIn = isLoaded && isSignedIn === true;
  const { openResume, openCover } = useTools();
  const [cap, setCap] = useState<GuestCap | null>(null);
  const [runs, setRuns] = useState<Record<string, GuestRuns>>({});
  const sourceRef = useRef<(() => GuestDraft | null) | null>(null);
  const go = useCallback((url: string) => (navigate ? navigate(url) : window.location.assign(url)), [navigate]);

  const registerDraftSource = useCallback((read: () => GuestDraft | null) => {
    sourceRef.current = read;
    return () => {
      if (sourceRef.current === read) sourceRef.current = null;
    };
  }, []);

  const startSignUp = useCallback(() => {
    let draft: GuestDraft | null = null;
    try {
      draft = sourceRef.current ? sourceRef.current() : null;
    } catch {
      draft = null;
    }
    stashGuestDraft(draft);
    setCap(null);
    go(GUEST_SIGN_UP_HREF);
  }, [go]);

  const handleCap = useCallback(
    (status: number, data: unknown): boolean => {
      if (isSignedIn === true) return false; // a signed-in user never sees guest UI
      const r = parseGuestRuns(data);
      if (r) setRuns((prev) => ({ ...prev, [r.tool]: r }));
      const parsed = parseGuestCap(status, data);
      if (!parsed) return false;
      setCap(parsed);
      return true;
    },
    [isSignedIn]
  );

  const handleCapResponse = useCallback(
    async (res: Response): Promise<boolean> => {
      if (isSignedIn === true) return false;
      // A guest's successful run reports its usage too; observe it and carry on (false = "not a decline").
      if (res.ok || res.status === 402 || res.status === 503) {
        const data: unknown = await res.clone().json().catch(() => null);
        return handleCap(res.status, data);
      }
      return false;
    },
    [isSignedIn, handleCap]
  );

  const claimNudge = useCallback((): boolean => {
    if (isSignedIn === true) return false;
    if (nudgeShownThisLoad || readNudgeFlag()) return false;
    nudgeShownThisLoad = true;
    writeNudgeFlag();
    return true;
  }, [isSignedIn]);

  // Put a parked draft back once the account exists. It is read-and-removed first, so a refresh or a
  // second visit can't re-apply it, and it only fills the form — nothing is regenerated and no quota
  // state is carried, so the new account's own (unlimited) allowance is what the next run uses.
  const restored = useRef(false);
  useEffect(() => {
    if (!signedIn || restored.current) return;
    restored.current = true;
    const draft = takeGuestDraft();
    if (!draft) return;
    if (draft.tool === "resume") openResume(draft.content);
    else openCover(draft.content);
  }, [signedIn, openResume, openCover]);

  const value = useMemo<GuestContextValue>(
    () => ({ signedIn, handleCap, handleCapResponse, startSignUp, claimNudge, registerDraftSource, runs }),
    [signedIn, handleCap, handleCapResponse, startSignUp, claimNudge, registerDraftSource, runs]
  );

  return (
    <GuestContext.Provider value={value}>
      {children}
      {cap && !signedIn && <GuestCapPrompt cap={cap} onSignUp={startSignUp} onDismiss={() => setCap(null)} />}
    </GuestContext.Provider>
  );
}

/**
 * The bottom-anchored cap prompt. The candidate area uses it as is; the anonymous employer taste
 * (app/employer/components/demo) passes `copy` so the same prompt speaks to a would-be employer
 * ("Create a free employer account to post for real") and `signUpLabel` for its button.
 */
export function GuestCapPrompt({
  cap,
  onSignUp,
  onDismiss,
  copy,
  signUpLabel,
}: {
  cap: GuestCap;
  onSignUp: () => void;
  onDismiss: () => void;
  copy?: { title: string; body: string };
  signUpLabel?: string;
}) {
  const t = useTranslations("guestNudge");
  const primaryRef = useRef<HTMLButtonElement>(null);
  const [clearance, setClearance] = useState(0);

  useEffect(() => {
    const measure = () => setClearance(barClearance(document, window.innerHeight));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    primaryRef.current?.focus();
    // Escape dismisses the prompt — and only the prompt. The tool modal behind it also closes on
    // Escape (ToolsProvider listens on window); stopping the event in the capture phase keeps a
    // dismiss from throwing away the draft the guest is about to sign up with.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onDismiss();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onDismiss]);

  const title =
    cap.kind === "capacity"
      ? t("capTitleCapacity")
      : cap.kind === "unavailable"
        ? t("capTitleUnavailable")
        : isGuestToolKey(cap.tool)
          ? t("capTitle", { tool: t(`tools.${cap.tool}`) })
          : t("capTitleGeneric");
  const body = cap.kind === "quota" ? t("capBody") : t("capBodyBusy");
  const shownTitle = copy && cap.kind === "quota" ? copy.title : title;
  const shownBody = copy && cap.kind === "quota" ? copy.body : body;

  return (
    <div className="fixed inset-0 z-[95]" data-guest-cap-root>
      <div className="absolute inset-0 bg-navy/60" onClick={onDismiss} aria-hidden="true" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="guest-cap-title"
        aria-describedby="guest-cap-body"
        data-guest-cap
        data-kind={cap.kind}
        className={cn(
          "absolute inset-x-0 mx-auto w-full max-w-md rounded-t-2xl border border-border-gold bg-navy px-5 pt-5 shadow-2xl sm:rounded-2xl",
          clearance ? "" : "bottom-0 sm:bottom-6"
        )}
        style={{ bottom: clearance ? `${clearance}px` : undefined, paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
      >
        <h3 id="guest-cap-title" className="font-serif text-lg font-medium text-cream">
          {shownTitle}
        </h3>
        <p id="guest-cap-body" className="mt-1.5 text-sm leading-snug text-white/70">
          {shownBody}
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row-reverse">
          <button
            ref={primaryRef}
            type="button"
            onClick={onSignUp}
            data-guest-signup
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet px-5 py-3 text-sm font-semibold text-white shadow-[0_0_18px_rgba(194,135,11,0.32)] transition-all duration-200 hover:-translate-y-0.5 sm:py-2.5"
          >
            <Sparkles className="h-4 w-4" /> {signUpLabel ?? t("createAccount")}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            data-guest-later
            className="inline-flex items-center justify-center rounded-xl border border-border-gold px-5 py-3 text-sm font-medium text-cream transition-colors hover:bg-white/8 sm:py-2.5"
          >
            {t("maybeLater")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The one-time "Love it?" card, rendered by a tool next to its result when it has claimed the nudge. */
export function GuestNudgeCard({ onDismiss }: { onDismiss: () => void }) {
  const t = useTranslations("guestNudge");
  const { signedIn, startSignUp } = useGuest();
  if (signedIn) return null;
  return (
    <div role="status" data-guest-nudge className="mx-4 mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-gold/40 bg-gold/10 px-3.5 py-3 text-sm text-cream">
      <span className="min-w-[12rem] flex-1 leading-snug">{t("nudgeText")}</span>
      <button
        type="button"
        onClick={startSignUp}
        data-guest-signup
        className="shrink-0 rounded-full bg-gold px-3 py-1.5 text-xs font-bold text-navy transition-opacity hover:opacity-90"
      >
        {t("createAccount")}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("dismiss")}
        data-guest-nudge-dismiss
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white/55 transition-colors hover:bg-white/10 hover:text-cream"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * The quiet "free runs left" note beside a tool's action button. Renders nothing for a signed-in
 * user, before the guest's first use of the tool, or for a tool with no wording of its own here.
 * A 1-a-day tool says its run is used; a multi-use tool says how many are left.
 */
export function GuestRunsNote({ tool, className }: { tool: string; className?: string }) {
  const t = useTranslations("guestRuns");
  const { signedIn, runs } = useGuest();
  const r = runs[tool];
  if (signedIn || !r || r.used < 1) return null;
  let text: string | null = null;
  if (r.limit === 1) text = t("usedOne");
  else if (tool === "ats-scan") text = t("scansLeft", { left: Math.max(0, r.limit - r.used), limit: r.limit });
  if (!text) return null;
  return (
    <span data-guest-runs data-tool={tool} role="status" className={cn("text-xs text-white/55", className)}>
      {text}
    </span>
  );
}
