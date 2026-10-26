/**
 * TEMPORARY-DIAGNOSTIC — added to chase a reported staleness gap in the public
 * jobs sitemap and the Indeed feed (a job stayed absent from both routes long
 * after publish, even after the routes themselves were made dynamic/no-store
 * in a prior fix). This goes one layer deeper than the route: it hits the
 * Supabase REST endpoint directly, with the SAME host + service-role key the
 * shared `db()` client in lib/employer-store.ts / lib/job-distribution-store.ts
 * uses for the jobs query, and reads back the `Date` response header — a
 * timestamp that can only come from a live round trip through PostgREST. If
 * two calls made seconds apart ever show the SAME dbDate while nodeNow keeps
 * advancing, something between the route and Postgres is answering from a
 * cached response rather than hitting the database. Best-effort: an
 * unconfigured/unreachable Supabase resolves to a null dbDate, never a throw,
 * same house rule as every other *-store.ts in this codebase.
 *
 * TODO(operator): remove this file and its two call sites
 * (app/sitemap.xml/route.ts, app/api/jobs/feed/[token]/route.ts) once the
 * live probe data confirms the fix, same as the prior canary revert.
 */
export async function tempDiagnosticDbProbe(): Promise<{ dbDate: string | null; nodeNow: string }> {
  const nodeNow = new Date().toISOString();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return { dbDate: null, nodeNow };
  try {
    const res = await fetch(`${url}/rest/v1/job_postings?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    const dbDate = res.headers.get("date");
    console.log(`[TEMPORARY-DIAGNOSTIC] db-probe nodeNow=${nodeNow} dbDate=${dbDate}`);
    return { dbDate, nodeNow };
  } catch (e) {
    console.log(`[TEMPORARY-DIAGNOSTIC] db-probe failed nodeNow=${nodeNow} error=${(e as Error)?.message || e}`);
    return { dbDate: null, nodeNow };
  }
}
