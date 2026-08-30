import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Create a new extension token for a user. Returns the raw token ONCE. */
export async function createExtensionToken(userId: string, label?: string) {
  const raw = `aa_${randomBytes(24).toString("hex")}`;
  await prisma.extensionToken.create({
    data: { userId, tokenHash: hashToken(raw), label: label ?? "Browser extension" },
  });
  return raw;
}

/**
 * Resolve a raw bearer token to a userId, or null. Updates lastUsedAt.
 * Rejects revoked tokens.
 */
export async function userIdFromExtensionToken(
  raw: string | null | undefined
): Promise<string | null> {
  if (!raw) return null;
  const token = raw.startsWith("Bearer ") ? raw.slice(7).trim() : raw.trim();
  if (!token) return null;

  const row = await prisma.extensionToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!row || row.revokedAt) return null;

  await prisma.extensionToken.update({
    where: { id: row.id },
    data: { lastUsedAt: new Date() },
  });
  return row.userId;
}
