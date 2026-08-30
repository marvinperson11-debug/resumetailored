// POST /api/apply-queue/import — pull the user's main ResumeTailored queue into
// local JobApplication rows, so the AutoApply dashboard's Score / Prepare /
// Apply flows (which operate on local job ids) work on the synced jobs.
//
// Idempotent: matches an existing local job by (userId, jobUrl) and updates it
// (recording sourceQueueId + mapped status) rather than duplicating. New items
// are created with a placeholder description — the main queue stores only the
// job identity (title/company/url/board), not the full JD, so the user re-pastes
// it before scoring if they want AI output. Session-only (needs a user id).

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fetchMainQueue, bridgeConfigured } from "@/lib/main-app-queue";

export const dynamic = "force-dynamic";

const PLACEHOLDER_JD =
  "(Imported from your ResumeTailored apply queue. The full job description was not synced — paste it here to enable AI scoring and preparation.)";

export async function POST() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const email = session?.user?.email?.toLowerCase();
  if (!userId || !email) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!bridgeConfigured()) return NextResponse.json({ error: "bridge_unconfigured" }, { status: 503 });

  let items;
  try {
    items = await fetchMainQueue(email);
  } catch {
    return NextResponse.json({ error: "main_app_unreachable" }, { status: 502 });
  }

  let imported = 0;
  let updated = 0;
  for (const it of items) {
    if (!it.jobUrl) continue;
    const existing = await prisma.jobApplication.findFirst({
      where: { userId, jobUrl: it.jobUrl },
      select: { id: true },
    });
    if (existing) {
      await prisma.jobApplication.update({
        where: { id: existing.id },
        data: { sourceQueueId: it.mainId, status: it.status },
      });
      updated++;
    } else {
      await prisma.jobApplication.create({
        data: {
          userId,
          companyName: it.companyName || "(unknown)",
          roleTitle: it.roleTitle || "(untitled role)",
          jobUrl: it.jobUrl,
          jobDescription: PLACEHOLDER_JD,
          status: it.status,
          sourceQueueId: it.mainId,
        },
      });
      imported++;
    }
  }
  return NextResponse.json({ imported, updated, total: items.length, synced: true });
}
