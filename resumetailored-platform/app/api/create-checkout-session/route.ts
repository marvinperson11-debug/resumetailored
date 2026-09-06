import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";

/**
 * Starts a Pro ($19/mo) Stripe checkout for the SIGNED-IN user.
 *
 * The email is taken from the Clerk session — never from the request body — so
 * a client cannot start checkout for someone else. The price is fixed to Pro on
 * the old server; the client cannot choose it. Stripe itself lives on the old
 * site (resumetailored.com), which owns the secret key, the Pro price id, and
 * the checkout.session.completed webhook that grants Pro; this route simply
 * proxies to its shared-secret `/api/app-checkout` endpoint and returns the
 * Stripe URL for the browser to redirect to.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  const email = user?.emailAddresses?.[0]?.emailAddress;
  if (!email) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const secret = process.env.ENTITLEMENT_SYNC_SECRET;
  const base = process.env.LEGACY_SITE_URL || "https://resumetailored.com";
  if (!secret) {
    return NextResponse.json({ error: "not_configured" }, { status: 501 });
  }

  const body = await req.json().catch(() => ({} as { returnUrl?: string }));
  const APP_ORIGIN = "https://app.resumetailored.com";
  const returnUrl =
    typeof body.returnUrl === "string" && body.returnUrl.startsWith(APP_ORIGIN)
      ? body.returnUrl
      : `${APP_ORIGIN}/candidate`;

  try {
    const res = await fetch(`${base}/api/app-checkout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, returnUrl }),
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !data.url) {
      return NextResponse.json(
        { error: data.error || "checkout_failed" },
        { status: 502 }
      );
    }
    return NextResponse.json({ url: data.url });
  } catch {
    return NextResponse.json({ error: "checkout_unavailable" }, { status: 502 });
  }
}
