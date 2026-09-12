import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  type EmployerProfile,
  type JobPosting,
  type Applicant,
  type TeamMember,
  type MatchAnalysis,
  type JobStatus,
  type ApplicantStatus,
  type TeamRole,
  type RemoteType,
  type EmploymentType,
} from "./employer-ai";

/**
 * Employer Dashboard persistence — employer_profiles / job_postings / applicants
 * / team_members / match_scores. One service-role client, every query scoped by
 * employer_id (the Clerk userId of the employer account) or, for applicants, by
 * the employer's own job ids. Best-effort throughout: an unconfigured/unreachable
 * Supabase resolves to empty reads and false writes, never a throw.
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

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];

// ── Profile ───────────────────────────────────────────────────────────────────
export async function getEmployerProfile(employerId: string): Promise<EmployerProfile | null> {
  const c = db();
  if (!c || !employerId) return null;
  try {
    const { data } = await c
      .from("employer_profiles")
      .select("company_name, company_website, industry, company_size")
      .eq("user_id", employerId)
      .maybeSingle();
    if (!data) return null;
    return {
      companyName: (data.company_name as string) || "",
      companyWebsite: (data.company_website as string) || "",
      industry: (data.industry as string) || "",
      companySize: (data.company_size as string) || "",
    };
  } catch {
    return null;
  }
}

export async function saveEmployerProfile(employerId: string, p: EmployerProfile): Promise<boolean> {
  const c = db();
  if (!c || !employerId || !p.companyName.trim()) return false;
  try {
    const { error } = await c.from("employer_profiles").upsert(
      {
        user_id: employerId,
        company_name: p.companyName.slice(0, 200),
        company_website: p.companyWebsite?.slice(0, 400) || null,
        industry: p.industry || null,
        company_size: p.companySize || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
    // On first save, ensure the owner appears in the team roster.
    if (!error) await ensureOwnerRow(c, employerId);
    return !error;
  } catch {
    return false;
  }
}

async function ensureOwnerRow(c: SupabaseClient, employerId: string, email?: string): Promise<void> {
  try {
    const { data } = await c
      .from("team_members")
      .select("id")
      .eq("employer_id", employerId)
      .eq("role", "owner")
      .maybeSingle();
    if (data) return;
    await c.from("team_members").insert({
      employer_id: employerId,
      user_id: employerId,
      email: email || "owner@account",
      role: "owner",
      status: "active",
    });
  } catch {
    /* best-effort */
  }
}

// ── Jobs ──────────────────────────────────────────────────────────────────────
function mapJob(r: Record<string, unknown>, applicantCount?: number): JobPosting {
  return {
    id: r.id as number,
    title: (r.title as string) || "",
    department: (r.department as string) || "",
    location: (r.location as string) || "",
    remoteType: ((r.remote_type as RemoteType) || "") as RemoteType | "",
    employmentType: ((r.employment_type as EmploymentType) || "") as EmploymentType | "",
    salaryMin: typeof r.salary_min === "number" ? (r.salary_min as number) : null,
    salaryMax: typeof r.salary_max === "number" ? (r.salary_max as number) : null,
    salaryCurrency: (r.salary_currency as string) || "USD",
    description: (r.description as string) || "",
    requirements: strList(r.requirements),
    niceToHaves: strList(r.nice_to_haves),
    deadline: (r.deadline as string) ?? null,
    status: (r.status as JobStatus) || "draft",
    publicListed: !!r.public_listed,
    applicantCount,
    createdAt: (r.created_at as string) || "",
    updatedAt: (r.updated_at as string) || "",
  };
}

const JOB_COLS =
  "id, title, department, location, remote_type, employment_type, salary_min, salary_max, salary_currency, description, requirements, nice_to_haves, deadline, status, public_listed, created_at, updated_at";

export async function listJobs(employerId: string): Promise<JobPosting[]> {
  const c = db();
  if (!c || !employerId) return [];
  try {
    const { data, error } = await c
      .from("job_postings")
      .select(JOB_COLS)
      .eq("employer_id", employerId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error || !data) return [];
    const counts = await applicantCountsByJob(c, data.map((r) => r.id as number));
    return data.map((r) => mapJob(r, counts.get(r.id as number) || 0));
  } catch {
    return [];
  }
}

