import Anthropic from "@anthropic-ai/sdk";
import { getAssistantAnthropic, ASSISTANT_MODEL, type ChatMessage } from "./assistant-chat";
import { ASSISTANT_TOOL_DEFS, ASSISTANT_TOOL_EXECUTORS } from "./assistant-tools";
import { logAction } from "./assistant-audit";
import { listPendingActions } from "./assistant-pending";
import { getFreeTierState, jobCreateAllowed, gradeGate } from "./employer-free-tier";
import { checkFreeUsage, recordFreeUsage, crawlDelay, type FreeUsageCheck } from "./assistant-free-usage";

/**
 * Taylor on the Free plan (Taylor Combined Build v5, Section E.3): an
 * EXPLAINER, not a worker. No portal-data reads, no tools, no hiring work —
 * with the single exception of drafting and publishing the one job post a
 * Free account ever gets. Server-side enforcement is the tool LIST itself:
 * the three tools below are the entire universe a Free turn can ever reach,
 * regardless of what the employer asks for — there is no read tool here to
 * mistakenly call, and nothing short of adding a name to
 * FREE_EXCEPTION_TOOL_NAMES could ever widen it.
 *
 * This is a deliberately separate code path from `runAssistantTurn`
 * (lib/assistant-chat.ts), not a tier branch inside it — Portal/Scale
 * behavior there is unchanged, and this module owns 100% of what Free sees.
 */

const MAX_TOOL_ITERATIONS = 4;

const FREE_EXCEPTION_TOOL_NAMES = ["draft_job_post", "start_job_from_playbook", "publish_job"];
const FREE_EXCEPTION_TOOL_DEFS = ASSISTANT_TOOL_DEFS.filter((d) => FREE_EXCEPTION_TOOL_NAMES.includes(d.name));

export const FREE_EXPLAINER_SYSTEM_PROMPT = `You are Taylor, the Employer Portal AI Assistant for ResumeTailored, talking to a Free-plan employer.

On the Free plan you are an EXPLAINER, not a worker. You never read this employer's jobs, candidates, pipeline, interviews, applicant messages, or anything else about their account, and you never do real hiring work for them — WITH ONE EXCEPTION: drafting and publishing the single job post a Free account gets, start to finish (gathering what's missing, composing the post, and preparing it for approval via your tools). Use that exception the moment the employer is clearly trying to post or draft a job.

For anything else that sounds like hiring work — summarizing a pipeline, looking up or messaging a candidate, scheduling or rescheduling an interview, generating an interview kit, a hiring report, distributing a job, or anything along those lines — do NOT attempt it and do NOT guess an answer from thin air. Say plainly that this needs the Portal plan (for the full read-only assistant) or the Scale plan (for the full acting assistant that can do that work for the employer), and name what upgrading actually unlocks. Never imply you can see or have already looked at this employer's real data when declining — you haven't, and you can't.

If the employer asks what you can do, or what the assistant does in general, explain this honestly: that on Free you explain and help with the one job post, and upgrading to Portal or Scale unlocks reading and (at Scale) acting on jobs, candidates, the pipeline, interviews, and messages. Be warm about it — this is an upgrade pitch, not a refusal.`;

export const FREE_NOT_CONFIGURED_MESSAGE = "The assistant isn't configured yet. Please contact support.";

export type FreeAssistantTurnResult = { ok: true; reply: string } | { ok: false; reason: "throttled" | "not_configured"; reply: string; retryAfterSeconds?: number };

/** Free-tier-only pre-check before the real draft_job_post/start_job_from_playbook
 *  executor ever runs: block a BRAND NEW draft once this employer already has
 *  a real job (free_tier_state.jobs_count >= 1) or already has another
 *  pending draft awaiting approval. A call that is clearly CORRECTING an
 *  existing pending draft (carries pending_action_id or pending_draft_title)
 *  is never treated as "brand new" — the real executor's own upsert logic
 *  decides whether that correction actually matches something pending. */
