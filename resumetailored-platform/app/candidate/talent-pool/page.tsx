import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getTalentPoolProfile, previewForCandidate } from "@/lib/talent-pool-store";
import { resolveUserIdentity } from "@/lib/email";
import { defaultVisibility } from "@/lib/talent-pool-core";
import { TalentPoolClient } from "./talent-pool-client";

export const dynamic = "force-dynamic";

/** Candidate opt-in is free on every tier (Q1) — no plan check here, unlike
 *  the employer side's Portal/Scale gates. */
export default async function TalentPoolPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/candidate/talent-pool");

  const [profile, identity] = await Promise.all([getTalentPoolProfile(userId), resolveUserIdentity(userId)]);
  const initial = profile ?? {
    id: "",
    candidateId: userId,
    isDiscoverable: false,
    headline: "",
    skills: [],
    location: "",
    desiredRoles: [],
    yearsExperience: null,
    workAuthorization: "",
    bio: "",
    visibility: defaultVisibility(),
    optedInAt: null,
    optedOutAt: null,
    createdAt: "",
    updatedAt: "",
  };
  const preview = profile ? previewForCandidate(profile, identity) : null;

  return <TalentPoolClient initial={initial} initialPreview={preview} />;
}