export async function getJob(employerId: string, id: number): Promise<JobPosting | null> {
  const c = db();
  if (!c || !employerId) return null;
  try {
    const { data } = await c.from("job_postings").select(JOB_COLS).eq("employer_id", employerId).eq("id", id).maybeSingle();
    if (!data) return null;
    const counts = await applicantCountsByJob(c, [id]);
    return mapJob(data, counts.get(id) || 0);
  } catch {
    return null;
  }
}

type JobInput = Partial<{
  title: string;
  department: string;
  location: string;
  remoteType: string;
  employmentType: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string;
  description: string;
  requirements: string[];
  niceToHaves: string[];
  deadline: string | null;
  status: JobStatus;
  publicListed: boolean;
}>;

function jobRow(v: JobInput): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (v.title !== undefined) row.title = v.title.slice(0, 200);
  if (v.department !== undefined) row.department = v.department?.slice(0, 120) || null;
  if (v.location !== undefined) row.location = v.location?.slice(0, 200) || null;
  if (v.remoteType !== undefined) row.remote_type = v.remoteType || null;
  if (v.employmentType !== undefined) row.employment_type = v.employmentType || null;
  if (v.salaryMin !== undefined) row.salary_min = v.salaryMin ?? null;
  if (v.salaryMax !== undefined) row.salary_max = v.salaryMax ?? null;
  if (v.salaryCurrency !== undefined) row.salary_currency = v.salaryCurrency || "USD";
  if (v.description !== undefined) row.description = v.description.slice(0, 12000);
  if (v.requirements !== undefined) row.requirements = v.requirements.map((s) => s.slice(0, 300)).slice(0, 40);
  if (v.niceToHaves !== undefined) row.nice_to_haves = v.niceToHaves.map((s) => s.slice(0, 300)).slice(0, 40);
  if (v.deadline !== undefined) row.deadline = v.deadline || null;
  if (v.status !== undefined) row.status = v.status;
  if (v.publicListed !== undefined) row.public_listed = v.publicListed;
  return row;
}

export async function createJob(employerId: string, v: JobInput): Promise<JobPosting | null> {
  const c = db();
  if (!c || !employerId || !v.title?.trim() || !v.description?.trim()) return null;
  try {
    const { data, error } = await c
      .from("job_postings")
      .insert({ employer_id: employerId, ...jobRow(v) })
      .select(JOB_COLS)
      .single();
    if (error || !data) return null;
    return mapJob(data, 0);
  } catch {
    return null;
  }
}

export async function updateJob(employerId: string, id: number, v: JobInput): Promise<boolean> {
  const c = db();
  if (!c || !employerId) return false;
  try {
    const { error } = await c
      .from("job_postings")
      .update({ ...jobRow(v), updated_at: new Date().toISOString() })
      .eq("employer_id", employerId)
      .eq("id", id);
    return !error;
  } catch {
    return false;
  }
}

export async function deleteJob(employerId: string, id: number): Promise<boolean> {
  const c = db();
  if (!c || !employerId) return false;
  try {
    const { error } = await c.from("job_postings").delete().eq("employer_id", employerId).eq("id", id);
    return !error;
  } catch {
    return false;
  }
}

export async function duplicateJob(employerId: string, id: number): Promise<JobPosting | null> {
  const job = await getJob(employerId, id);
  if (!job) return null;
  return createJob(employerId, {
    title: `${job.title} (copy)`,
    department: job.department,
    location: job.location,
    remoteType: job.remoteType,
    employmentType: job.employmentType,
    salaryMin: job.salaryMin,
    salaryMax: job.salaryMax,
    salaryCurrency: job.salaryCurrency,
    description: job.description,
    requirements: job.requirements,
    niceToHaves: job.niceToHaves,
    deadline: job.deadline,
    status: "draft",
  });
}

