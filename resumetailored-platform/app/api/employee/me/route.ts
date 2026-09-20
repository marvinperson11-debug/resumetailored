import { NextResponse } from "next/server";
import { employeeContext } from "@/lib/employee-auth";
import { listActiveAnnouncements } from "@/lib/announcements-store";
import { listThread } from "@/lib/employee-messages-store";

export const runtime = "nodejs";

/**
 * The employee's own portal summary: their profile, active announcements
 * (pinned first) for the home screen, and the count of unread messages from
 * their employer. Everything is resolved from the caller's linked employee row,
 * so it can only ever return their own data.
 */
export async function GET() {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const [announcements, thread] = await Promise.all([
    listActiveAnnouncements(ctx.employerId),
    listThread(ctx.employerId, ctx.employeeId),
  ]);
  // Unread = messages from the employer the employee hasn't seen (badge only;
  // marking read happens when they open Messages).
  const unread = thread.filter((m) => m.sender === "employer" && !m.readAt).length;

  return NextResponse.json({
    employee: {
      id: ctx.employee.id,
      name: ctx.employee.name,
      email: ctx.employee.email,
      role: ctx.employee.role,
      startDate: ctx.employee.startDate,
      status: ctx.employee.status,
    },
    announcements,
    unreadMessages: unread,
  });
}
