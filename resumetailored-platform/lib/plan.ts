import { currentUser, clerkClient } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { isAdminId } from "./admin";

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
  /** The hardcoded admin: bypasses all role checks and is Pro everywhere.
   *  Cleared while a plan preview is active so gates evaluate the previewed plan. */
  isAdmin?: boolean;
  /** True whenever the signed-in user is the admin — even while previewing.
   *  Used to render admin-only UI (view toggle, plan-preview switcher). */
  realAdmin?: boolean;
  /** Active admin plan-preview (testing tool). Present ⇒ gates use the previewed
   *  plan, not the admin bypass. */
  preview?: { side: "employer" | "candidate"; plan: string; label: string };
}

const FREE: Access = { plan: "free", type: "individual" };

// ── Admin plan-preview (testing tool) ─────────────────────────────────────────
export const PLAN_PREVIEW_COOKIE = "rt_plan_preview";

/** Map a preview selection (cookie value `side:plan`) to an effective Access.
 *  Only ever applied AFTER the isAdmin check, so a non-admin forging the cookie
 *  gets nothing (no elevation possible). Returns null for an unknown selection. */
function previewToAccess(side: string, plan: string): Access | null {
  const base: Pick<Access, "realAdmin" | "preview"> = {
    realAdmin: true,
    preview: { side: side as "employer" | "candidate", plan, label: "" },
  };
  const label = (l: string): Access["preview"] => ({ side: side as "employer" | "candidate", plan, label: l });
  if (side === "employer") {
    if (plan === "free") return { ...base, plan: "free", type: "individual", preview: label("Free") };
    if (plan === "portal") return { ...base, plan: "employer", type: "organization", tier: "portal", preview: label("Portal") };
    if (plan === "scale") return { ...base, plan: "employer", type: "organization", tier: "scale", preview: label("Scale") };
    if (plan === "corporate") return { ...base, plan: "employer", type: "organization", tier: "corporate", preview: label("Corporate") };
  } else if (side === "candidate") {
    if (plan === "free") return { ...base, plan: "free", type: "individual", preview: label("Free") };
    if (plan === "pro") return { ...base, plan: "pro", type: "individual", preview: label("Pro") };
  }
  return null;
}

/** Read the admin plan-preview cookie into an effective Access, or null. */
function readPlanPreview(): Access | null {
  try {
    const raw = cookies().get(PLAN_PREVIEW_COOKIE)?.value || "";
    const [side, plan] = raw.split(":");
    if (!side || !plan) return null;
    return previewToAccess(side.trim(), plan.trim());
  } catch {
    return null;
  }
}

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

    // Admin bypass — Pro + both portals, regardless of stored metadata. A plan
    // preview (admin testing tool) is read HERE, after the id check, so it can
    // never elevate a non-admin: the previewed plan replaces the bypass and
    // gates then evaluate it honestly (isAdmin is not set while previewing).
    if (isAdminId(user.id)) {
      const preview = readPlanPreview();
      if (preview) return preview;
      return { plan: "pro", type: "individual", isAdmin: true, realAdmin: true };
    }

    const fromMeta = normalize((user.publicMetadata ?? {}) as Record<string, string>);
    if (fromMeta) return fromMeta;

    // Flag unset → one-time backfill from the old subscriber DB.
    const email = user.emailAddresses?.[0]?.emailAddress;
    const base = process.env.LEGACY_SITE_URL || "https://resumetailored.com";
    const secret = process.env.ENTITLEMENT_SYNC_SECRET;
    if (!email || !secret) return FREE;

    const res = await fetch(`${base}/api/entitlement?email=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${secret}` },
      // Cache per-email at the data layer so repeat loads don't re-hit the
      // legacy endpoint on every navigation. This matters most for FREE users:
      // their result isn't persisted to Clerk metadata (see below), so without
      // this they'd pay the network round-trip on every page. A real purchase
      // flips Clerk publicMetadata via the resumetailored.com webhook, which is
      // read ABOVE (fromMeta) before this fetch — so caching here can never
      // strand an upgrade.
      next: { revalidate: 300 },
      // Never let the legacy endpoint block first paint. Cap it at 1.5s and
      // fail open to FREE (the safe default); a later navigation resolves it.
      signal: AbortSignal.timeout(1500),
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
  return a.plan === "pro" || a.plan === "employee" || !!a.isAdmin;
}
/** Employer Portal (team, candidates, job posting). */
export function isEmployer(a: Access): boolean {
  return a.plan === "employer" || !!a.isAdmin;
}

/** Anyone who belongs to a company workspace: the employer owner, or one of
 *  their invited employees. Both reach /employer (scoped to the same data).
 *  The admin passes too (sees their own workspace via resolveEmployerId). */
export function canUseEmployerPortal(a: Access): boolean {
  return a.plan === "employer" || (a.plan === "employee" && !!a.employerId) || !!a.isAdmin;
}

/** The company workspace id for a request: the employer's own id, or (for an
 *  employee) the employer they were invited into. `null` if neither applies. */
export function resolveEmployerId(a: Access, userId: string | null): string | null {
  if (a.plan === "employer" && userId) return userId;
  if (a.plan === "employee" && a.employerId) return a.employerId;
  if (a.isAdmin && userId) return userId; // admin previews their own employer workspace
  return null;
}

/** Legacy helper — true only for an individual Pro subscriber. */
export async function isPro(): Promise<boolean> {
  return (await getAccess()).plan === "pro";
}

/** Server-side gate for the individual Pro tools (Resume Video, Personal
 *  Website): true for a Pro subscriber OR an employer's employee — mirroring
 *  `canUseIndividualPro`, so the API entitlement matches what the candidate UI
 *  shows. Use this (not `isPro`) for whole-tool Pro API gates. */
export async function isIndividualPro(): Promise<boolean> {
  return canUseIndividualPro(await getAccess());
}
