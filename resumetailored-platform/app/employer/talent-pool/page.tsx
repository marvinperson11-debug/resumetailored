import { redirect } from "next/navigation";
import { employerContext } from "@/lib/employer-auth";
import { canBrowseTalentPool, canContactTalentPool } from "@/lib/employer-plan";
import { TalentPoolClient } from "./talent-pool-client";

export const dynamic = "force-dynamic";

/** Portal and above can browse (Q1); Free renders the SAME page with
 *  `locked` true, same "visible behind an upgrade banner, never hidden"
 *  convention as the Employees hub / Time suite (LockedModuleBanner). Scale
 *  and above additionally gets the Contact button — `canContact` controls
 *  that second, narrower gate inside an otherwise-unlocked page. */
export default async function EmployerTalentPoolPage() {
  const ctx = await employerContext();
  if (!ctx) redirect("/employer");
  return <TalentPoolClient locked={!canBrowseTalentPool(ctx.access)} canContact={canContactTalentPool(ctx.access)} />;
}
