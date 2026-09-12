"use client";

import { useRef, useState } from "react";
import { UserButton, useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Camera, User, Settings, Languages } from "lucide-react";
import { setLocaleCookie } from "./language-switcher";

/**
 * Top-right avatar dropdown. Wraps Clerk's <UserButton> (which provides account
 * management + Sign out → afterSignOutUrl="/") and adds custom menu actions:
 * Upload photo, Profile, Settings, and a Language submenu (English / 中文).
 */
export function ProfileButton() {
  const { user } = useUser();
  const router = useRouter();
  const t = useTranslations("topbar");
  const tl = useTranslations("lang");
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user || busy) return;
    setBusy(true);
    try {
      await user.setProfileImage({ file });
      await user.reload();
    } catch (err) {
      console.warn("[profile] photo upload failed:", err);
    } finally {
      setBusy(false);
    }
  };

  const setLang = (code: string) => {
    setLocaleCookie(code);
    router.refresh();
  };

  return (
    <>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onFile} />
      <UserButton afterSignOutUrl="/" appearance={{ elements: { avatarBox: "h-8 w-8" } }}>
        <UserButton.MenuItems>
          <UserButton.Action label={t("profile")} labelIcon={<User className="h-4 w-4" />} onClick={() => router.push("/candidate/profile")} />
          <UserButton.Action label={t("settings")} labelIcon={<Settings className="h-4 w-4" />} onClick={() => router.push("/candidate/settings")} />
          <UserButton.Action label={`${t("language")}: ${tl("en")}`} labelIcon={<Languages className="h-4 w-4" />} onClick={() => setLang("en")} />
          <UserButton.Action label={`${t("language")}: ${tl("zh")}`} labelIcon={<Languages className="h-4 w-4" />} onClick={() => setLang("zh")} />
          <UserButton.Action label={busy ? "Uploading photo…" : "Upload photo"} labelIcon={<Camera className="h-4 w-4" />} onClick={() => inputRef.current?.click()} />
        </UserButton.MenuItems>
      </UserButton>
    </>
  );
}
