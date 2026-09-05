import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

/**
 * The dashboard app has no marketing landing page — resumetailored.com is the
 * only marketing site. Root simply routes people where they belong:
 *   - signed out  -> /sign-in
 *   - signed in   -> their dashboard (default /candidate)
 */
export default async function Home() {
  const { userId } = await auth();
  redirect(userId ? "/candidate" : "/sign-in");
}
