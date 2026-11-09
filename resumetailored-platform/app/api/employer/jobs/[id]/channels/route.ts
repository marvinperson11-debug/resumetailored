import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { getJob } from "@/lib/employer-store";
import { isJobCurrentlyPublic } from "@/lib/job-posting-lifecycle";
import { getDistribution, upsertDistribution, ensureEmployerFeedToken } from "@/lib/job-distribution-store";
import { buildChannelsFromInput, buildIndeedFeedUrl, buildZipRecruiterFeedUrl, buildIndeedFeedInstructions, buildZipRecruiterFeedInstructions, type DistributionChannels } from "@/lib/job-distribution";
import { appUrl } from "@/lib/subdomain";
import { logAction } from "@/lib/assistant-audit";
import { resolveUserEmail } from "@/lib/email";

export const runtime = "nodejs";

const CHANNEL_KEYS = ["indeedFeed", "zipRecruiter", "linkedin"] as const;
type ChannelKey = (typeof CHANNEL_KEYS)[number];
function isChannelKey(v: unknown): v is ChannelKey {
  return typeof v === "string" && (CHANNEL_KEYS as readonly string[]).includes(v);
}

/** The feed link(s) + existing 3-step registration instructions for whatever
 *  channels are currently enabled — shared by GET and PATCH so the panel
 *  always has the same "here's your feed, here's how to register it"
 *  material next to the honesty-guarded employer note (never a claim that a
 *  job is actually live on Indeed/ZipRecruiter — that's Indeed/ZipRecruiter's
 *  own review, see lib/job-distribution.ts's header). Generates the
 *  employer's feed token on demand (same lazy-create as distribute_job's
 *  own artifact builder) rather than only after a chat approval, now that
 *  every plan can reach this without going through Taylor at all. */
async function feedMaterial(employerId: string, channels: DistributionChannels) {
  if (!channels.indeedFeed?.enabled && !channels.zipRecruiter?.enabled) {
    return { indeedFeedUrl: null, zipRecruiterFeedUrl: null, indeedInstructions: null, zipRecruiterInstructions: null };
  }
  const token = await ensureEmployerFeedToken(employerId);
  const indeedFeedUrl = token && channels.indeedFeed?.enabled ? buildIndeedFeedUrl(appUrl(), token) : null;
  const zipRecruiterFeedUrl = token && channels.zipRecruiter?.enabled ? buildZipRecruiterFeedUrl(appUrl(), token) : null;
  return {
    indeedFeedUrl,
    zipRecruiterFeedUrl,
    indeedInstructions: indeedFeedUrl ? buildIndeedFeedInstructions(indeedFeedUrl) : null,
    zipRecruiterInstructions: zipRecruiterFeedUrl ? buildZipRecruiterFeedInstructions(zipRecruiterFeedUrl) : null,
  };
}

/** GET — the current channel state for one job's distribution panel
 *  (Combined Build, Section 5). Open on every plan (Nov 9 ruling:
 *  Indeed/ZipRecruiter distribution ships on every tier, not just Scale+ —
 *  LinkedIn stays share-only regardless of tier, unaffected by this). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const job = await getJob(ctx.employerId, id);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  const row = await getDistribution(ctx.employerId, id);
  const channels = row?.channels || {};
  const material = await feedMaterial(ctx.employerId, channels);
  return NextResponse.json({ allowed: true, isPublic: isJobCurrentlyPublic(job), channels, ...material });
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

  const material = await feedMaterial(ctx.employerId, row.channels);
  return NextResponse.json({ ok: true, channels: row.channels, ...material });
}
