import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { isScalePlusTier } from "@/lib/employer-plan";
import { getJob } from "@/lib/employer-store";
import { isJobCurrentlyPublic } from "@/lib/job-posting-lifecycle";
import { getDistribution, upsertDistribution } from "@/lib/job-distribution-store";
import { buildChannelsFromInput } from "@/lib/job-distribution";
import { logAction } from "@/lib/assistant-audit";
import { resolveUserEmail } from "@/lib/email";

export const runtime = "nodejs";

const CHANNEL_KEYS = ["indeedFeed", "zipRecruiter", "linkedin"] as const;
type ChannelKey = (typeof CHANNEL_KEYS)[number];
function isChannelKey(v: unknown): v is ChannelKey {
  return typeof v === "string" && (CHANNEL_KEYS as readonly string[]).includes(v);
}

/** GET — the current channel state for one job's distribution panel
 *  (Combined Build, Section 5). Scale+ only, same gate as distribute_job. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  if (!isScalePlusTier(ctx.access)) return NextResponse.json({ allowed: false, reason: "tier", channels: {} });

  const job = await getJob(ctx.employerId, id);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  const row = await getDistribution(ctx.employerId, id);
  return NextResponse.json({ allowed: true, isPublic: isJobCurrentlyPublic(job), channels: row?.channels || {} });
}

/** PATCH — direct, immediate per-channel toggle from the employer's own
 *  manual UI (not the assistant chat — that path goes through the normal
 *  pending-action approval card, see lib/assistant-mutations.ts
 *  buildDistributeJobArtifact). This is the employer's own hands on their
 *  own dashboard button, so — same convention as every other hand-driven
 *  PATCH route in this codebase (contrast the chat tools, which always
 *  create a confirmation card) — it takes effect immediately. Still
 *  audit-logged (reuses assistant_audit_log, which is generic enough to log
 *  any employer-scoped action, not only assistant-originated ones) and
 *  reversible (flipping `enabled` back is always available). Body:
 *  `{ channel: "indeedFeed"|"zipRecruiter"|"linkedin", enabled: boolean }`. */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  if (!isScalePlusTier(ctx.access)) {
    return NextResponse.json({ error: "Job distribution is a Scale-plan feature. Upgrade to Scale to distribute jobs beyond ResumeTailored.", code: "scale_required" }, { status: 402 });
  }

  const body = (await req.json().catch(() => ({}))) as { channel?: unknown; enabled?: unknown };
  if (!isChannelKey(body.channel)) return NextResponse.json({ error: "channel must be one of: " + CHANNEL_KEYS.join(", ") }, { status: 400 });
  const enabled = body.enabled === true;

  const job = await getJob(ctx.employerId, id);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (enabled && !isJobCurrentlyPublic(job)) {
    return NextResponse.json({ error: "This job must be published and publicly listed before it can be distributed. Publish it first." }, { status: 422 });
  }

  const existing = await getDistribution(ctx.employerId, id);
  const channels = buildChannelsFromInput(
    {
      indeedFeed: enabled && body.channel === "indeedFeed",
      zipRecruiter: enabled && body.channel === "zipRecruiter",
      linkedin: enabled && body.channel === "linkedin",
      disable: {
        indeedFeed: !enabled && body.channel === "indeedFeed",
        zipRecruiter: !enabled && body.channel === "zipRecruiter",
        linkedin: !enabled && body.channel === "linkedin",
      },
    },
    existing?.channels || null
  );

  const actorEmail = await resolveUserEmail(ctx.userId).catch(() => null);
  const row = await upsertDistribution(ctx.employerId, id, channels, ctx.userId, actorEmail);
  if (!row) return NextResponse.json({ error: "Could not save this distribution. Please try again." }, { status: 500 });

  await logAction({
    employerId: ctx.employerId,
    actorUserId: ctx.userId,
    actorEmail,
    action: "channel_toggle_manual",
    targetType: "job",
    targetId: id,
    payload: { channel: body.channel, enabled },
    status: "executed",
  });

  return NextResponse.json({ ok: true, channels: row.channels });
}
