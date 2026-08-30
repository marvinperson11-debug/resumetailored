// api-identity.ts — resolve the acting user's email for the apply-queue proxy
// routes, from EITHER the NextAuth browser session (dashboard) OR a bearer
// ExtensionToken (browser extension). Email is the identity shared with the
// main ResumeTailored app, so these routes can proxy to it on the user's behalf.

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { userIdFromExtensionToken } from "@/lib/extension-auth";

/**
 * Returns the signed-in user's email, or null. Tries the NextAuth session
 * first, then a `Authorization: Bearer <extension token>` header.
 */
export async function resolveUserEmail(req: Request): Promise<string | null> {
  // 1) Browser session (dashboard pages / same-origin fetches).
  const session = await getServerSession(authOptions);
  const sessionEmail = session?.user?.email;
  if (sessionEmail) return sessionEmail.toLowerCase();

  // 2) Extension bearer token (cross-origin employer tab / popup).
  const auth = req.headers.get("authorization");
  const userId = await userIdFromExtensionToken(auth);
  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (user?.email) return user.email.toLowerCase();
  }
  return null;
}
