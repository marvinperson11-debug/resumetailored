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