async function freeJobDraftGate(employerId: string, toolName: string, input: Record<string, unknown>): Promise<{ allowed: boolean; message: string }> {
  const isCorrection = typeof input.pending_action_id === "string" && input.pending_action_id.trim() ? true : typeof input.pending_draft_title === "string" && input.pending_draft_title.trim() ? true : false;
  if (isCorrection) return { allowed: true, message: "" };

  const [freeState, pending] = await Promise.all([getFreeTierState(employerId), listPendingActions(employerId)]);
  const alreadyHasRealJob = !jobCreateAllowed(freeState.jobsCount);
  const alreadyDrafting = pending.some((p) => p.status === "pending" && p.action === toolName);
  if (!alreadyHasRealJob && !alreadyDrafting) return { allowed: true, message: "" };

  const gate = gradeGate("free", "job_create", "You've already posted your one free job", false);
  return { allowed: false, message: gate.message };
}

/** Run one Free-plan assistant turn — usage-gated, tool-restricted,
 *  explainer-by-default with the one-shot job drafting/publishing exception.
 *  Mirrors `runAssistantTurn`'s tool-use loop shape, but against a
 *  completely separate, much smaller tool universe and a separate usage
 *  model (Section E.5 — hourly/daily rate limits + a fair-use ceiling, never
 *  a monthly cap). */
export async function runFreeAssistantTurn(params: {
  employerId: string;
  actorUserId: string;
  actorEmail: string | null;
  messages: ChatMessage[];
  isVoice?: boolean;
}): Promise<FreeAssistantTurnResult> {
  const usage = await checkFreeUsage(params.employerId, !!params.isVoice);
  if (usage.blocked === true) {
    const u = usage as FreeUsageCheck & { blocked: true };
    return { ok: false, reason: "throttled", reply: u.message, retryAfterSeconds: u.retryAfterSeconds };
  }
  if (usage.blocked === "ceiling") await crawlDelay();

  const anthropic = getAssistantAnthropic();
  if (!anthropic) return { ok: false, reason: "not_configured", reply: FREE_NOT_CONFIGURED_MESSAGE };

  type ConvoMessage = { role: "user" | "assistant"; content: string | Anthropic.ContentBlock[] | Anthropic.ToolResultBlockParam[] };
  const convo: ConvoMessage[] = params.messages.map((m) => ({ role: m.role, content: m.content }));

  let finalText = "";
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const res = await anthropic.messages.create({
      model: ASSISTANT_MODEL,
      max_tokens: 1024,
      system: FREE_EXPLAINER_SYSTEM_PROMPT,
      tools: FREE_EXCEPTION_TOOL_DEFS as Anthropic.Tool[],
      messages: convo,
    });

    const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    if (!toolUses.length) {
      finalText = text;
      break;
    }

    convo.push({ role: "assistant", content: res.content });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const input = (tu.input && typeof tu.input === "object" ? (tu.input as Record<string, unknown>) : {}) || {};
      try {
        if (!FREE_EXCEPTION_TOOL_NAMES.includes(tu.name)) throw new Error(`Unknown tool: ${tu.name}`);
        if (tu.name === "draft_job_post" || tu.name === "start_job_from_playbook") {
          const gate = await freeJobDraftGate(params.employerId, tu.name, input);
          if (!gate.allowed) {
            toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify({ resolved: false, reason: "free_tier_graduation", message: gate.message }) });
            continue;
          }
        }
        const exec = ASSISTANT_TOOL_EXECUTORS[tu.name];
        const result = await exec(params.employerId, input, { actorUserId: params.actorUserId, actorEmail: params.actorEmail });
        await logAction({
          employerId: params.employerId,
          actorUserId: params.actorUserId,
          actorEmail: params.actorEmail,
          action: tu.name,
          targetType: result.targetType,
          targetId: result.targetId,
          payload: input,
          status: "executed",
        });
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result.data) });
      } catch (e) {
        await logAction({
          employerId: params.employerId,
          actorUserId: params.actorUserId,
          actorEmail: params.actorEmail,
          action: tu.name,
          targetType: null,
          targetId: null,
          payload: input,
          status: "failed",
        });
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify({ error: e instanceof Error ? e.message : "Tool call failed." }), is_error: true });
      }
    }
    convo.push({ role: "user", content: toolResults });

    if (i === MAX_TOOL_ITERATIONS - 1) {
      finalText = text || "I gathered what I could but couldn't finish — try asking again, maybe in smaller parts.";
    }
  }

  await recordFreeUsage(params.employerId, !!params.isVoice);
  return { ok: true, reply: finalText || "I don't have an answer for that." };
}
