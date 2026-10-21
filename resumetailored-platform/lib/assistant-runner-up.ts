import type Anthropic from "@anthropic-ai/sdk"; // type-only: erased at compile time, never bundled
import { getAnthropic, CLAUDE_MODEL } from "./ai";
import { extractJson } from "./tools-ai";
import { buildMatchScorePrompt, normalizeMatch, localMatchFallback, type Applicant } from "./employer-ai";
import {
  listJobsPendingRunnerUpScan,
  markJobRunnerUpScanned,
  listApplicants,
  getEmployerProfile,
  cacheMatch,
  updateApplicant,
  type RunnerUpScanJob,
} from "./employer-store";
import { createPendingAction, type PendingActionArtifact } from "./assistant-pending";

/**
 * Runner-up (silver-medalist) pool — Employer Portal AI Assistant, Prompt 4.
 * Ticked from instrumentation.ts's existing 30-minute loop, alongside
 * lib/assistant-brief.ts. DELIBERATELY self-contained, same reasoning as
 * lib/assistant-brief.ts / lib/interview-reminders.ts / lib/assistant-send-worker.ts
 * documented on themselves: this file must stay importable by the EDGE
 * compile instrumentation.ts also goes through, so it never imports
 * lib/assistant-mutations.ts or lib/employer-notify.ts (both reach
 * lib/docusign.ts -> Node's `crypto`). The pending-action artifact it builds
 * is constructed inline instead — a few duplicated lines, matching exactly
 * what lib/assistant-mutations.ts `buildMessageCandidatesArtifact` would
 * produce for the same candidates + message (same "message_candidates"
 * action, same artifact shape, same send-queue/undo-window pipeline once
 * approved) — in exchange for `npm run build` staying green. lib/ai.ts and
 * lib/employer-store.ts are already proven edge-safe (lib/assistant-brief.ts
 * imports both).
 */

export const RUNNER_UP_LOOKBACK_HOURS = 24;
export const RUNNER_UP_STRONG_STAGES = ["shortlisted", "interviewed", "rejected"] as const;
export const RUNNER_UP_SCORE_THRESHOLD = 70;
export const RUNNER_UP_MAX_CANDIDATES = 5;
export const RUNNER_UP_MAX_SCORING_CALLS = 10;

// ── pure core ────────────────────────────────────────────────────────────────
export interface RunnerUpInput {
  applicantId: number;
  jobId: number;
  status: string;
  matchScore: number | null;
  commsOptout: boolean;
}

/** A past applicant is a silver medalist for a NEW job when: it's a
 *  different job, they never opted out, they never reached hired/offer
 *  (the two "this already worked out" terminal stages), and either they
 *  reached an advanced stage (shortlisted/interviewed/rejected — someone the
 *  employer actually considered seriously) OR they scored highly on
 *  whichever job they did apply to. */
export function isRunnerUpEligible(a: RunnerUpInput, forJobId: number): boolean {
  if (a.jobId === forJobId) return false;
  if (a.commsOptout) return false;
  if (a.status === "hired" || a.status === "offer extended") return false;
  if ((RUNNER_UP_STRONG_STAGES as readonly string[]).includes(a.status)) return true;
  return typeof a.matchScore === "number" && a.matchScore >= RUNNER_UP_SCORE_THRESHOLD;
}

/** Highest score first (unscored candidates sort last, not first — an
 *  unknown fit should never outrank a known strong one), capped to `max`. */
export function rankRunnerUps<T extends { score: number | null }>(candidates: T[], max: number = RUNNER_UP_MAX_CANDIDATES): T[] {
  return [...candidates].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, max);
}

/** The drafted re-approach message body — acknowledges the prior
 *  application, per the spec. `{{firstName}}` personalizes per candidate,
 *  same placeholder convention as lib/assistant-mutations.ts `personalize`. */
export function runnerUpMessageBody(jobTitle: string, companyName: string): string {
  const co = companyName ? ` at ${companyName}` : "";
  return `Hi {{firstName}}, I wanted to reach back out personally. We just opened a new role — ${jobTitle}${co} — and given your earlier application, I think it could be a great fit. Would you be open to being considered? Just reply and I'll get you moving through our process.`;
}

function personalize(body: string, name: string): string {
  const firstName = (name || "there").split(" ")[0] || "there";
  return body.replace(/\{\{\s*firstName\s*\}\}/gi, firstName).replace(/\{\{\s*name\s*\}\}/gi, name || "there");
}

/** Builds the SAME PendingActionArtifact shape lib/assistant-mutations.ts
 *  `buildMessageCandidatesArtifact` would for these exact candidates +
 *  message — see this file's header for why it's not imported directly. */
