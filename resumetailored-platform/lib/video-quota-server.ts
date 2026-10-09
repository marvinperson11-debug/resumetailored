import { currentUser } from "@clerk/nextjs/server";
import { getAccess } from "./plan";
import { isLifetimeAccount } from "./tailor-variants";
import { videoPlanKind, videoQuota, type VideoPlanKind, type VideoQuota } from "./video-quota";

export interface VideoContext {
  email: string | null;
  kind: VideoPlanKind;
  planLabel: string;
  quota: VideoQuota;
}

/** Who this signed-in user is for Resume Video purposes: their plan kind, the label used in owner alerts, and this month's quota. */
export async function getVideoContext(userId: string): Promise<VideoContext> {
  const access = await getAccess();
  const email = (await currentUser())?.emailAddresses?.[0]?.emailAddress ?? null;
  const lifetime = await isLifetimeAccount(access, userId, email);
  const kind = videoPlanKind(access, lifetime);
  const planLabel = access.isAdmin ? "Admin" : access.plan === "employee" ? "Employee (staff)" : lifetime ? "Pro Lifetime" : "Pro monthly";
  return { email, kind, planLabel, quota: await videoQuota(userId, kind) };
}
