/**
 * Encryption at rest for onboarding paperwork's sensitive fields (bank
 * account/routing numbers on the direct-deposit form). Same AES-256-GCM
 * shape as lib/docusign.ts's refresh-token encryption, but deliberately a
 * SEPARATE key (`PAPERWORK_ENC_KEY`) rather than reusing DOCUSIGN_SECRET_KEY
 * — a bank account number is more sensitive than an OAuth refresh token, and
 * the two systems' keys should never be tied together.
 *
 * Unlike docusign.ts's fallback-to-plaintext, this FAILS CLOSED: with no key
 * configured, `encryptBankField` throws rather than storing a bank number in
 * the clear. "V1 collects it, V1 does not move money" still has to mean the
 * number is actually protected at rest.
 */
import crypto from "crypto";

const ENC_PREFIX = "enc:v1:";

function encKey(): Buffer | null {
  const material = process.env.PAPERWORK_ENC_KEY;
  if (!material) return null;
  return crypto.scryptSync(material, "onboarding-paperwork-v1", 32);
}

export function paperworkEncryptionConfigured(): boolean {
  return !!encKey();
}

/** Encrypts a sensitive field. Throws if no PAPERWORK_ENC_KEY is configured
 *  — callers must check `paperworkEncryptionConfigured()` first and decline
 *  the write with a clear message instead of ever calling this unguarded. */
export function encryptBankField(plain: string): string {
  const key = encKey();
  if (!key) throw new Error("PAPERWORK_ENC_KEY is not configured.");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENC_PREFIX + [iv.toString("hex"), tag.toString("hex"), ct.toString("hex")].join(":");
}

export function decryptBankField(stored: string | null | undefined): string {
  if (!stored || !stored.startsWith(ENC_PREFIX)) return "";
  const key = encKey();
  if (!key) return ""; // encrypted value but no key to read it — fail closed
  try {
    const [ivHex, tagHex, ctHex] = stored.slice(ENC_PREFIX.length).split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(ctHex, "hex")), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

/** Last 4 characters for display, e.g. "····4321" — never the full number
 *  after entry, per the product rule. */
export function last4(plain: string): string {
  const digits = (plain || "").replace(/\s+/g, "");
  return digits.slice(-4);
}
