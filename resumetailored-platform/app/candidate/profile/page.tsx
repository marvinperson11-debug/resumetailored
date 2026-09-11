import { auth } from "@clerk/nextjs/server";
import { getUserProfile, DEFAULT_PROFILE } from "@/lib/profile-store";
import { ProfileClient } from "./profile-client";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const { userId } = await auth();
  const profile = userId ? await getUserProfile(userId) : { ...DEFAULT_PROFILE };
  return <ProfileClient initial={profile} />;
}