export function buildRunnerUpArtifact(jobTitle: string, candidates: { id: number; name: string }[], message: string): PendingActionArtifact {
  return {
    title: candidates.length === 1 ? `Re-approach ${candidates[0].name} for ${jobTitle}` : `Re-approach ${candidates.length} past candidates for ${jobTitle}`,
    irreversible: true,
    irreversibleLabel: "This can't be unsent once it sends — you'll have a short window to undo right after approving.",
    resolvedSpecifics: [
      { label: "New role", value: jobTitle },
      { label: "Recipients", value: candidates.map((c) => c.name).join(", ") },
    ],
    items: candidates.map((c) => ({ id: String(c.id), label: c.name, artifact: personalize(message, c.name) })),
  };
}

// ── scoring (mirrors app/api/employer/match-score/route.ts's own fallback chain) ──
async function scoreForJob(anthropic: Anthropic | null, job: RunnerUpScanJob, applicant: Pick<Applicant, "resumeText">): Promise<number> {
  if (anthropic && job.description.length >= 10 && applicant.resumeText.length >= 10) {
    try {
      const { system, user } = buildMatchScorePrompt({ jobTitle: job.title, jobDescription: job.description, requirements: job.requirements, resumeText: applicant.resumeText });
      const msg = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: 1400, system, messages: [{ role: "user", content: user }] });
      const block = msg.content[0];
      const analysis = normalizeMatch(extractJson(block && block.type === "text" ? block.text : ""));
      if (analysis) return analysis.score;
    } catch {
      /* fall through to the deterministic fallback below */
    }
  }
  return localMatchFallback(job.requirements, job.description, applicant.resumeText).score;
}

// ── the scan ─────────────────────────────────────────────────────────────────
export interface RunnerUpScanResult {
  scanned: number;
  created: number;
  flaggedNoCandidates: number;
}

async function findRunnerUpCandidates(job: RunnerUpScanJob): Promise<{ id: number; name: string; score: number | null }[]> {
  const past = await listApplicants(job.employerId, {});
  const eligible = past.filter((a) =>
    isRunnerUpEligible({ applicantId: a.id, jobId: a.jobId, status: a.status, matchScore: a.matchScore, commsOptout: a.candidateCommsOptout }, job.id)
  );
  if (!eligible.length) return [];

  const anthropic = getAnthropic();
  let scoringCallsUsed = 0;
  const scored: { id: number; name: string; score: number | null }[] = [];
  for (const a of eligible) {
    if (a.matchScore != null) {
      scored.push({ id: a.id, name: a.name, score: a.matchScore });
      continue;
    }
    if (scoringCallsUsed >= RUNNER_UP_MAX_SCORING_CALLS) {
      scored.push({ id: a.id, name: a.name, score: null });
      continue;
    }
    scoringCallsUsed++;
    const score = await scoreForJob(anthropic, job, a);
    scored.push({ id: a.id, name: a.name, score });
    // Persist the fresh score on the applicant's ORIGINAL job, same as the
    // hand-driven match-score route — never wasted, even if this candidate
    // isn't picked for the new job's top 5.
    await cacheMatch(a.id, a.jobId, { score, breakdown: { requiredMet: [], missing: [], experienceMatch: score, skillsMatch: score }, strengths: [], gaps: [], summary: "" }).catch(() => {});
    await updateApplicant(job.employerId, a.id, { matchScore: score }).catch(() => {});
  }
  return rankRunnerUps(scored, RUNNER_UP_MAX_CANDIDATES);
}

/** Ticked every 30 minutes from instrumentation.ts. For each active job
 *  published in the last 24h that hasn't been scanned yet (migration 0059):
 *  find this employer's past applicants from OTHER jobs who are plausible
 *  silver medalists, draft ONE message_candidates pending action naming up
 *  to 5 of them, and flag the job scanned EITHER WAY — a job with no
 *  candidates must never be rescanned every tick trying the same empty
 *  search again. */
export async function runRunnerUpScan(now: number = Date.now()): Promise<RunnerUpScanResult> {
  const sinceIso = new Date(now - RUNNER_UP_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const jobs = await listJobsPendingRunnerUpScan(sinceIso);
  let scanned = 0;
  let created = 0;
  let flaggedNoCandidates = 0;

  for (const job of jobs) {
    scanned++;
    try {
      const candidates = await findRunnerUpCandidates(job);
      if (candidates.length) {
        const profile = await getEmployerProfile(job.employerId).catch(() => null);
        const message = runnerUpMessageBody(job.title, profile?.companyName || "");
        const artifact = buildRunnerUpArtifact(job.title, candidates, message);
        const row = await createPendingAction({
          employerId: job.employerId,
          actorUserId: job.employerId,
          action: "message_candidates",
          payload: { candidates: candidates.map((c) => ({ id: c.id })), message },
          artifact,
          irreversible: true,
        });
        if (row) created++;
      } else {
        flaggedNoCandidates++;
      }
    } catch (e) {
      console.error("[assistant-runner-up] job scan failed", { jobId: job.id, error: e });
    }
    await markJobRunnerUpScanned(job.employerId, job.id);
  }

  return { scanned, created, flaggedNoCandidates };
}
