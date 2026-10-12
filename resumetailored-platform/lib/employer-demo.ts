import type { ApplicantStatus, JobPosting } from "./employer-ai";
import type { ActivityEntry } from "./employer-store";

/**
 * The anonymous employer taste (see app/employer/layout.tsx): a visitor with no account sees the
 * real portal populated with THIS data and nothing else.
 *
 * The hard boundary is that a guest can never touch real people, so this module is deliberately
 * pure: no database, no network, no imports beyond types. Everything a guest's page is built from
 * is a fixture below, and every fixture id is NEGATIVE — a database serial is always positive, so
 * a demo id can never collide with, or be mistaken for, a real row. `isDemoId` is the one test the
 * pages and the tests share.
 *
 * Only language-neutral facts live here (ids, names, stages, scores, ages). The words — the job
 * post and each candidate's one-line headline — are translated copy under `employerDemo` in
 * messages/*.json, so the sample reads naturally in all five locales.
 */

export const DEMO_JOB_ID = -1;

/** The pipeline columns, left to right. (`rejected` is a real status but not a column of the taste.) */
export const DEMO_STAGES = ["new", "reviewed", "shortlisted", "interviewed", "offer extended", "hired"] as const satisfies readonly ApplicantStatus[];

export interface DemoCandidate {
  id: number;
  jobId: number;
  /** Key of the translated headline under employerDemo.candidates. */
  key: string;
  name: string;
  /** example.com is reserved (RFC 2606): these can never be somebody's real address. */
  email: string;
  status: ApplicantStatus;
  matchScore: number;
  daysAgo: number;
}

export const DEMO_CANDIDATES: readonly DemoCandidate[] = [
  { id: -101, jobId: DEMO_JOB_ID, key: "maya", name: "Maya Okafor", email: "maya.okafor@example.com", status: "new", matchScore: 91, daysAgo: 0 },
  { id: -102, jobId: DEMO_JOB_ID, key: "liam", name: "Liam Hartmann", email: "liam.hartmann@example.com", status: "new", matchScore: 64, daysAgo: 1 },
  { id: -103, jobId: DEMO_JOB_ID, key: "priya", name: "Priya Nair", email: "priya.nair@example.com", status: "reviewed", matchScore: 78, daysAgo: 2 },
  { id: -104, jobId: DEMO_JOB_ID, key: "carlos", name: "Carlos Mendes", email: "carlos.mendes@example.com", status: "shortlisted", matchScore: 88, daysAgo: 4 },
  { id: -105, jobId: DEMO_JOB_ID, key: "hana", name: "Hana Suzuki", email: "hana.suzuki@example.com", status: "shortlisted", matchScore: 83, daysAgo: 5 },
  { id: -106, jobId: DEMO_JOB_ID, key: "tomas", name: "Tomas Novak", email: "tomas.novak@example.com", status: "interviewed", matchScore: 86, daysAgo: 9 },
  { id: -107, jobId: DEMO_JOB_ID, key: "amara", name: "Amara Diallo", email: "amara.diallo@example.com", status: "offer extended", matchScore: 93, daysAgo: 12 },
  { id: -108, jobId: DEMO_JOB_ID, key: "noah", name: "Noah Fischer", email: "noah.fischer@example.com", status: "hired", matchScore: 89, daysAgo: 20 },
];

/** Every id a guest's response may carry. */
export const DEMO_IDS: ReadonlySet<number> = new Set([DEMO_JOB_ID, ...DEMO_CANDIDATES.map((c) => c.id)]);

export function isDemoId(id: unknown): boolean {
  return typeof id === "number" && DEMO_IDS.has(id);
}

/** Copy for the demo job post, resolved from `employerDemo.job.*` by the page. */
export interface DemoJobText {
  title: string;
  department: string;
  location: string;
  description: string;
  benefits: string;
  requirements: string[];
}

const dayAgo = (now: number, n: number): string => new Date(now - n * 864e5).toISOString();

export function buildDemoJob(text: DemoJobText, now: number = Date.now()): JobPosting {
  return {
    id: DEMO_JOB_ID,
    title: text.title,
    department: text.department,
    location: text.location,
    remoteType: "hybrid",
    employmentType: "full-time",
    salaryMin: 85000,
    salaryMax: 115000,
    salaryCurrency: "USD",
    salaryPeriod: "year",
    benefitsDescription: text.benefits,
    description: text.description,
    requirements: text.requirements,
    niceToHaves: [],
    deadline: null,
    status: "active",
    publicListed: false, // a demo post is never on the public job board
    applicantCount: DEMO_CANDIDATES.length,
    createdAt: dayAgo(now, 21),
    updatedAt: dayAgo(now, 1),
  };
}

export interface DemoCandidateView extends DemoCandidate {
  headline: string;
  createdAt: string;
}

