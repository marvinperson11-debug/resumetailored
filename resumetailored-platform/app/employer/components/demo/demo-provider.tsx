"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import { parseGuestCap, parseGuestRuns, type GuestCap, type GuestRuns } from "@/lib/guest-cap";
import { EMPLOYER_SIGN_UP_HREF, stashEmployerDraft, type EmployerJobDraft } from "@/lib/employer-demo";
import { GuestCapPrompt } from "@/app/candidate/components/guest-experience";
import { Btn, Modal } from "../ui";

/**
 * The conversion moments of the anonymous employer taste (the server side is lib/employer-demo.ts
 * and the `employer-jd` guest tool in lib/guest.ts):
 *
 *  1. URGE MODAL — every action that would touch real people (publish, post, message, schedule,
 *     move a candidate…) is a button that does nothing real in demo mode: it opens this instead.
 *     "This is what your post and pipeline will look like. Create a free employer account to
 *     publish — your first job post is free."
 *  2. CAP PROMPT — the AI job-description writer is free once a day; its 402 opens the same
 *     bottom-anchored prompt the candidate area uses, with the employer wording.
 *  3. SIGN-UP ROUND TRIP — both go to Clerk sign-up and come back through the free-tier claim to
 *     /employer. The job-post form the guest filled in is parked in sessionStorage and put back,
 *     once, into the new-job form. Nothing else carries over: the demo pipeline is fixtures.
 *
 * Mounted only by the guest branch of app/employer/layout.tsx, so a signed-in employer never gets
 * any of it.
 */

export interface EmployerDemoValue {
  demo: true;
  /** Open the "create a free employer account to publish" modal (the draft, if any, is parked first). */
  openUrge: () => void;
  /** Call with a fetch Response right after the call, BEFORE generic error handling; true = a guest cap prompt is now showing. */
  handleCapResponse: (res: Response) => Promise<boolean>;
  /** A form registers how to read its draft; returns the unregister function. */
  registerDraftSource: (read: () => EmployerJobDraft | null) => () => void;
  /** Park the draft and go to employer sign-up. */
  startSignUp: () => void;
  /** What the server last reported for the AI writer this page load (memory only; the server is the source of truth). */
  runs: Record<string, GuestRuns>;
}

const DemoContext = createContext<EmployerDemoValue | null>(null);

/** null outside demo mode — every consumer treats that as "this is the real portal". */
export function useEmployerDemo(): EmployerDemoValue | null {
  return useContext(DemoContext);
}

/** Let the demo read this form's draft when the visitor chooses to sign up. */
export function useEmployerDraftSource(read: () => EmployerJobDraft | null): void {
  const demo = useEmployerDemo();
  const ref = useRef(read);
  ref.current = read;
  const register = demo?.registerDraftSource;
  useEffect(() => (register ? register(() => ref.current()) : undefined), [register]);
}

export function EmployerDemoProvider({ children, navigate }: { children: ReactNode; navigate?: (url: string) => void }) {
  const t = useTranslations("employerDemo");
  const [urge, setUrge] = useState(false);
  const [cap, setCap] = useState<GuestCap | null>(null);
  const [runs, setRuns] = useState<Record<string, GuestRuns>>({});
  const sourceRef = useRef<(() => EmployerJobDraft | null) | null>(null);
  const go = useCallback((url: string) => (navigate ? navigate(url) : window.location.assign(url)), [navigate]);

  const readDraft = useCallback((): EmployerJobDraft | null => {
    try {
      return sourceRef.current ? sourceRef.current() : null;
    } catch {
      return null;
    }
  }, []);

  const registerDraftSource = useCallback((read: () => EmployerJobDraft | null) => {
    sourceRef.current = read;
    return () => {
      if (sourceRef.current === read) sourceRef.current = null;
    };
  }, []);

  const startSignUp = useCallback(() => {
    stashEmployerDraft(readDraft());
    setUrge(false);
    setCap(null);
    go(EMPLOYER_SIGN_UP_HREF);
  }, [go, readDraft]);

  const handleCapResponse = useCallback(async (res: Response): Promise<boolean> => {
    if (!res.ok && res.status !== 402 && res.status !== 503) return false;
    const data: unknown = await res.clone().json().catch(() => null);
    const r = parseGuestRuns(data);
    if (r) setRuns((prev) => ({ ...prev, [r.tool]: r }));
    const parsed = parseGuestCap(res.status, data);
    if (!parsed) return false;
    setCap(parsed);
    return true;
  }, []);

  const openUrge = useCallback(() => setUrge(true), []);

  const value = useMemo<EmployerDemoValue>(
    () => ({ demo: true, openUrge, handleCapResponse, registerDraftSource, startSignUp, runs }),
    [openUrge, handleCapResponse, registerDraftSource, startSignUp, runs]
  );

  const draft = urge ? readDraft() : null;

  return (
    <DemoContext.Provider value={value}>
      {children}
      {urge && (
        <Modal title={t("urgeTitle")} onClose={() => setUrge(false)}>
          <div data-employer-urge>
            {draft && draft.title.trim() && (
              <div className="mb-4 rounded-lg border border-border-gold bg-white/[0.04] p-3" data-employer-urge-preview>
                <div className="text-sm font-semibold text-cream">{draft.title}</div>
                {draft.description.trim() && <p className="mt-1 line-clamp-3 text-xs text-white/60">{draft.description}</p>}
              </div>
            )}
            <p className="text-sm leading-relaxed text-white/80">{t("urgeBody")}</p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
              <Btn onClick={startSignUp} data-employer-signup>
                <Sparkles className="h-4 w-4" /> {t("createAccount")}
              </Btn>
              <Btn variant="ghost" onClick={() => setUrge(false)} data-employer-later>
                {t("keepExploring")}
              </Btn>
            </div>
          </div>
        </Modal>
      )}
      {cap && (
        <GuestCapPrompt
          cap={cap}
          onSignUp={startSignUp}
          onDismiss={() => setCap(null)}
          copy={{ title: t("capTitle"), body: t("capBody") }}
          signUpLabel={t("createAccount")}
        />
      )}
    </DemoContext.Provider>
  );
}

/** The quiet note under the AI writer's button once the demo's one free improvement is spent. */
export function EmployerRunsNote({ className }: { className?: string }) {
  const t = useTranslations("employerDemo");
  const demo = useEmployerDemo();
  const r = demo?.runs["employer-jd"];
  if (!demo || !r || r.used < 1) return null;
  return (
    <p data-guest-runs data-tool="employer-jd" role="status" className={className ?? "text-xs text-white/55"}>
      {t("runsUsed")}
    </p>
  );
}
