"use client";

import { UserButton, useClerk } from "@clerk/nextjs";
import { useRouter, usePathname } from "next/navigation";
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
  const pathname = usePathname();
  const t = useTranslations("topbar");
  const tl = useTranslations("lang");

  // Route the Profile/Settings menu items to the shell the user is actually in,
  // so a workforce employee never gets bounced onto the candidate pages (and the
  // candidate sidebar drawer). Inside /employee → the scoped employee pages;
  // everywhere else keeps the existing candidate destinations.
  const inEmployee = pathname?.startsWith("/employee") ?? false;
  const profileHref = inEmployee ? "/employee/profile" : "/candidate/profile";
  const settingsHref = inEmployee ? "/employee/settings" : "/candidate/settings";

  const setLang = (code: string) => {
    setLocaleCookie(code);
    router.refresh();
  };

  return (
    <UserButton
      afterSignOutUrl="/"
      appearance={{
        // Dark-theme the popover so menu items aren't ghosted against the card.
        // `variables` set readable near-white text on the app's navy background;
        // the element classes add visible hover/pressed states. Applies wherever
        // ProfileButton is used (employer + candidate shells).
        variables: {
          colorBackground: "#0B0F19",
          colorText: "#F8FAFC",
          colorTextSecondary: "#A9AEB8",
          colorPrimary: "#8B5CF6",
          colorInputBackground: "#0B0F19",
          colorInputText: "#F8FAFC",
        },
        elements: {
          avatarBox: "h-8 w-8",
          userButtonPopoverCard: "bg-navy border border-border-gold text-cream",
          userButtonPopoverMain: "bg-navy",
          userButtonPopoverActionButton: "text-cream hover:bg-white/10 active:bg-white/[0.14]",
          userButtonPopoverActionButtonText: "text-cream",
          userButtonPopoverActionButtonIcon: "text-muted-cream",
          userButtonPopoverCustomItemButton: "text-cream hover:bg-white/10 active:bg-white/[0.14]",
          userButtonPopoverCustomItemButtonText: "text-cream",
          userButtonPopoverCustomItemButtonIcon: "text-muted-cream",
          userButtonPopoverFooter: "bg-navy border-t border-border-gold",
        },
      }}
    >
      <UserButton.MenuItems>
        <UserButton.Action label={t("profile")} labelIcon={<User className="h-4 w-4" />} onClick={() => router.push(profileHref)} />
        <UserButton.Action label={t("settings")} labelIcon={<Settings className="h-4 w-4" />} onClick={() => router.push(settingsHref)} />
        <UserButton.Action label={`${t("language")}: ${tl("en")}`} labelIcon={<Languages className="h-4 w-4" />} onClick={() => setLang("en")} />
        <UserButton.Action label={`${t("language")}: ${tl("zh")}`} labelIcon={<Languages className="h-4 w-4" />} onClick={() => setLang("zh")} />
        <UserButton.Action label="Upload photo" labelIcon={<Camera className="h-4 w-4" />} onClick={() => openUserProfile()} />
      </UserButton.MenuItems>
    </UserButton>
  );
}
