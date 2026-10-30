import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canBrowseTalentPool } from "@/lib/employer-plan";
import { resolveUserIdentity } from "@/lib/email";
import { searchTalentPool } from "@/lib/talent-pool-store";
import type { TalentPoolSearchFilters } from "@/lib/talent-pool-core";

export const runtime = "nodejs";

/** GET — faceted search over discoverable Talent Pool profiles (Q2):
 *  skills, location, desired role, years of experience, plus free text over
 *  headline + bio. Portal and above (Q1) — a Free-tier employer is refused
 *  before any query runs, same shape as every other tier gate in this repo. */
export async function GET(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canBrowseTalentPool(ctx.access)) return NextResponse.json({ error: "Talent Pool search is available on the Portal plan and above.", code: "tier_locked" }, { status: 402 });

  const url = new URL(req.url);
  const skills = (url.searchParams.get("skills") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const minYears = Number(url.searchParams.get("minYearsExperience"));
  const filters: TalentPoolSearchFilters = {
    ...(skills.length ? { skills } : {}),
    ...(url.searchParams.get("location") ? { location: url.searchParams.get("location") || undefined } : {}),
    ...(url.searchParams.get("desiredRole") ? { desiredRole: url.searchParams.get("desiredRole") || undefined } : {}),
    ...(Number.isFinite(minYears) && minYears > 0 ? { minYearsExperience: minYears } : {}),
    ...(url.searchParams.get("q") ? { q: url.searchParams.get("q") || undefined } : {}),
  };

  const results = await searchTalentPool(filters, resolveUserIdentity);
  return NextResponse.json({ results });
}
