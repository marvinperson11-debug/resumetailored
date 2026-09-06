import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

/**
 * The dashboard app has no marketing landing page — resumetailored.com is the
 * only marketing site. Root simply routes people where they belong, carrying a
 * Pro-upgrade intent (?upgrade=pro, set by the marketing site's Pro CTAs)
 * through sign-in so it survives to the dashboard:
 *   - signed out  -> /sign-in(?upgrade=pro)  (sign up / sign in FIRST)
 *   - signed in   -> /candidate(?upgrade=pro) (dashboard opens the upgrade modal)
 */
export default async function Home({
  searchParams,
}: {
  searchParams: { upgrade?: string };
}) {
  const { userId } = await auth();
  const upgrade = searchParams?.upgrade === "pro" ? "?upgrade=pro" : "";
  redirect(userId ? `/candidate${upgrade}` : `/sign-in${upgrade}`);
}