// ── Public job board (Feature E) ──────────────────────────────────────────────
export interface PublicJobFilters {
  q?: string;
  location?: string;
  employmentType?: string;
  remoteType?: string;
  minSalary?: number;
}

async function companyNameMap(c: SupabaseClient, employerIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (!employerIds.length) return map;
  try {
    const { data } = await c.from("employer_profiles").select("user_id, company_name").in("user_id", Array.from(new Set(employerIds)));
    for (const r of data || []) map.set(r.user_id as string, (r.company_name as string) || "");
  } catch {
    /* ignore */
  }
  return map;
}

/** Active + public-listed jobs across all employers, newest first, filtered. */
export async function listPublicJobs(f: PublicJobFilters = {}): Promise<JobPosting[]> {
  const c = db();
  if (!c) return [];
  try {
    let q = c
      .from("job_postings")
      .select(JOB_COLS + ", employer_id")
      .eq("public_listed", true)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(500);
    if (f.employmentType) q = q.eq("employment_type", f.employmentType);
    if (f.remoteType) q = q.eq("remote_type", f.remoteType);
    if (typeof f.minSalary === "number") q = q.gte("salary_max", f.minSalary);
    const { data, error } = await q;
    if (error || !data) return [];
    const rows = data as unknown as Record<string, unknown>[];
    const names = await companyNameMap(c, rows.map((r) => r.employer_id as string));
    let jobs = rows.map((r) => ({ ...mapJob(r), company: names.get(r.employer_id as string) || "" }));
    // Free-text filter (title/description/company) + location, in JS.
    const qq = (f.q || "").toLowerCase().trim();
    const loc = (f.location || "").toLowerCase().trim();
    if (qq) jobs = jobs.filter((j) => `${j.title} ${j.description} ${j.company} ${j.department}`.toLowerCase().includes(qq));
    if (loc) jobs = jobs.filter((j) => j.location.toLowerCase().includes(loc) || j.remoteType === "remote");
    return jobs;
  } catch {
    return [];
  }
}

/** One active + public job by id, with company name (for the public detail page). */
export async function getPublicJob(id: number): Promise<JobPosting | null> {
  const c = db();
  if (!c || !Number.isFinite(id)) return null;
  try {
    const { data } = await c
      .from("job_postings")
      .select(JOB_COLS + ", employer_id")
      .eq("id", id)
      .eq("public_listed", true)
      .eq("status", "active")
      .maybeSingle();
    if (!data) return null;
    const row = data as unknown as Record<string, unknown>;
    const names = await companyNameMap(c, [row.employer_id as string]);
    return { ...mapJob(row), company: names.get(row.employer_id as string) || "" };
  } catch {
    return null;
  }
}

/** Create an applicant from the public board — only if the job is public+active.
 *  Returns the employer_id (for notification) or null. */
export async function createPublicApplicant(
  jobId: number,
  v: { name: string; email: string; resumeText?: string; coverLetter?: string; matchScore?: number; matchAnalysis?: MatchAnalysis }
): Promise<{ employerId: string } | null> {
  const c = db();
  if (!c || !Number.isFinite(jobId) || !v.name.trim() || !v.email.trim()) return null;
  try {
    const { data: job } = await c.from("job_postings").select("id, employer_id").eq("id", jobId).eq("public_listed", true).eq("status", "active").maybeSingle();
    if (!job) return null;
    const { error } = await c.from("applicants").insert({
      job_id: jobId,
      name: v.name.slice(0, 200),
      email: v.email.slice(0, 200),
      resume_text: v.resumeText?.slice(0, 20000) || null,
      cover_letter: v.coverLetter?.slice(0, 12000) || null,
      match_score: typeof v.matchScore === "number" ? v.matchScore : null,
      match_analysis: v.matchAnalysis ?? null,
      status: "new",
    });
    if (error) return null;
    return { employerId: job.employer_id as string };
  } catch {
    return null;
  }
}

// ── Applicants ────────────────────────────────────────────────────────────────
async function employerJobIds(c: SupabaseClient, employerId: string): Promise<number[]> {
  const { data } = await c.from("job_postings").select("id").eq("employer_id", employerId).limit(500);
  return (data || []).map((r) => r.id as number);
}

