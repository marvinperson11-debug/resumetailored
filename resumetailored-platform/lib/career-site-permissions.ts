/**
 * Who may delete (or re-create) an employer's career site: ONLY the owning employer account.
 * employerContext() also resolves an invited team member to their employer's workspace id, so
 * "has an employer id" is not enough — the caller's own user id must BE the workspace id.
 * Pure so the route and the regression test share one rule.
 */
export function canManageCareerSite(ctx: { userId: string; employerId: string } | null | undefined): boolean {
  return !!ctx && !!ctx.userId && !!ctx.employerId && ctx.userId === ctx.employerId;
}
