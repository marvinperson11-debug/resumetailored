import { currentUser, clerkClient } from "@clerk/nextjs/server";

/**
 * Lightweight per-user daily usage counters, stored on Clerk `privateMetadata`
 * so they are server-authoritative and need no separate database. Shape:
 *   privateMetadata.usage = { "<feature>": { date: "YYYY-MM-DD", count: n } }
 *
 * Used to enforce the free tier's "1 ATS scan / day" gate. Pro users bypass the
 * check at the call site. Fully defensive: any Clerk failure resolves to
 * "allowed" so a metadata hiccup never blocks a paying or free user unfairly.
 */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

type UsageMap = Record<string, { date: string; count: number }>;

export interface UsageState {
  used: number;
  limit: number;
  remaining: number;
  allowed: boolean;
}

/** Read current usage for a feature without mutating anything. */
export async function peekUsage(feature: string, limit: number): Promise<UsageState> {
  try {
    const user = await currentUser();
    if (!user) return { used: 0, limit, remaining: limit, allowed: true };
    const usage = ((user.privateMetadata as { usage?: UsageMap } | undefined)?.usage || {}) as UsageMap;
    const rec = usage[feature];
    const used = rec && rec.date === today() ? rec.count : 0;
    return { used, limit, remaining: Math.max(0, limit - used), allowed: used < limit };
  } catch {
    return { used: 0, limit, remaining: limit, allowed: true };
  }
}

/** Atomically consume one unit if under the limit. Returns the post-consume state. */
export async function consumeUsage(feature: string, limit: number): Promise<UsageState> {
  try {
    const user = await currentUser();
    if (!user) return { used: 0, limit, remaining: limit, allowed: true };
    const usage = ((user.privateMetadata as { usage?: UsageMap } | undefined)?.usage || {}) as UsageMap;
    const rec = usage[feature];
    const used = rec && rec.date === today() ? rec.count : 0;
    if (used >= limit) return { used, limit, remaining: 0, allowed: false };
    const next = used + 1;
    const client = await clerkClient();
    await client.users.updateUserMetadata(user.id, {
      privateMetadata: { usage: { ...usage, [feature]: { date: today(), count: next } } },
    });
    return { used: next, limit, remaining: Math.max(0, limit - next), allowed: true };
  } catch {
    // Non-fatal: allow the action rather than block on a metadata write failure.
    return { used: 0, limit, remaining: limit, allowed: true };
  }
}
