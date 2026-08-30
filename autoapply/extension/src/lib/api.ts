// Typed client for the AutoApply API, called from the ATS content script.
// Mirrors the server's ApplyData shape (autoapply/src/lib/types.ts).

export interface PersonalInfo {
  fullName: string;
  email: string;
  phone?: string;
  location?: string;
  linkedin?: string;
  portfolio?: string;
  website?: string;
}
export interface WorkExperience {
  company: string; title: string; location?: string;
  startDate?: string; endDate?: string; current?: boolean; bullets: string[];
}
export interface Education {
  school: string; degree?: string; field?: string; startDate?: string; endDate?: string; gpa?: string;
}
export interface SuggestedAnswer { question: string; answer: string; }

export interface ApplyData {
  jobApplicationId: string;
  company: string;
  role: string;
  jobUrl: string;
  status: string;
  personal: PersonalInfo;
  workExperience: WorkExperience[];
  education: Education[];
  skills: string[];
  coverLetter: string | null;
  suggestedAnswers: SuggestedAnswer[];
  preferredSalary: string | null;
  startDate: string | null;
}

export async function fetchApplyData(
  apiBase: string,
  jobId: string,
  token: string
): Promise<ApplyData> {
  const res = await fetch(`${apiBase}/api/jobs/${jobId}/apply-data`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || body.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.applyData as ApplyData;
}

export async function syncApplied(
  apiBase: string,
  jobId: string,
  token: string
): Promise<void> {
  const res = await fetch(`${apiBase}/api/jobs/${jobId}/apply-data`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`sync failed: HTTP ${res.status}`);
}

// ── Main ResumeTailored apply queue (proxied through the AutoApply app) ───────
// The extension never talks to the main app directly (no shared cookie, no
// service secret in the client); it calls the AutoApply app's /api/apply-queue*
// proxy with its bearer ExtensionToken, and the app forwards to the main app.

export interface QueueCount { count: number; queued: number }

/** How many jobs are in the user's ResumeTailored apply queue. */
export async function fetchQueueCount(apiBase: string, token: string): Promise<QueueCount> {
  const res = await fetch(`${apiBase}/api/apply-queue/count`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  return { count: Number(d.count) || 0, queued: Number(d.queued) || 0 };
}

/** Add a job to the user's ResumeTailored apply queue (e.g. the current tab). */
export async function addToQueue(
  apiBase: string,
  token: string,
  job: { jobUrl: string; jobTitle?: string; companyName?: string; jobBoard?: string }
): Promise<void> {
  const res = await fetch(`${apiBase}/api/apply-queue`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(job),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}
