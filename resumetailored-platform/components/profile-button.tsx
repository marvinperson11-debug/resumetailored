"use client";

import { useRef, useState } from "react";
import { UserButton, useUser } from "@clerk/nextjs";
import { Camera } from "lucide-react";

/**
 * The top-right profile avatar. Wraps Clerk's <UserButton> and adds a custom
 * "Upload photo" menu action (FIX 4): it opens a file picker and saves the
 * chosen image to the user's Clerk profile via `user.setProfileImage`, which
 * persists it on the Clerk user record and updates the avatar everywhere.
 */
export function ProfileButton() {
  const { user } = useUser();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
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

  return (
    <>
      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onFile} />
      <UserButton afterSignOutUrl="/" appearance={{ elements: { avatarBox: "h-8 w-8" } }}>
        <UserButton.MenuItems>
          <UserButton.Action
            label={busy ? "Uploading photo…" : "Upload photo"}
            labelIcon={<Camera className="h-4 w-4" />}
            onClick={() => inputRef.current?.click()}
          />
        </UserButton.MenuItems>
      </UserButton>
    </>
  );
}
