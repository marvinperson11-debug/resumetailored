import { auth } from "@clerk/nextjs/server";
import { getAccess, isStaffEmployee, type Access } from "./plan";
import { getEmployeeByClerkUserId } from "./employees-store";
import type { Employee } from "./employee-hub";

/**
 * Resolve the current request to a workforce employee, or null. Used by the
 * /employee portal layout, pages, and API routes so they can 401/403 uniformly.
 * The employee row is looked up by (employerId, clerkUserId) — both come from
 * the account's Clerk metadata, so it can only ever resolve the caller's own
 * row within their own employer's workspace.
 */
export interface EmployeeContext {
  userId: string;
  employerId: string;
  employeeId: number;
  employee: Employee;
  access: Access;
}

export async function employeeContext(): Promise<EmployeeContext | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const access = await getAccess();
  if (!isStaffEmployee(access) || !access.employerId) return null;
  const employee = await getEmployeeByClerkUserId(access.employerId, userId);
  // The metadata says staff, but the row must still exist and be bound to this
  // user (belt and suspenders — a removed employee loses portal access).
  if (!employee || employee.clerkUserId !== userId) return null;
  return { userId, employerId: access.employerId, employeeId: employee.id, employee, access };
}