async function applicantCountsByJob(c: SupabaseClient, jobIds: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (!jobIds.length) return map;
  try {
    const { data } = await c.from("applicants").select("job_id").in("job_id", jobIds).limit(5000);
    for (const r of data || []) map.set(r.job_id as number, (map.get(r.job_id as number) || 0) + 1);
  } catch {
    /* ignore */
  }
  return map;
}

const APP_COLS =
  "id, job_id, name, email, resume_text, cover_letter, match_score, match_analysis, status, notes, created_at";

function mapApplicant(r: Record<string, unknown>, jobTitle?: string): Applicant {
  return {
    id: r.id as number,
    jobId: r.job_id as number,
    jobTitle,
    name: (r.name as string) || "",
    email: (r.email as string) || "",
    resumeText: (r.resume_text as string) || "",
    coverLetter: (r.cover_letter as string) || "",
    matchScore: typeof r.match_score === "number" ? (r.match_score as number) : null,
    matchAnalysis: (r.match_analysis as MatchAnalysis) ?? null,
    status: (r.status as ApplicantStatus) || "new",
    notes: (r.notes as string) || "",
    createdAt: (r.created_at as string) || "",
  };
}

export interface ApplicantFilters {
  jobId?: number;
  status?: ApplicantStatus;
  minScore?: number;
  sort?: "newest" | "best";
}

export async function listApplicants(employerId: string, f: ApplicantFilters = {}): Promise<Applicant[]> {
  const c = db();
  if (!c || !employerId) return [];
  try {
    const jobIds = await employerJobIds(c, employerId);
    if (!jobIds.length) return [];
    const titleMap = await jobTitleMap(c, jobIds);
    let q = c.from("applicants").select(APP_COLS).in("job_id", f.jobId ? [f.jobId] : jobIds);
    if (f.status) q = q.eq("status", f.status);
    if (typeof f.minScore === "number") q = q.gte("match_score", f.minScore);
    q = f.sort === "best" ? q.order("match_score", { ascending: false, nullsFirst: false }) : q.order("created_at", { ascending: false });
    const { data, error } = await q.limit(1000);
    if (error || !data) return [];
    return data.map((r) => mapApplicant(r, titleMap.get(r.job_id as number)));
  } catch {
    return [];
  }
}

async function jobTitleMap(c: SupabaseClient, jobIds: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (!jobIds.length) return map;
  const { data } = await c.from("job_postings").select("id, title").in("id", jobIds);
  for (const r of data || []) map.set(r.id as number, (r.title as string) || "");
  return map;
}

export async function getApplicant(employerId: string, id: number): Promise<Applicant | null> {
  const c = db();
  if (!c || !employerId) return null;
  try {
    const { data } = await c.from("applicants").select(APP_COLS).eq("id", id).maybeSingle();
    if (!data) return null;
    // Ownership check: the applicant's job must belong to this employer.
    const { data: job } = await c
      .from("job_postings")
      .select("id, title")
      .eq("id", data.job_id as number)
      .eq("employer_id", employerId)
      .maybeSingle();
    if (!job) return null;
    return mapApplicant(data, (job.title as string) || "");
  } catch {
    return null;
  }
}

export async function createApplicant(
  employerId: string,
  v: { jobId: number; name: string; email: string; resumeText?: string; coverLetter?: string }
): Promise<Applicant | null> {
  const c = db();
  if (!c || !employerId || !v.name?.trim() || !v.email?.trim()) return null;
  try {
    // Confirm the job belongs to this employer before attaching an applicant.
    const { data: job } = await c.from("job_postings").select("id").eq("id", v.jobId).eq("employer_id", employerId).maybeSingle();
    if (!job) return null;
    const { data, error } = await c
      .from("applicants")
      .insert({
        job_id: v.jobId,
        name: v.name.slice(0, 200),
        email: v.email.slice(0, 200),
        resume_text: v.resumeText?.slice(0, 20000) || null,
        cover_letter: v.coverLetter?.slice(0, 12000) || null,
      })
      .select(APP_COLS)
      .single();
    if (error || !data) return null;
    return mapApplicant(data);
  } catch {
    return null;
  }
}

