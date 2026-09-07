"use client";

import { TOOLS, useTools, type ToolId } from "./tools-context";
import { ToolModal } from "./tool-modal";
import { ComingSoonBody } from "./ui";
import { ResumeBuilderTool } from "../tools/resume-tailor";
import { AtsScannerTool } from "../tools/ats-scanner";
import { CoverLetterTool } from "../tools/cover-letter";
import { LinkedInOptimizerTool } from "../tools/linkedin-optimizer";
import { InterviewCoachTool } from "../tools/interview-coach";
import { JobFinderTool } from "../tools/job-finder";
import { CareerHubTool } from "../tools/career-hub";
import { DecoderKeyTool } from "../tools/decoder-key";
import { ResumeVideoTool } from "../tools/resume-video";
import { PersonalWebsiteTool } from "../tools/personal-website";

// All tools are built now; nothing is a "coming soon" placeholder.
const SOON_NOTES: Partial<Record<ToolId, string>> = {};

/**
 * Renders the currently-open tool as a centered modal. Phase-1 tools (Resume,
 * ATS, Cover Letter) and Phase-2 tools (LinkedIn, Interview, Jobs, Career,
 * Decoder) are fully built; the Pro Phase-3 tools show a "coming soon" body.
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
  if (activeTool === "decoder") return <DecoderKeyTool onClose={closeTool} />;
  if (activeTool === "video") return <ResumeVideoTool onClose={closeTool} isPro={isPro} />;
  if (activeTool === "studio") return <PersonalWebsiteTool onClose={closeTool} isPro={isPro} />;

  const meta = TOOLS.find((t) => t.id === activeTool)!;
  return (
    <ToolModal title={meta.label} icon={meta.icon} onClose={closeTool}>
      <ComingSoonBody feature={meta.label} icon={meta.icon} note={SOON_NOTES[activeTool]} />
    </ToolModal>
  );
}
