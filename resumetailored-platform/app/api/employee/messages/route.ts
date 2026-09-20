import { NextResponse } from "next/server";
import { employeeContext } from "@/lib/employee-auth";
import { listThread, postMessage, markThreadRead } from "@/lib/employee-messages-store";

export const runtime = "nodejs";

/** GET the employee's thread with their employer (and mark employer messages read). */
export async function GET() {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const messages = await listThread(ctx.employerId, ctx.employeeId);
  await markThreadRead(ctx.employerId, ctx.employeeId, "employer");
  return NextResponse.json({ messages });
}

/** POST a message from the employee to their employer. */
export async function POST(req: Request) {
  const ctx = await employeeContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { body?: string };
  const msg = await postMessage(ctx.employerId, ctx.employeeId, "employee", b.body || "");
  if (!msg) return NextResponse.json({ error: "Message is empty or could not be sent." }, { status: 400 });
  return NextResponse.json({ message: msg });
}