export function buildDemoCandidates(headlines: Record<string, string>, now: number = Date.now()): DemoCandidateView[] {
  return DEMO_CANDIDATES.map((c) => ({ ...c, headline: headlines[c.key] ?? "", createdAt: dayAgo(now, c.daysAgo) }));
}

export function demoStats(now: number = Date.now()): { activeJobs: number; totalApplicants: number; newThisWeek: number; teamCount: number } {
  void now; // ages are relative to "now" by construction, so the week window is constant
  return {
    activeJobs: 1,
    totalApplicants: DEMO_CANDIDATES.length,
    newThisWeek: DEMO_CANDIDATES.filter((c) => c.daysAgo < 7).length,
    teamCount: 1,
  };
}

/** The dashboard's "recent activity" for the taste: the newest sample applicants. */
export function demoActivity(jobTitle: string, now: number = Date.now()): ActivityEntry[] {
  return [...DEMO_CANDIDATES]
    .sort((a, b) => a.daysAgo - b.daysAgo)
    .slice(0, 3)
    .map((c) => ({ kind: "applicant", event: "applicant", params: { job: jobTitle, name: c.name, score: c.matchScore }, date: dayAgo(now, c.daysAgo) }));
}

/** Routes a guest may open in the portal (everything else under /employer needs an account). */
export const DEMO_PAGES = ["/employer", "/employer/jobs", "/employer/candidates"] as const;

/** Where "Create a free employer account" goes: Clerk sign-up, then the free-tier claim, then /employer. */
export const EMPLOYER_SIGN_UP_HREF = `/sign-up?redirect_url=${encodeURIComponent("/employer-checkout?plan=free")}`;

// ── carrying a demo draft across sign-up ────────────────────────────────────────

/**
 * The job-post form a guest filled in. It is the one thing worth carrying over, and it is trivial
 * to carry: plain text fields, parked in sessionStorage, put back into the NEW-job form once.
 * Nothing else survives sign-up — the demo pipeline is fixtures, so there is nothing of the
 * guest's to keep — and restoring a draft fills the form only: it never publishes.
 */
export const EMPLOYER_DRAFT_KEY = "rt_employer_demo_draft";
export const EMPLOYER_DRAFT_TTL_MS = 2 * 60 * 60 * 1000;

export interface EmployerJobDraft {
  title: string;
  department: string;
  location: string;
  description: string;
  benefits: string;
}

type StoreLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
function defaultStore(): StoreLike | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const FIELDS = ["title", "department", "location", "description", "benefits"] as const;

export function draftHasContent(d: EmployerJobDraft): boolean {
  return FIELDS.some((k) => d[k].trim().length > 0);
}

/** Park the draft; returns true if something was stored. Never throws. */
export function stashEmployerDraft(draft: EmployerJobDraft | null, store: StoreLike | null = defaultStore(), now: number = Date.now()): boolean {
  if (!store) return false;
  try {
    store.removeItem(EMPLOYER_DRAFT_KEY);
    if (!draft || !draftHasContent(draft)) return false;
    store.setItem(EMPLOYER_DRAFT_KEY, JSON.stringify({ v: 1, savedAt: now, draft }));
    return true;
  } catch {
    return false;
  }
}

/** Is a fresh draft waiting? (Does not consume it.) */
export function peekEmployerDraft(store: StoreLike | null = defaultStore(), now: number = Date.now()): boolean {
  if (!store) return false;
  try {
    const raw = store.getItem(EMPLOYER_DRAFT_KEY);
    if (!raw) return false;
    const p = JSON.parse(raw) as { v?: unknown; savedAt?: unknown };
    return p.v === 1 && typeof p.savedAt === "number" && now - p.savedAt <= EMPLOYER_DRAFT_TTL_MS;
  } catch {
    return false;
  }
}

/** Read AND remove the draft, so a refresh or a second visit never re-applies it. */
export function takeEmployerDraft(store: StoreLike | null = defaultStore(), now: number = Date.now()): EmployerJobDraft | null {
  if (!store) return null;
  let raw: string | null = null;
  try {
    raw = store.getItem(EMPLOYER_DRAFT_KEY);
    if (raw !== null) store.removeItem(EMPLOYER_DRAFT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as { v?: unknown; savedAt?: unknown; draft?: Record<string, unknown> };
    if (p.v !== 1 || typeof p.savedAt !== "number" || now - p.savedAt > EMPLOYER_DRAFT_TTL_MS || now < p.savedAt - 60_000) return null;
    const c = p.draft;
    if (!c || typeof c !== "object") return null;
    const draft: EmployerJobDraft = { title: str(c.title), department: str(c.department), location: str(c.location), description: str(c.description), benefits: str(c.benefits) };
    return draftHasContent(draft) ? draft : null;
  } catch {
    return null;
  }
}