export async function updateApplicant(
  employerId: string,
  id: number,
  patch: Partial<{ status: ApplicantStatus; notes: string; matchScore: number; matchAnalysis: MatchAnalysis }>
): Promise<boolean> {
  const c = db();
  if (!c || !employerId) return false;
  // Ownership check first.
  const existing = await getApplicant(employerId, id);
  if (!existing) return false;
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status) row.status = patch.status;
  if (patch.notes !== undefined) row.notes = patch.notes.slice(0, 8000);
  if (typeof patch.matchScore === "number") row.match_score = Math.max(0, Math.min(100, patch.matchScore));
  if (patch.matchAnalysis) row.match_analysis = patch.matchAnalysis;
  try {
    const { error } = await c.from("applicants").update(row).eq("id", id);
    return !error;
  } catch {
    return false;
  }
}

// ── Match-score cache ─────────────────────────────────────────────────────────
export async function getCachedMatch(applicantId: number, jobId: number): Promise<MatchAnalysis | null> {
  const c = db();
  if (!c) return null;
  try {
    const { data } = await c
      .from("match_scores")
      .select("analysis")
      .eq("applicant_id", applicantId)
      .eq("job_id", jobId)
      .maybeSingle();
    return data ? ((data.analysis as MatchAnalysis) ?? null) : null;
  } catch {
    return null;
  }
}

export async function cacheMatch(applicantId: number, jobId: number, analysis: MatchAnalysis): Promise<void> {
  const c = db();
  if (!c) return;
  try {
    await c.from("match_scores").upsert(
      { applicant_id: applicantId, job_id: jobId, score: analysis.score, analysis },
      { onConflict: "applicant_id,job_id" }
    );
  } catch {
    /* best-effort */
  }
}

// ── Team ──────────────────────────────────────────────────────────────────────
function mapMember(r: Record<string, unknown>): TeamMember {
  return {
    id: r.id as number,
    userId: (r.user_id as string) ?? null,
    email: (r.email as string) || "",
    role: (r.role as TeamRole) || "viewer",
    status: (r.status as "pending" | "active") || "pending",
    inviteToken: (r.invite_token as string) ?? null,
    createdAt: (r.created_at as string) || "",
  };
}

const MEMBER_COLS = "id, user_id, email, role, status, invite_token, created_at";

export async function listTeam(employerId: string): Promise<TeamMember[]> {
  const c = db();
  if (!c || !employerId) return [];
  try {
    await ensureOwnerRow(c, employerId);
    const { data, error } = await c
      .from("team_members")
      .select(MEMBER_COLS)
      .eq("employer_id", employerId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error || !data) return [];
    return data.map(mapMember);
  } catch {
    return [];
  }
}

export async function inviteMember(
  employerId: string,
  email: string,
  role: TeamRole,
  token: string
): Promise<TeamMember | null> {
  const c = db();
  if (!c || !employerId || !email.trim()) return null;
  try {
    const { data, error } = await c
      .from("team_members")
      .insert({ employer_id: employerId, email: email.trim().slice(0, 200), role, status: "pending", invite_token: token })
      .select(MEMBER_COLS)
      .single();
    if (error || !data) return null;
    return mapMember(data);
  } catch {
    return null;
  }
}

export async function updateMember(
  employerId: string,
  id: number,
  patch: Partial<{ role: TeamRole; inviteToken: string }>
): Promise<boolean> {
  const c = db();
  if (!c || !employerId) return false;
  const row: Record<string, unknown> = {};
  if (patch.role) row.role = patch.role;
  if (patch.inviteToken) row.invite_token = patch.inviteToken;
  if (!Object.keys(row).length) return false;
  try {
    // Never demote/replace the owner via this path.
    const { error } = await c.from("team_members").update(row).eq("employer_id", employerId).eq("id", id).neq("role", "owner");
    return !error;
  } catch {
    return false;
  }
}

