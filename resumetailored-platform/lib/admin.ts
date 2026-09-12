/**
 * Admin bypass. The single hardcoded admin account sees both the Candidate and
 * Employer views (a top-bar toggle switches between them) and is treated as Pro
 * everywhere — every role/plan check passes for them.
 */
export const ADMIN_USER_ID = "user_3Iy2uXv7HW15FGIF1b3mv7iZm1M";

export function isAdminId(userId: string | null | undefined): boolean {
  return !!userId && userId === ADMIN_USER_ID;
}
