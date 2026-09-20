import { NextResponse, type NextRequest } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { listLibrary, seedLibrary } from "@/lib/training-library";
import { LIBRARY_SEED } from "@/lib/training-library-seed";

export const runtime = "nodejs";

/**
 * Admin-only, idempotent one-time setup: populate the built-in Training Library
 * from `LIBRARY_SEED` (app code) instead of pasting seed SQL. Same shape as the
 * Daily register-webhook route.
 *
 * - `GET`        → read-only status (how many of the seed rows are present).
 * - `GET ?do=1`  → seed if missing (open the URL — no console needed).
 * - `POST`       → same as `GET ?do=1`.
 *
 * Operational outcomes return HTTP 200 with `ok:false` + a `code` (a 5xx would
 * be masked by the Cloudflare layer in front of this app); only real auth
 * rejection is a 403 (4xx passes through). The insert is an upsert on the
 * `source_url` unique key with `ignoreDuplicates`, so it is safe to hit twice.
 */
export async function GET(req: NextRequest) {
  return safe(async () => {
    const guard = await requireAdmin();
    if (guard) return guard;
    if (req.nextUrl.searchParams.get("do") === "1") return run();

    const present = await listLibrary();
    return NextResponse.json({
      ok: true,
      seeded: present.length,
      expected: LIBRARY_SEED.length,
      complete: present.length >= LIBRARY_SEED.length,
      hint: present.length >= LIBRARY_SEED.length ? "Library is populated." : "Open this URL with ?do=1 to populate it.",
    });
  });
}

export async function POST() {
  return safe(async () => {
    const guard = await requireAdmin();
    if (guard) return guard;
    return run();
  });
}

/** Seed (idempotent). Shared by POST and GET?do=1. */
async function run(): Promise<NextResponse> {
  const result = await seedLibrary();
  if (!result.ok) {
    console.error("[seed-library] seed failed:", result.error);
    return NextResponse.json(
      { ...result, code: "seed_error", error: `Could not seed the library: ${result.error}. Has migration 0030 been applied?` },
      { status: 200 }
    );
  }
  return NextResponse.json({
    ok: true,
    status: result.inserted > 0 ? "seeded" : "already_seeded",
    inserted: result.inserted,
    total: result.after,
    expected: LIBRARY_SEED.length,
  });
}

async function requireAdmin(): Promise<NextResponse | null> {
  let ctx: Awaited<ReturnType<typeof employerContext>> = null;
  try {
    ctx = await employerContext();
  } catch (e) {
    console.error("[seed-library] auth resolution failed", e);
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  if (!ctx) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  if (!ctx.access.isAdmin) return NextResponse.json({ ok: false, error: "Admin only." }, { status: 403 });
  return null;
}

/** Turn any thrown error into a VISIBLE 200 `ok:false` (a 5xx would be masked
 *  by the Cloudflare layer) and log it. */
async function safe(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (e) {
    const err = e as { name?: string; message?: string };
    console.error("[seed-library] handler threw", err?.name, err?.message, e);
    return NextResponse.json(
      { ok: false, code: "internal", error: `Internal error: ${err?.name || "Error"}: ${err?.message || "unknown"}` },
      { status: 200 }
    );
  }
}