export async function removeMember(employerId: string, id: number): Promise<boolean> {
  const c = db();
  if (!c || !employerId) return false;
  try {
    const { error } = await c.from("team_members").delete().eq("employer_id", employerId).eq("id", id).neq("role", "owner");
    return !error;
  } catch {
    return false;
  }
}

/** Look up a pending invite by its token (used by the /join acceptance flow). */
export async function getInviteByToken(token: string): Promise<{ employerId: string; member: TeamMember } | null> {
  const c = db();
  if (!c || !token) return null;
  try {
    const { data } = await c
      .from("team_members")
      .select("id, user_id, email, role, status, invite_token, created_at, employer_id")
      .eq("invite_token", token)
      .maybeSingle();
    if (!data) return null;
    return { employerId: data.employer_id as string, member: mapMember(data) };
  } catch {
    return null;
  }
}

/** Accept an invite: bind the accepting user + activate the row. */
export async function acceptInvite(token: string, userId: string, email?: string): Promise<boolean> {
  const c = db();
  if (!c || !token || !userId) return false;
  try {
    const row: Record<string, unknown> = { user_id: userId, status: "active", invite_token: null };
    if (email) row.email = email.slice(0, 200);
    const { error } = await c.from("team_members").update(row).eq("invite_token", token);
    return !error;
  } catch {
    return false;
  }
}

// ── Dashboard stats + activity ────────────────────────────────────────────────
export interface EmployerStats {
  activeJobs: number;
  totalApplicants: number;
  newThisWeek: number;
  teamCount: number;
}

export interface ActivityEntry {
  kind: "applicant" | "expiring" | "team";
  text: string;
  meta?: string;
  date: string;
}

export async function getDashboard(employerId: string): Promise<{ stats: EmployerStats; activity: ActivityEntry[] }> {
  const empty: EmployerStats = { activeJobs: 0, totalApplicants: 0, newThisWeek: 0, teamCount: 0 };
  const c = db();
  if (!c || !employerId) return { stats: empty, activity: [] };
  try {
    const jobs = await listJobs(employerId);
    const activeJobs = jobs.filter((j) => j.status === "active").length;
    const jobIds = jobs.map((j) => j.id);
    const titleMap = new Map(jobs.map((j) => [j.id, j.title] as const));

    let totalApplicants = 0;
    let newThisWeek = 0;
    const activity: ActivityEntry[] = [];
    const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();

    if (jobIds.length) {
      const { data } = await c
        .from("applicants")
        .select("name, job_id, match_score, created_at")
        .in("job_id", jobIds)
        .order("created_at", { ascending: false })
        .limit(1000);
      const rows = data || [];
      totalApplicants = rows.length;
      newThisWeek = rows.filter((r) => (r.created_at as string) >= weekAgo).length;
      for (const r of rows.slice(0, 6)) {
        activity.push({
          kind: "applicant",
          text: `New applicant for ${titleMap.get(r.job_id as number) || "a role"}`,
          meta: `${r.name as string}${typeof r.match_score === "number" ? ` · ${r.match_score}% match` : ""}`,
          date: (r.created_at as string) || "",
        });
      }
    }

    // Expiring-soon alerts (active jobs with a deadline within 3 days).
    const soon = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    for (const j of jobs) {
      if (j.status === "active" && j.deadline && j.deadline >= today && j.deadline <= soon) {
        activity.push({ kind: "expiring", text: `Job posting expires soon: ${j.title}`, meta: `Closes ${j.deadline}`, date: j.deadline });
      }
    }

    // Recently joined team members.
    const team = await listTeam(employerId);
    for (const m of team.filter((t) => t.status === "active" && t.role !== "owner").slice(-3)) {
      activity.push({ kind: "team", text: `Team member joined`, meta: m.email, date: m.createdAt });
    }

    activity.sort((a, b) => (a.date < b.date ? 1 : -1));
    return { stats: { activeJobs, totalApplicants, newThisWeek, teamCount: team.length }, activity: activity.slice(0, 8) };
  } catch {
    return { stats: empty, activity: [] };
  }
}
