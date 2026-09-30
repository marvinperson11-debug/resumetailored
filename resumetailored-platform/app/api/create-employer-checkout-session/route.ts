import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";

const PAID_PLANS = new Set(["portal", "scale", "corporate"]);

/**
 * Starts an Employer Portal/Scale/Corporate Stripe checkout for the
 * SIGNED-IN user, mirroring /api/create-checkout-session (the candidate Pro
 * flow) exactly.
 *
 * The email is taken from the Clerk session — never from the request body —
 * so a client cannot start checkout for someone else. Stripe itself lives on
 * the old site, which owns the secret key, the employer price ids, and the
 * checkout.session.completed webhook that grants the tier; this route simply
 * proxies to its shared-secret `/api/app-employer-checkout` endpoint and
 * returns the Stripe URL for the browser to redirect to. Choosing a plan here
 * never grants it — only a completed payment does, via the existing webhook.
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

  const body = await req.json().catch(() => ({} as { returnUrl?: string; plan?: string }));
  const APP_ORIGIN = "https://app.resumetailored.com";
  const returnUrl =
    typeof body.returnUrl === "string" && body.returnUrl.startsWith(APP_ORIGIN)
      ? body.returnUrl
      : `${APP_ORIGIN}/employer`;
  const plan = typeof body.plan === "string" ? body.plan.toLowerCase() : "";
  if (!PAID_PLANS.has(plan)) {
    return NextResponse.json({ error: "bad_plan" }, { status: 400 });
  }

  try {
    const res = await fetch(`${base}/api/app-employer-checkout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, returnUrl, plan }),
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
