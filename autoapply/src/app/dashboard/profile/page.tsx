import { getSessionUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ResumeUploader } from "@/components/resume-uploader";
import { ProfileForm } from "@/components/profile-form";
import { ExtensionTokenPanel } from "@/components/extension-token-panel";
import type { JobPreferences, ResumeData } from "@/lib/types";

export default async function ProfilePage() {
  const userId = await getSessionUserId();
  const user = userId
    ? await prisma.user.findUnique({
        where: { id: userId },
        select: { resumeData: true, preferences: true },
      })
    : null;

  return (
    <div className="space-y-8 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Profile</h1>
        <p className="text-sm text-muted-foreground">
          Your resume and preferences power match scoring, tailoring, and auto-fill.
        </p>
      </div>

      <ResumeUploader initial={(user?.resumeData as unknown as ResumeData) ?? null} />
      <ProfileForm initial={(user?.preferences as unknown as JobPreferences) ?? null} />
      <ExtensionTokenPanel />
    </div>
  );
}
