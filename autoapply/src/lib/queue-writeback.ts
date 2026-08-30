// queue-writeback.ts — after a local JobApplication status change, mirror it
// back to the main ResumeTailored app's queue when the job was imported from
// there (sourceQueueId set). Best-effort: any failure is logged, never thrown,
// so the local action always succeeds even if the main app is unreachable.

import { prisma } from "@/lib/prisma";
import { updateMainStatus, bridgeConfigured, type LocalStatus } from "@/lib/main-app-queue";

export async function syncStatusToMain(
  userId: string,
  sourceQueueId: string | null | undefined,
  localStatus: LocalStatus | string
): Promise<void> {
  if (!bridgeConfigured() || !sourceQueueId) return;
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (user?.email) await updateMainStatus(user.email.toLowerCase(), sourceQueueId, localStatus);
  } catch (err) {
    console.error("apply-queue status writeback failed", err);
  }
}
