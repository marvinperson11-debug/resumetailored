"use client";

import { TOOLS, useTools, type ToolId } from "./tools-context";
import { ToolModal } from "./tool-modal";
import { ComingSoonBody } from "./ui";
import { ResumeTailorTool } from "../tools/resume-tailor";
import { AtsScannerTool } from "../tools/ats-scanner";
import { CoverLetterTool } from "../tools/cover-letter";

const SOON_NOTES: Partial<Record<ToolId, string>> = {
  linkedin: "Optimize and import your LinkedIn profile. Coming in Phase 2.",
  interview: "Practice interview questions with instant AI feedback. Coming in Phase 2.",
  jobs: "Search and save roles matched to your profile. Coming in Phase 2.",
  career: "Your profession-first Career Hub — quizzes, gap analysis, and more. Coming in Phase 2.",
  decoder: "Decode any job posting into what they're really asking for. Coming in Phase 2.",
  video: "Turn your resume into a shareable highlight video. Coming in Phase 3.",
  studio: "Publish a personal portfolio website. Coming in Phase 3.",
};

/**
 * Renders the currently-open tool as a centered modal. Phase-1 tools (Resume,
 * ATS, Cover Letter) are fully built; the rest show a "coming soon" body inside
 * the same modal shell so the dock feels complete.
 */
export function ToolHost() {
  const { activeTool, isPro, closeTool } = useTools();
  if (!activeTool) return null;

  if (activeTool === "resume") return <ResumeTailorTool onClose={closeTool} isPro={isPro} />;
  if (activeTool === "ats") return <AtsScannerTool onClose={closeTool} />;
  if (activeTool === "cover") return <CoverLetterTool onClose={closeTool} isPro={isPro} />;

  const meta = TOOLS.find((t) => t.id === activeTool)!;
  return (
    <ToolModal title={meta.label} icon={meta.icon} onClose={closeTool}>
      <ComingSoonBody feature={meta.label} icon={meta.icon} note={SOON_NOTES[activeTool]} />
    </ToolModal>
  );
}
