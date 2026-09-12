/**
 * Admin bypass. The single admin account sees both the Candidate and Employer
 * views (a top-bar toggle switches between them) and is treated as Pro
 * everywhere — every role/plan check passes for them.
 *
 * The id comes from the ADMIN_USER_ID env var when set, and falls back to this
 * hardcoded id if the env var is missing or empty — so admin access keeps
 * working even if the env var fails to load.
 */
const FALLBACK_ADMIN_USER_ID = "user_3Iy2uXv7HW15FGIF1b3mv7iZm1M";
export const ADMIN_USER_ID = process.env.ADMIN_USER_ID || FALLBACK_ADMIN_USER_ID;

export function isAdminId(userId: string | null | undefined): boolean {
  return !!userId && userId === ADMIN_USER_ID;
}
