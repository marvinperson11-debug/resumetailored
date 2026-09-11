import { currentUser, clerkClient } from "@clerk/nextjs/server";

/**
 * Role-based access control.
 *
 * Every account is one of four roles, stored on Clerk `publicMetadata`:
 *   free      → { plan: "free",     type: "individual" }
 *   pro       → { plan: "pro",      type: "individual" }               ($19/mo or $129 lifetime)
 *   employer  → { plan: "employer", type: "organization", tier }       ($49+/mo)
 *   employee  → { plan: "employee", type: "employee", employerId, employerName? }
 *
 * Access rules:
 *   - Individual Pro tools (Resume Video, Web Studio): pro OR employee.
 *   - Employer Portal (team, candidates, jobs):        employer only.
 *   - Free tools:                                       everyone.
 *
 * The Stripe webhook on resumetailored.com sets this metadata after payment.
 * A pay-first buyer can complete checkout before their Clerk account exists, so
 * when `plan` is unset we backfill it from the old subscriber DB (the source of
 * truth) via the shared-secret /api/entitlement endpoint and persist it to
 * Clerk. Fully defensive: any failure resolves to the FREE individual role
 * (the safe default) and never throws.
 */
export type Plan = "free" | "pro" | "employer" | "employee";
export type AccountType = "individual" | "organization" | "employee";

export interface Access {
  plan: Plan;
  type: AccountType;
  tier?: string;
  /** For an employee account: the employer (organization) they belong to. */
  employerId?: string;
  employerName?: string;
}

const FREE: Access = { plan: "free", type: "individual" };

function normalize(meta: {
  plan?: string;
  type?: string;
  tier?: string;
  employerId?: string;
  employerName?: string;
}): Access | null {
  const plan = meta.plan;
  if (plan === "pro" || plan === "free" || plan === "employer" || plan === "employee") {
    return {
      plan,
      type:
        (meta.type as AccountType) ||
        (plan === "employer" ? "organization" : plan === "employee" ? "employee" : "individual"),
      tier: meta.tier,
      employerId: meta.employerId,
      employerName: meta.employerName,
    };
  }
  return null;
}

export async function getAccess(): Promise<Access> {
  try {
    const user = await currentUser();
    if (!user) return FREE;

    const fromMeta = normalize((user.publicMetadata ?? {}) as Record<string, string>);
    if (fromMeta) return fromMeta;

    // Flag unset → one-time backfill from the old subscriber DB.
    const email = user.emailAddresses?.[0]?.emailAddress;
    const base = process.env.LEGACY_SITE_URL || "https://resumetailored.com";
    const secret = process.env.ENTITLEMENT_SYNC_SECRET;
    if (!email || !secret) return FREE;

    const res = await fetch(`${base}/api/entitlement?email=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
    });
    if (!res.ok) return FREE;
    const data = (await res.json()) as { plan?: string; type?: string; tier?: string };
    const access = normalize(data) ?? FREE;
    if (access.plan === "free") return FREE;

    // Persist so the next read skips the network round-trip.
    try {
      const client = await clerkClient();
      await client.users.updateUserMetadata(user.id, {
        publicMetadata: {
          plan: access.plan,
          type: access.type,
          ...(access.tier ? { tier: access.tier } : {}),
          subscribedAt: new Date().toISOString(),
        },
      });
    } catch {
      // Non-fatal: the user still has the role this request; retry the write next time.
    }
    return access;
  } catch {
    return FREE;
  }
}

// ── Role predicates ──────────────────────────────────────────────────────────
/** Individual Pro tools (Resume Video, Web Studio): Pro or an employer's employee. */
export function canUseIndividualPro(a: Access): boolean {
  return a.plan === "pro" || a.plan === "employee";
}
/** Employer Portal (team, candidates, job posting). */
export function isEmployer(a: Access): boolean {
  return a.plan === "employer";
}

/** Anyone who belongs to a company workspace: the employer owner, or one of
 *  their invited employees. Both reach /employer (scoped to the same data). */
export function canUseEmployerPortal(a: Access): boolean {
  return a.plan === "employer" || (a.plan === "employee" && !!a.employerId);
}

/** The company workspace id for a request: the employer's own id, or (for an
 *  employee) the employer they were invited into. `null` if neither applies. */
export function resolveEmployerId(a: Access, userId: string | null): string | null {
  if (a.plan === "employer" && userId) return userId;
  if (a.plan === "employee" && a.employerId) return a.employerId;
  return null;
}

/** Legacy helper — true only for an individual Pro subscriber. */
export async function isPro(): Promise<boolean> {
  return (await getAccess()).plan === "pro";
}
