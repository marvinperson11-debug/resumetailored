"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { emptyDraftContent, type ResumeDraftContent } from "@/lib/draft-types";
import {
  Sparkles,
  ScanLine,
  PenTool,
  Contact,
  MessageSquare,
  Briefcase,
  Compass,
  FileSearch,
  Video,
  type LucideIcon,
} from "lucide-react";

export type ToolId =
  | "resume"
  | "ats"
  | "cover"
  | "linkedin"
  | "interview"
  | "jobs"
  | "career"
  | "decoder"
  | "video";

export type ToolKind = "tool" | "soon" | "pro";

export interface ToolMeta {
  id: ToolId;
  label: string;
  icon: LucideIcon;
  kind: ToolKind; // tool = built now, soon = Phase 2 placeholder, pro = Pro-locked (Phase 3)
}

/** Dock order per the product spec. */
export const TOOLS: ToolMeta[] = [
  { id: "resume", label: "Resume", icon: Sparkles, kind: "tool" },
  { id: "ats", label: "ATS", icon: ScanLine, kind: "tool" },
  { id: "cover", label: "Cover Letter", icon: PenTool, kind: "tool" },
  { id: "linkedin", label: "LinkedIn", icon: Contact, kind: "tool" },
  { id: "interview", label: "Interview", icon: MessageSquare, kind: "tool" },
  { id: "jobs", label: "Job Finder", icon: Briefcase, kind: "tool" },
  { id: "career", label: "Career", icon: Compass, kind: "tool" },
  { id: "decoder", label: "Decoder", icon: FileSearch, kind: "tool" },
  // Resume Video is a fully Pro-only tool: free users can't open it at all
  // (openTool redirects them to the upgrade flow). The in-tool voiceover/MP4
  // gates remain as secondary server-side checks.
  { id: "video", label: "Resume Video", icon: Video, kind: "pro" },
  // Personal Website (Web Studio) is now a full-screen route (/candidate/studio),
  // not a modal tool — the sidebar navigates there directly.
];

interface ToolsContextValue {
  activeTool: ToolId | null;
  isPro: boolean;
  openTool: (id: ToolId) => void;
  closeTool: () => void;
  /** Draft to seed the AI Resume Builder with (set by "My Resumes" → Reopen). */
  pendingDraft: ResumeDraftContent | null;
  /** Id of the draft being reopened, so autosave updates the same row. */
  pendingDraftId: string | null;
  /** Open the AI Resume Builder, optionally restoring a saved draft (+ its id). */
  openResume: (draft?: ResumeDraftContent, id?: string) => void;
  /** Called by the builder once it has consumed the pending draft. */
  clearPendingDraft: () => void;
  /** A cover-letter template id to pre-select when the Cover Letter tool opens
   *  (set by the Templates gallery's "Use this template"). */
  pendingCoverTpl: string | null;
  /** Called by the Cover Letter tool once it has consumed the pending template. */
  clearPendingCoverTpl: () => void;
  /** Open a builder with a template pre-selected (from the Templates gallery). */
  openTemplate: (cat: "resume" | "cover", tplId: string) => void;
}

const ToolsContext = createContext<ToolsContextValue | null>(null);

export function useTools(): ToolsContextValue {
  const ctx = useContext(ToolsContext);
  if (!ctx) throw new Error("useTools must be used inside <ToolsProvider>");
  return ctx;
}

export function ToolsProvider({ isPro, children }: { isPro: boolean; children: ReactNode }) {
  const router = useRouter();
  const [activeTool, setActiveTool] = useState<ToolId | null>(null);
  const [pendingDraft, setPendingDraft] = useState<ResumeDraftContent | null>(null);
  const [pendingDraftId, setPendingDraftId] = useState<string | null>(null);
  const [pendingCoverTpl, setPendingCoverTpl] = useState<string | null>(null);

  const openTool = useCallback(
    (id: ToolId) => {
      const meta = TOOLS.find((t) => t.id === id);
      if (!meta) return;
      // Pro-locked tools: send free users to the upgrade flow; Pro users see the
      // in-modal "coming soon" (Phase 3) content.
      if (meta.kind === "pro" && !isPro) {
        router.push("/candidate?upgrade=pro");
        return;
      }
      setActiveTool(id);
    },
    [isPro, router]
  );

  const openResume = useCallback((draft?: ResumeDraftContent, id?: string) => {
    setPendingDraft(draft ?? null);
    setPendingDraftId(id ?? null);
    setActiveTool("resume");
  }, []);

  const clearPendingDraft = useCallback(() => {
    setPendingDraft(null);
    setPendingDraftId(null);
  }, []);

  const clearPendingCoverTpl = useCallback(() => setPendingCoverTpl(null), []);

  const openTemplate = useCallback(
    (cat: "resume" | "cover", tplId: string) => {
      if (cat === "resume") {
        setPendingDraft({ ...emptyDraftContent(), tplId });
        setPendingDraftId(null);
        setActiveTool("resume");
      } else {
        setPendingCoverTpl(tplId);
        setActiveTool("cover");
      }
    },
    []
  );

  const closeTool = useCallback(() => setActiveTool(null), []);

  // Close on Escape.
  useEffect(() => {
    if (!activeTool) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeTool();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTool, closeTool]);

  // Lock body scroll while a tool modal is open.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.style.overflow = activeTool ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [activeTool]);

  return (
    <ToolsContext.Provider
      value={{ activeTool, isPro, openTool, closeTool, pendingDraft, pendingDraftId, openResume, clearPendingDraft, pendingCoverTpl, clearPendingCoverTpl, openTemplate }}
    >
      {children}
    </ToolsContext.Provider>
  );
}
