import { employerContext } from "@/lib/employer-auth";
import { canBrowseTalentPool, canContactTalentPool } from "@/lib/employer-plan";
import { getAccess } from "@/lib/plan";
import { TalentPoolClient } from "./talent-pool-client";

export const dynamic = "force-dynamic";

/** Portal and above can browse (Q1); Free renders the SAME page with
 *  `locked` true, same "visible behind an upgrade banner, never hidden"
 *  convention as the Employees hub / Time suite (LockedModuleBanner). Scale
 *  and above additionally gets the Contact button — `canContact` controls
 *  that second, narrower gate inside an otherwise-unlocked page.
 *
 *  A signed-out visitor (no employerContext) is the anonymous employer taste
 *  now rather than a redirect: `getAccess()` already resolves to the same
 *  FREE object a brand-new signed-up account would get, so `locked` comes
 *  out true exactly like it does for Free — no special case needed. */
export default async function EmployerTalentPoolPage() {
  const ctx = await employerContext();
  const access = ctx?.access ?? (await getAccess());
  return <TalentPoolClient locked={!canBrowseTalentPool(access)} canContact={canContactTalentPool(access)} />;
}
