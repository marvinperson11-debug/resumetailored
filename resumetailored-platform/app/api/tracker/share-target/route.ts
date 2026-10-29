import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { appUrl } from "@/lib/subdomain";
import { clipFromUrl } from "@/lib/tracker-clip";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Pull the first http(s) URL out of free text — Android's share sheet often
 *  puts the shared link in `text` (sometimes alongside a caption) rather
 *  than in the separate `url` param the Web Share Target spec defines. */
function firstUrlIn(text: string): string | null {
  const m = /https?:\/\/[^\s]+/i.exec(text || "");
  return m ? m[0] : null;
}

/** GET — clip path (b): the PWA share target (app/manifest.ts
 *  `share_target`). This is a full browser navigation from the OS share
 *  sheet, not a fetch — so a signed-out share just sends the candidate to
 *  sign in (the shared link itself isn't carried through that redirect;
 *  they can re-share once signed in). A successful clip lands on the
 *  tracker board with the new card visible. */
export async function GET(req: Request) {
  const { userId } = await auth();
  const qs = new URL(req.url).searchParams;
  const shared = qs.get("url") || firstUrlIn(qs.get("text") || "") || "";

  if (!userId) {
    return NextResponse.redirect(appUrl("/sign-in?redirect_url=/candidate/tracker"));
  }
  if (!shared) {
    return NextResponse.redirect(appUrl("/candidate/tracker?shareError=no_url"));
  }

  const result = await clipFromUrl(userId, shared);
  if (!result.ok) {
    return NextResponse.redirect(appUrl(`/candidate/tracker?shareError=${encodeURIComponent(result.code || "failed")}`));
  }
  return NextResponse.redirect(appUrl(`/candidate/tracker?clipped=${result.application!.id}`));
}
