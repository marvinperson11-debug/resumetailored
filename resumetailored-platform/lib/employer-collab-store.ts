import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  Message,
  MessageAttachment,
  MessageSender,
  Conversation,
  Shortlist,
  Interview,
  InterviewMode,
  InterviewStatus,
  Applicant,
} from "./employer-ai";

/**
 * Employer Portal Phase 1A persistence — messages, shortlists, and interviews.
 * Mirrors employer-store.ts: one service-role client, every query scoped by
 * employer_id and (for anything hanging off an applicant) an ownership check
 * that the applicant's job belongs to this employer. Best-effort throughout —
 * an unconfigured/unreachable Supabase resolves to empty reads and false
 * writes, never a throw.
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

// ── Ownership helpers ─────────────────────────────────────────────────────────
/** True when the applicant's job belongs to this employer. */
async function ownsApplicant(c: SupabaseClient, employerId: string, applicantId: number): Promise<boolean> {
  const { data } = await c.from("applicants").select("job_id").eq("id", applicantId).maybeSingle();
  if (!data) return false;
  const { data: job } = await c
    .from("job_postings")
    .select("id")
    .eq("id", data.job_id as number)
    .eq("employer_id", employerId)
    .maybeSingle();
  return !!job;
}

interface ApplicantInfo {
  name: string;
  email: string;
  jobId: number;
  jobTitle: string;
}
async function applicantInfoMap(c: SupabaseClient, ids: number[]): Promise<Map<number, ApplicantInfo>> {
  const map = new Map<number, ApplicantInfo>();
  if (!ids.length) return map;
  const { data } = await c.from("applicants").select("id, name, email, job_id").in("id", Array.from(new Set(ids)));
  const rows = data || [];
  const jobIds = Array.from(new Set(rows.map((r) => r.job_id as number)));
  const titles = new Map<number, string>();
  if (jobIds.length) {
    const { data: jobs } = await c.from("job_postings").select("id, title").in("id", jobIds);
    for (const j of jobs || []) titles.set(j.id as number, (j.title as string) || "");
  }
  for (const r of rows) {
    map.set(r.id as number, {
      name: (r.name as string) || "",
      email: (r.email as string) || "",
      jobId: r.job_id as number,
      jobTitle: titles.get(r.job_id as number) || "",
    });
  }
  return map;
}

// ── Messages ────────────────────────────────────────────────────────────────
function sanitizeAttachments(v: unknown): MessageAttachment[] {
  if (!Array.isArray(v)) return [];
  const out: MessageAttachment[] = [];
  for (const a of v.slice(0, 10)) {
    if (!a || typeof a !== "object") continue;
    const name = String((a as Record<string, unknown>).name || "").slice(0, 200);
    const url = String((a as Record<string, unknown>).url || "").slice(0, 4000);
    if (!name || !url) continue;
    // Only allow http(s) and data: URLs so the value is safe to render as a link.
    if (!/^(https?:|data:)/i.test(url)) continue;
    const rawKind = String((a as Record<string, unknown>).kind || "");
    const kind: MessageAttachment["kind"] = rawKind === "pdf" || rawKind === "image" ? rawKind : "file";
    out.push({ name, url, kind });
  }
  return out;
}

function mapMessage(r: Record<string, unknown>): Message {
  return {
    id: r.id as number,
    applicantId: r.applicant_id as number,
    sender: (r.sender as MessageSender) || "employer",
    content: (r.content as string) || "",
    attachments: sanitizeAttachments(r.attachments),
    read: !!r.read,
    createdAt: (r.created_at as string) || "",
  };
}

const MSG_COLS = "id, applicant_id, sender, content, attachments, read, created_at";

