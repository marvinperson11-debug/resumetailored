import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Monthly DocuSign send-count — split out of lib/docusign-store.ts so that
 * lib/employer-plan.ts (reachable from instrumentation.ts, which Next.js
 * also compiles for the Edge runtime) can read it without statically
 * pulling in lib/docusign.ts's `encryptToken`/`decryptToken` (genuine
 * `node:crypto` AES-256-GCM, used for refresh-token-at-rest encryption —
 * not splittable the way the webhook-signature helpers were). Importing
 * the full lib/docusign-store.ts here would re-introduce the same
 * "Module not found: Can't resolve 'crypto'" edge-compile failure this
 * module exists to avoid. Own Supabase client, same best-effort pattern as
 * every other *-store.ts in this codebase (unconfigured/unreachable
 * Supabase resolves to 0, never a throw).
 */
let cached: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

/** Count offer-letter sends by this employer in the current calendar month (UTC). */
export async function monthlySendCount(employerId: string): Promise<number> {
  const c = db();
  if (!c || !employerId) return 0;
  try {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const { count } = await c
      .from("docusign_envelopes")
      .select("id", { count: "exact", head: true })
      .eq("employer_id", employerId)
      .gte("sent_at", monthStart);
    return count || 0;
  } catch {
    return 0;
  }
}
