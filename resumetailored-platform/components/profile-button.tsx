"use client";

import { UserButton, useClerk } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Camera, User, Settings, Languages } from "lucide-react";
import { setLocaleCookie } from "./language-switcher";

/**
 * Top-right avatar dropdown. Wraps Clerk's <UserButton> (which provides account
 * management + Sign out → afterSignOutUrl="/") and adds custom menu actions:
 * Upload photo (opens Clerk's account-profile page, where photo upload is
 * native), Profile, Settings, and a Language submenu (English / 中文).
 */
export function ProfileButton() {
  const { openUserProfile } = useClerk();
  const router = useRouter();
  const t = useTranslations("topbar");
  const tl = useTranslations("lang");

  const setLang = (code: string) => {
    setLocaleCookie(code);
    router.refresh();
  };

  return (
    <UserButton afterSignOutUrl="/" appearance={{ elements: { avatarBox: "h-8 w-8" } }}>
      <UserButton.MenuItems>
        <UserButton.Action label={t("profile")} labelIcon={<User className="h-4 w-4" />} onClick={() => router.push("/candidate/profile")} />
        <UserButton.Action label={t("settings")} labelIcon={<Settings className="h-4 w-4" />} onClick={() => router.push("/candidate/settings")} />
        <UserButton.Action label={`${t("language")}: ${tl("en")}`} labelIcon={<Languages className="h-4 w-4" />} onClick={() => setLang("en")} />
        <UserButton.Action label={`${t("language")}: ${tl("zh")}`} labelIcon={<Languages className="h-4 w-4" />} onClick={() => setLang("zh")} />
        <UserButton.Action label="Upload photo" labelIcon={<Camera className="h-4 w-4" />} onClick={() => openUserProfile()} />
      </UserButton.MenuItems>
    </UserButton>
  );
}