/** Inbox: the latest message per candidate for this employer, newest first. */
export async function listConversations(employerId: string): Promise<Conversation[]> {
  const c = db();
  if (!c || !employerId) return [];
  try {
    const { data } = await c
      .from("messages")
      .select("applicant_id, sender, content, read, created_at")
      .eq("employer_id", employerId)
      .order("created_at", { ascending: false })
      .limit(5000);
    const rows = data || [];
    if (!rows.length) return [];
    const info = await applicantInfoMap(c, rows.map((r) => r.applicant_id as number));

    const byApplicant = new Map<number, Conversation>();
    for (const r of rows) {
      const id = r.applicant_id as number;
      const existing = byApplicant.get(id);
      const inboundUnread = r.sender === "candidate" && !r.read ? 1 : 0;
      if (!existing) {
        const meta = info.get(id);
        // Skip messages whose applicant no longer belongs to this employer.
        if (!meta) continue;
        byApplicant.set(id, {
          applicantId: id,
          name: meta.name,
          email: meta.email,
          jobTitle: meta.jobTitle,
          lastMessage: (r.content as string) || "",
          lastSender: (r.sender as MessageSender) || "employer",
          lastAt: (r.created_at as string) || "",
          unread: inboundUnread,
        });
      } else {
        existing.unread += inboundUnread;
      }
    }
    // rows are already newest-first, so the first seen per applicant is the last message.
    return Array.from(byApplicant.values());
  } catch {
    return [];
  }
}

/** Full thread for one candidate, oldest → newest. */
export async function getThread(employerId: string, applicantId: number): Promise<Message[]> {
  const c = db();
  if (!c || !employerId || !Number.isFinite(applicantId)) return [];
  try {
    if (!(await ownsApplicant(c, employerId, applicantId))) return [];
    const { data } = await c
      .from("messages")
      .select(MSG_COLS)
      .eq("employer_id", employerId)
      .eq("applicant_id", applicantId)
      .order("created_at", { ascending: true })
      .limit(2000);
    return (data || []).map(mapMessage);
  } catch {
    return [];
  }
}

export async function sendMessage(
  employerId: string,
  applicantId: number,
  content: string,
  attachments: MessageAttachment[] = [],
  sender: MessageSender = "employer"
): Promise<Message | null> {
  const c = db();
  if (!c || !employerId || !Number.isFinite(applicantId)) return null;
  const clean = sanitizeAttachments(attachments);
  const body = (content || "").trim().slice(0, 8000);
  if (!body && !clean.length) return null;
  try {
    if (!(await ownsApplicant(c, employerId, applicantId))) return null;
    const { data, error } = await c
      .from("messages")
      .insert({
        employer_id: employerId,
        applicant_id: applicantId,
        sender,
        content: body,
        attachments: clean,
        // An employer's own outbound message is already "read" by them.
        read: sender === "employer",
      })
      .select(MSG_COLS)
      .single();
    if (error || !data) return null;
    return mapMessage(data);
  } catch {
    return null;
  }
}

/** Mark inbound (candidate) messages in one thread as read. */
export async function markThreadRead(employerId: string, applicantId: number): Promise<boolean> {
  const c = db();
  if (!c || !employerId || !Number.isFinite(applicantId)) return false;
  try {
    if (!(await ownsApplicant(c, employerId, applicantId))) return false;
    const { error } = await c
      .from("messages")
      .update({ read: true })
      .eq("employer_id", employerId)
      .eq("applicant_id", applicantId)
      .eq("sender", "candidate")
      .eq("read", false);
    return !error;
  } catch {
    return false;
  }
}

// ── Shortlists ────────────────────────────────────────────────────────────────
function mapShortlist(r: Record<string, unknown>, memberCount: number): Shortlist {
  return {
    id: r.id as number,
    name: (r.name as string) || "",
    description: (r.description as string) || "",
    memberCount,
    createdAt: (r.created_at as string) || "",
    updatedAt: (r.updated_at as string) || "",
  };
}

export async function listShortlists(employerId: string): Promise<Shortlist[]> {
  const c = db();
  if (!c || !employerId) return [];
  try {
    const { data, error } = await c
      .from("shortlists")
      .select("id, name, description, created_at, updated_at")
      .eq("employer_id", employerId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error || !data) return [];
    const counts = new Map<number, number>();
    if (data.length) {
      const { data: members } = await c
        .from("shortlist_members")
        .select("shortlist_id")
        .in("shortlist_id", data.map((r) => r.id as number))
        .limit(20000);
      for (const m of members || []) counts.set(m.shortlist_id as number, (counts.get(m.shortlist_id as number) || 0) + 1);
    }
    return data.map((r) => mapShortlist(r, counts.get(r.id as number) || 0));
  } catch {
    return [];
  }
}

