import { auth } from "@clerk/nextjs/server";
import { getAccess, resolveEmployerId, type Access } from "./plan";

/**
 * Resolve the company workspace id for the current request. Returns the employer
 * (organization) account's own userId, or — for an invited employee — the
 * employer they belong to. `null` when the caller is neither, so every employer
 * API route can 401/403 uniformly.
 */
export async function requireEmployerId(): Promise<string | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const access = await getAccess();
  return resolveEmployerId(access, userId);
}

/** Like requireEmployerId, but also returns the caller's own userId + access. */
export async function employerContext(): Promise<{ employerId: string; userId: string; access: Access } | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const access = await getAccess();
  const employerId = resolveEmployerId(access, userId);
  if (!employerId) return null;
  return { employerId, userId, access };
}
