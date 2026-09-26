import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { getEmployee } from "@/lib/employees-store";
import { listThread, postMessage, markThreadRead } from "@/lib/employee-messages-store";
import { logActivityForEmployee } from "@/lib/notifications-store";

export const runtime = "nodejs";

/** GET one employee thread (and mark the employee's messages read). `id` is the
 *  employee id. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const employeeId = Number(params.id);
  if (!Number.isFinite(employeeId)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const employee = await getEmployee(ctx.employerId, employeeId);
  if (!employee) return NextResponse.json({ error: "Employee not found." }, { status: 404 });

  const messages = await listThread(ctx.employerId, employeeId);
  await markThreadRead(ctx.employerId, employeeId, "employee");
  return NextResponse.json({
    employee: { id: employee.id, name: employee.name, email: employee.email, role: employee.role, inviteStatus: employee.inviteStatus },
    messages,
  });
}

/** POST a reply from the employer to an employee. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const employeeId = Number(params.id);
  if (!Number.isFinite(employeeId)) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const employee = await getEmployee(ctx.employerId, employeeId);
  if (!employee) return NextResponse.json({ error: "Employee not found." }, { status: 404 });

  const b = (await req.json().catch(() => ({}))) as { body?: string };
  const msg = await postMessage(ctx.employerId, employeeId, "employer", b.body || "");
  if (!msg) return NextResponse.json({ error: "Message is empty or could not be sent." }, { status: 400 });

  logActivityForEmployee(ctx.employerId, employeeId, {
    eventType: "message_received",
    title: "New message from your employer",
    body: (b.body || "").slice(0, 140),
    link: "/employee/messages",
  }).catch(() => {});

  return NextResponse.json({ message: msg });
}