export async function createShortlist(employerId: string, name: string, description = ""): Promise<Shortlist | null> {
  const c = db();
  if (!c || !employerId || !name.trim()) return null;
  try {
    const { data, error } = await c
      .from("shortlists")
      .insert({ employer_id: employerId, name: name.trim().slice(0, 120), description: description.trim().slice(0, 1000) || null })
      .select("id, name, description, created_at, updated_at")
      .single();
    if (error || !data) return null;
    return mapShortlist(data, 0);
  } catch {
    return null;
  }
}

export async function updateShortlist(
  employerId: string,
  id: number,
  patch: Partial<{ name: string; description: string }>
): Promise<boolean> {
  const c = db();
  if (!c || !employerId) return false;
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) {
    if (!patch.name.trim()) return false;
    row.name = patch.name.trim().slice(0, 120);
  }
  if (patch.description !== undefined) row.description = patch.description.trim().slice(0, 1000) || null;
  try {
    const { error } = await c.from("shortlists").update(row).eq("employer_id", employerId).eq("id", id);
    return !error;
  } catch {
    return false;
  }
}

export async function deleteShortlist(employerId: string, id: number): Promise<boolean> {
  const c = db();
  if (!c || !employerId) return false;
  try {
    const { error } = await c.from("shortlists").delete().eq("employer_id", employerId).eq("id", id);
    return !error;
  } catch {
    return false;
  }
}

async function ownsShortlist(c: SupabaseClient, employerId: string, shortlistId: number): Promise<boolean> {
  const { data } = await c.from("shortlists").select("id").eq("id", shortlistId).eq("employer_id", employerId).maybeSingle();
  return !!data;
}

/** Members of a shortlist as full applicant rows (ownership-checked). */
export async function getShortlistMembers(employerId: string, shortlistId: number): Promise<Applicant[]> {
  const c = db();
  if (!c || !employerId) return [];
  try {
    if (!(await ownsShortlist(c, employerId, shortlistId))) return [];
    const { data: mem } = await c
      .from("shortlist_members")
      .select("applicant_id, added_at")
      .eq("shortlist_id", shortlistId)
      .order("added_at", { ascending: false })
      .limit(2000);
    const ids = (mem || []).map((m) => m.applicant_id as number);
    if (!ids.length) return [];
    const { data } = await c
      .from("applicants")
      .select("id, job_id, name, email, resume_text, cover_letter, match_score, match_analysis, status, notes, created_at")
      .in("id", ids);
    const info = await applicantInfoMap(c, ids);
    const rows = data || [];
    // Preserve the added_at ordering from the membership query.
    const order = new Map(ids.map((id, i) => [id, i] as const));
    rows.sort((a, b) => (order.get(a.id as number) ?? 0) - (order.get(b.id as number) ?? 0));
    return rows.map((r) => ({
      id: r.id as number,
      jobId: r.job_id as number,
      jobTitle: info.get(r.id as number)?.jobTitle,
      name: (r.name as string) || "",
      email: (r.email as string) || "",
      resumeText: (r.resume_text as string) || "",
      coverLetter: (r.cover_letter as string) || "",
      matchScore: typeof r.match_score === "number" ? (r.match_score as number) : null,
      matchAnalysis: (r.match_analysis as Applicant["matchAnalysis"]) ?? null,
      status: (r.status as Applicant["status"]) || "new",
      notes: (r.notes as string) || "",
      createdAt: (r.created_at as string) || "",
    }));
  } catch {
    return [];
  }
}

export async function addShortlistMember(employerId: string, shortlistId: number, applicantId: number): Promise<boolean> {
  const c = db();
  if (!c || !employerId) return false;
  try {
    if (!(await ownsShortlist(c, employerId, shortlistId))) return false;
    if (!(await ownsApplicant(c, employerId, applicantId))) return false;
    const { error } = await c
      .from("shortlist_members")
      .upsert({ shortlist_id: shortlistId, applicant_id: applicantId }, { onConflict: "shortlist_id,applicant_id" });
    return !error;
  } catch {
    return false;
  }
}

export async function removeShortlistMember(employerId: string, shortlistId: number, applicantId: number): Promise<boolean> {
  const c = db();
  if (!c || !employerId) return false;
  try {
    if (!(await ownsShortlist(c, employerId, shortlistId))) return false;
    const { error } = await c.from("shortlist_members").delete().eq("shortlist_id", shortlistId).eq("applicant_id", applicantId);
    return !error;
  } catch {
    return false;
  }
}

// ── Interviews ────────────────────────────────────────────────────────────────
const INT_COLS =
  "id, applicant_id, job_id, title, scheduled_at, duration_min, mode, location, interviewer, notes, status, created_at";

