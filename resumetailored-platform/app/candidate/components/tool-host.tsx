"use client";

import dynamic from "next/dynamic";
import { TOOLS, useTools, type ToolId } from "./tools-context";
import { ToolModal } from "./tool-modal";
import { ComingSoonBody } from "./ui";

// Each tool modal is code-split: its JS chunk is fetched only when the user
// opens that tool, instead of shipping all nine in the candidate dashboard's
// first load. ssr:false because these are interactive, auth-gated modals — never
// part of first paint or SEO — so there's nothing to server-render. A tiny
// centered loader covers the (usually sub-second) chunk fetch.
const loader = () => (
  <div className="fixed inset-0 z-[70] flex items-center justify-center bg-navy/70">
    <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-gold" aria-label="Loading tool" role="status" />
  </div>
);

const ResumeBuilderTool = dynamic(() => import("../tools/resume-tailor").then((m) => m.ResumeBuilderTool), { ssr: false, loading: loader });
const AtsScannerTool = dynamic(() => import("../tools/ats-scanner").then((m) => m.AtsScannerTool), { ssr: false, loading: loader });
const CoverLetterTool = dynamic(() => import("../tools/cover-letter").then((m) => m.CoverLetterTool), { ssr: false, loading: loader });
const LinkedInOptimizerTool = dynamic(() => import("../tools/linkedin-optimizer").then((m) => m.LinkedInOptimizerTool), { ssr: false, loading: loader });
const InterviewCoachTool = dynamic(() => import("../tools/interview-coach").then((m) => m.InterviewCoachTool), { ssr: false, loading: loader });
const JobFinderTool = dynamic(() => import("../tools/job-finder").then((m) => m.JobFinderTool), { ssr: false, loading: loader });
const CareerHubTool = dynamic(() => import("../tools/career-hub").then((m) => m.CareerHubTool), { ssr: false, loading: loader });
const DecoderKeyTool = dynamic(() => import("../tools/decoder-key").then((m) => m.DecoderKeyTool), { ssr: false, loading: loader });
const ResumeVideoTool = dynamic(() => import("../tools/resume-video").then((m) => m.ResumeVideoTool), { ssr: false, loading: loader });

// All tools are built now; nothing is a "coming soon" placeholder.
const SOON_NOTES: Partial<Record<ToolId, string>> = {};

/**
 * Renders the currently-open tool as a centered modal. Each tool's code is
 * lazy-loaded on open (see the dynamic() imports above), so opening one only
 * pays for that tool's bundle.
 */
export function ToolHost() {
  const { activeTool, isPro, closeTool } = useTools();
  if (!activeTool) return null;

  if (activeTool === "resume") return <ResumeBuilderTool onClose={closeTool} isPro={isPro} />;
  if (activeTool === "ats") return <AtsScannerTool onClose={closeTool} />;
  if (activeTool === "cover") return <CoverLetterTool onClose={closeTool} isPro={isPro} />;
  if (activeTool === "linkedin") return <LinkedInOptimizerTool onClose={closeTool} isPro={isPro} />;
  if (activeTool === "interview") return <InterviewCoachTool onClose={closeTool} isPro={isPro} />;
  if (activeTool === "jobs") return <JobFinderTool onClose={closeTool} isPro={isPro} />;
  if (activeTool === "career") return <CareerHubTool onClose={closeTool} isPro={isPro} />;
  if (activeTool === "decoder") return <DecoderKeyTool onClose={closeTool} isPro={isPro} />;
  if (activeTool === "video") return <ResumeVideoTool onClose={closeTool} isPro={isPro} />;

  const meta = TOOLS.find((t) => t.id === activeTool)!;
  return (
    <ToolModal title={meta.label} icon={meta.icon} onClose={closeTool}>
      <ComingSoonBody feature={meta.label} icon={meta.icon} note={SOON_NOTES[activeTool]} />
    </ToolModal>
  );
}
