/**
 * Certifications — shared types and pure helpers (no DB, no network). Mirrors
 * the `time-hub.ts` / `employee-hub.ts` convention.
 */

export type CertAddedBy = "employer" | "employee";
export const isCertAddedBy = (v: unknown): v is CertAddedBy => v === "employer" || v === "employee";

export interface EmployeeCert {
  id: number;
  employeeId: number;
  name: string;
  issuedDate: string | null; // YYYY-MM-DD
  expiryDate: string | null; // YYYY-MM-DD
  fileUrl: string | null; // storage path, never a public URL
  addedBy: CertAddedBy;
  reminder30SentAt: string | null;
  reminder7SentAt: string | null;
  createdAt: string;
}

export type CertStatus = "ok" | "expiring" | "expired" | "no_expiry";

/** Days from `now` to the cert's expiry (negative once expired). Null when
 *  there's no expiry date to compare against. */
export function daysUntilExpiry(cert: Pick<EmployeeCert, "expiryDate">, now: number = Date.now()): number | null {
  if (!cert.expiryDate) return null;
  const expiry = new Date(cert.expiryDate + "T00:00:00Z").getTime();
  if (Number.isNaN(expiry)) return null;
  const today = new Date(now);
  const todayUTC = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((expiry - todayUTC) / 86_400_000);
}

/** ok (>30d out) / expiring (0-30d, inclusive) / expired (past) / no_expiry. */
export function certStatus(cert: Pick<EmployeeCert, "expiryDate">, now: number = Date.now()): CertStatus {
  const days = daysUntilExpiry(cert, now);
  if (days === null) return "no_expiry";
  if (days < 0) return "expired";
  if (days <= 30) return "expiring";
  return "ok";
}

export const CERT_STATUS_TONE: Record<CertStatus, "teal" | "gold" | "red" | "neutral"> = {
  ok: "teal",
  expiring: "red",
  expired: "red",
  no_expiry: "neutral",
};
export const CERT_STATUS_LABELS: Record<CertStatus, string> = {
  ok: "Valid",
  expiring: "Expiring soon",
  expired: "Expired",
  no_expiry: "No expiry",
};

/** Whether any cert in a list is expiring/expired — drives the red compliance
 *  flag on the employee directory row. */
export function hasExpiringCert(certs: Pick<EmployeeCert, "expiryDate">[], now: number = Date.now()): boolean {
  return certs.some((c) => {
    const s = certStatus(c, now);
    return s === "expiring" || s === "expired";
  });
}

/** Which reminder window(s) a cert is due for, given its expiry and which
 *  markers are already stamped. A cert can be due for both windows at once
 *  (e.g. added with 3 days left) — the caller sends each once. Pure so the
 *  cron job and its tests share one source of truth. */
export function reminderWindowsDue(
  cert: Pick<EmployeeCert, "expiryDate" | "reminder30SentAt" | "reminder7SentAt">,
  now: number = Date.now()
): Array<"30" | "7"> {
  const days = daysUntilExpiry(cert, now);
  if (days === null) return [];
  const due: Array<"30" | "7"> = [];
  if (days <= 30 && !cert.reminder30SentAt) due.push("30");
  if (days <= 7 && !cert.reminder7SentAt) due.push("7");
  return due;
}