function mapInterview(r: Record<string, unknown>, info?: ApplicantInfo): Interview {
  return {
    id: r.id as number,
    applicantId: r.applicant_id as number,
    applicantName: info?.name,
    jobId: (r.job_id as number) ?? null,
    jobTitle: info?.jobTitle,
    title: (r.title as string) || "",
    scheduledAt: (r.scheduled_at as string) || "",
    durationMin: typeof r.duration_min === "number" ? (r.duration_min as number) : 30,
    mode: (r.mode as InterviewMode) || "video",
    location: (r.location as string) || "",
    interviewer: (r.interviewer as string) || "",
    notes: (r.notes as string) || "",
    status: (r.status as InterviewStatus) || "scheduled",
    createdAt: (r.created_at as string) || "",
  };
}

export async function listInterviews(
  employerId: string,
  f: { status?: InterviewStatus; applicantId?: number } = {}
): Promise<Interview[]> {
  const c = db();
  if (!c || !employerId) return [];
  try {
    let q = c.from("interviews").select(INT_COLS).eq("employer_id", employerId);
    if (f.status) q = q.eq("status", f.status);
    if (f.applicantId) q = q.eq("applicant_id", f.applicantId);
    const { data, error } = await q.order("scheduled_at", { ascending: true }).limit(2000);
    if (error || !data) return [];
    const info = await applicantInfoMap(c, data.map((r) => r.applicant_id as number));
    return data.map((r) => mapInterview(r, info.get(r.applicant_id as number)));
  } catch {
    return [];
  }
}

export interface InterviewInput {
  applicantId: number;
  jobId?: number | null;
  title: string;
  scheduledAt: string;
  durationMin?: number;
  mode?: InterviewMode;
  location?: string;
  interviewer?: string;
  notes?: string;
}

function interviewRow(v: Partial<InterviewInput> & { status?: InterviewStatus }): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (v.jobId !== undefined) row.job_id = v.jobId ?? null;
  if (v.title !== undefined) row.title = v.title.trim().slice(0, 200);
  if (v.scheduledAt !== undefined) row.scheduled_at = v.scheduledAt;
  if (v.durationMin !== undefined) row.duration_min = Math.max(5, Math.min(1440, Math.round(v.durationMin)));
  if (v.mode !== undefined) row.mode = v.mode;
  if (v.location !== undefined) row.location = v.location.trim().slice(0, 500) || null;
  if (v.interviewer !== undefined) row.interviewer = v.interviewer.trim().slice(0, 200) || null;
  if (v.notes !== undefined) row.notes = v.notes.trim().slice(0, 4000) || null;
  if (v.status !== undefined) row.status = v.status;
  return row;
}

export async function createInterview(employerId: string, v: InterviewInput): Promise<Interview | null> {
  const c = db();
  if (!c || !employerId || !v.title?.trim() || !v.scheduledAt || !Number.isFinite(v.applicantId)) return null;
  try {
    if (!(await ownsApplicant(c, employerId, v.applicantId))) return null;
    const { data, error } = await c
      .from("interviews")
      .insert({ employer_id: employerId, applicant_id: v.applicantId, mode: v.mode || "video", duration_min: v.durationMin ?? 30, ...interviewRow(v) })
      .select(INT_COLS)
      .single();
    if (error || !data) return null;
    const info = await applicantInfoMap(c, [v.applicantId]);
    return mapInterview(data, info.get(v.applicantId));
  } catch {
    return null;
  }
}

export async function updateInterview(
  employerId: string,
  id: number,
  patch: Partial<InterviewInput> & { status?: InterviewStatus }
): Promise<boolean> {
  const c = db();
  if (!c || !employerId) return false;
  const row = interviewRow(patch);
  if (!Object.keys(row).length) return false;
  row.updated_at = new Date().toISOString();
  try {
    const { error } = await c.from("interviews").update(row).eq("employer_id", employerId).eq("id", id);
    return !error;
  } catch {
    return false;
  }
}

export async function deleteInterview(employerId: string, id: number): Promise<boolean> {
  const c = db();
  if (!c || !employerId) return false;
  try {
    const { error } = await c.from("interviews").delete().eq("employer_id", employerId).eq("id", id);
    return !error;
  } catch {
    return false;
  }
}
