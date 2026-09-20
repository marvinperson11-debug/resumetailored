import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { EmployeeMessage, EmployeeThread, MessageSender } from "./employee-hub";
import { listEmployees } from "./employees-store";

/**
 * Employee ↔ employer direct messages. One implicit thread per (employer,
 * employee). Same service-role + employer_id-scoped pattern as the other
 * employer stores; best-effort (unconfigured/unreachable Supabase resolves to
 * empty reads / null writes, never a throw).
 */
let cached: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

const COLS = "id, employee_id, sender, body, read_at, created_at";

function mapMessage(r: Record<string, unknown>): EmployeeMessage {
  return {
    id: r.id as number,
    employeeId: r.employee_id as number,
    sender: (r.sender === "employee" ? "employee" : "employer") as MessageSender,
    body: (r.body as string) || "",
    readAt: (r.read_at as string) || null,
    createdAt: (r.created_at as string) || "",
  };
}

/** All messages in one (employer, employee) thread, oldest first. */
export async function listThread(employerId: string, employeeId: number): Promise<EmployeeMessage[]> {
  const c = db();
  if (!c || !employerId || !employeeId) return [];
  try {
    const { data, error } = await c
      .from("employee_messages")
      .select(COLS)
      .eq("employer_id", employerId)
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: true })
      .limit(1000);
    if (error || !data) return [];
    return data.map(mapMessage);
  } catch {
    return [];
  }
}

/** Post a message into a thread from either side. */
export async function postMessage(
  employerId: string,
  employeeId: number,
  sender: MessageSender,
  body: string
): Promise<EmployeeMessage | null> {
  const c = db();
  if (!c || !employerId || !employeeId) return null;
  const text = (body || "").trim().slice(0, 8000);
  if (!text) return null;
  try {
    const { data, error } = await c
      .from("employee_messages")
      .insert({ employer_id: employerId, employee_id: employeeId, sender, body: text })
      .select(COLS)
      .single();
    if (error || !data) {
      console.error("[postMessage]", error);
      return null;
    }
    return mapMessage(data);
  } catch (e) {
    console.error("[postMessage]", e);
    return null;
  }
}

/** Mark every message from `fromSender` in a thread as read (best-effort). Used
 *  when a side opens the thread, so the other side's unread badge clears. */
export async function markThreadRead(employerId: string, employeeId: number, fromSender: MessageSender): Promise<void> {
  const c = db();
  if (!c || !employerId || !employeeId) return;
  try {
    await c
      .from("employee_messages")
      .update({ read_at: new Date().toISOString() })
      .eq("employer_id", employerId)
      .eq("employee_id", employeeId)
      .eq("sender", fromSender)
      .is("read_at", null);
  } catch {
    /* best-effort */
  }
}

/**
 * The employer's employee-message inbox: one summary row per employee who has at
 * least one message, newest thread first. Built from a single message scan +
 * the employee roster (both already owner-scoped), so no N+1 queries.
 */
export async function listThreadsForEmployer(employerId: string): Promise<EmployeeThread[]> {
  const c = db();
  if (!c || !employerId) return [];
  try {
    const { data } = await c
      .from("employee_messages")
      .select("employee_id, sender, body, read_at, created_at")
      .eq("employer_id", employerId)
      .order("created_at", { ascending: false })
      .limit(5000);
    const rows = (data || []) as Record<string, unknown>[];
    if (!rows.length) return [];

    const employees = await listEmployees(employerId);
    const byId = new Map(employees.map((e) => [e.id, e]));

    const acc = new Map<number, EmployeeThread>();
    for (const r of rows) {
      const eid = r.employee_id as number;
      const emp = byId.get(eid);
      if (!emp) continue; // employee removed
      const sender: MessageSender = r.sender === "employee" ? "employee" : "employer";
      let t = acc.get(eid);
      if (!t) {
        // Rows arrive newest-first, so the first one we see per employee is the last message.
        t = {
          employee: { id: emp.id, name: emp.name, email: emp.email, role: emp.role, inviteStatus: emp.inviteStatus },
          lastMessage: (r.body as string) || "",
          lastSender: sender,
          lastAt: (r.created_at as string) || "",
          unread: 0,
        };
        acc.set(eid, t);
      }
      if (sender === "employee" && !r.read_at) t.unread += 1;
    }
    return Array.from(acc.values()).sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
  } catch {
    return [];
  }
}
