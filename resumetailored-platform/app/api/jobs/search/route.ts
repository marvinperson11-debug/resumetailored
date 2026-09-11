import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isPro } from "@/lib/plan";
import { getAnthropic, CLAUDE_MODEL } from "@/lib/ai";
import { extractJson } from "@/lib/tools-ai";
import { matchResumeToJob, buildMockListingsPrompt, normalizeMockJobs, type JobMatch } from "@/lib/jobs-ai";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Job Finder search. Primary source is the live Adzuna API
 * (ADZUNA_APP_ID / ADZUNA_APP_KEY). When Adzuna is unconfigured or errors, we
 * fall back to AI-generated realistic listings (Claude) so the tool always
 * returns results. Every listing is scored against the candidate's résumé
 * (local keyword overlap — no per-listing LLM cost). Free users see 5 matches;
 * Pro sees all.
 */
export interface JobResult {
  id: string;
  title: string;
  company: string;
  location: string;
  salary: string | null;
  snippet: string;
  url: string;
  description?: string;
  requirements?: string[];
  jobType?: string;
  experienceLevel?: string;
  postedDate?: string;
  remote?: boolean;
  matchScore?: number;
  matchAnalysis?: JobMatch;
  source?: "live" | "ai";
}

function enrich(jobs: JobResult[], resume: string): JobResult[] {
  const r = resume.trim();
  return jobs.map((j) => {
    if (r.length < 40) return j;
    const text = [j.title, j.company, j.description || j.snippet, (j.requirements || []).join(" ")].join(" ");
    const m = matchResumeToJob(r, text);
    return { ...j, matchScore: m.score, matchAnalysis: m };
  });
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", message: "Please sign in." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    resume?: string;
    keywords?: string; query?: string; // `query` kept for back-compat
    location?: string;
    experienceLevel?: string;
    jobTypes?: string[];
    salaryMin?: number;
    remote?: boolean;
    page?: number;
  };
  const resume = (body.resume || "").toString();
  const keywords = (body.keywords || body.query || "").toString().trim().slice(0, 120);
  const where = (body.location || "").toString().trim().slice(0, 80);
  const jobTypes = Array.isArray(body.jobTypes) ? body.jobTypes.map(String) : [];
  const wantRemote = !!body.remote || jobTypes.includes("remote");
  if (!keywords && !where && resume.trim().length < 40) {
    return NextResponse.json({ error: "need_input", message: "Add a resume, or a keyword/location, to find matches." }, { status: 400 });
  }

  const pro = await isPro();
  const fetchCount = pro ? 40 : 15;

  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;

  let jobs: JobResult[] = [];
  let source: "live" | "ai" = "live";

  if (appId && appKey) {
    try {
      const params = new URLSearchParams({ app_id: appId, app_key: appKey, results_per_page: String(fetchCount), "content-type": "application/json" });
      const whatParts = [keywords, wantRemote ? "remote" : "", body.experienceLevel && body.experienceLevel !== "any" ? body.experienceLevel : ""].filter(Boolean);
      if (whatParts.length) params.set("what", whatParts.join(" "));
      if (where) params.set("where", where);
      if (jobTypes.includes("full_time")) params.set("full_time", "1");
      if (jobTypes.includes("part_time")) params.set("part_time", "1");
      if (jobTypes.includes("contract")) params.set("contract", "1");
      if (pro && body.salaryMin && Number(body.salaryMin) > 0) params.set("salary_min", String(Math.floor(Number(body.salaryMin))));
      const page = Math.max(1, Math.min(Number(body.page) || 1, 20));
      const url = `https://api.adzuna.com/v1/api/jobs/us/search/${page}?${params.toString()}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { Accept: "application/json" } });
      if (res.ok) {
        const data = (await res.json()) as { results?: AdzunaJob[] };
        jobs = (data.results || []).map((j) => ({
          id: String(j.id),
          title: j.title || "Untitled role",
          company: j.company?.display_name || "Company",
          location: j.location?.display_name || "",
          salary: salaryText(j),
          snippet: (j.description || "").replace(/\s+/g, " ").slice(0, 320),
          description: (j.description || "").replace(/\s+/g, " ").slice(0, 1200),
          url: j.redirect_url || "",
          jobType: j.contract_time === "part_time" ? "Part-time" : "Full-time",
          postedDate: j.created ? timeAgo(j.created) : undefined,
          remote: /remote/i.test(`${j.title} ${j.description}`),
          source: "live",
        }));
      }
    } catch {
      jobs = [];
    }
  }

  // Fallback to AI listings when the live source is unavailable / empty.
  if (!jobs.length) {
    const anthropic = getAnthropic();
    if (!anthropic) {
      return NextResponse.json({ error: "jobs_unconfigured", message: "Job search isn't configured yet." }, { status: 503 });
    }
    try {
      const { system, user } = buildMockListingsPrompt({ resume, keywords, location: where, experienceLevel: body.experienceLevel || "any", jobTypes, count: fetchCount });
      const msg = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: 3500, system, messages: [{ role: "user", content: user }] });
      const block = msg.content[0];
      const mock = normalizeMockJobs(extractJson(block && block.type === "text" ? block.text : ""));
      jobs = mock.map((j) => ({
        id: j.id, title: j.title, company: j.company, location: j.location,
        salary: j.salary, snippet: j.description, description: j.description, requirements: j.requirements,
        url: "", jobType: j.jobType, experienceLevel: j.experienceLevel, postedDate: j.postedDate, remote: j.remote,
        source: "ai",
      }));
      source = "ai";
    } catch {
      return NextResponse.json({ error: "jobs_error", message: "Couldn't fetch jobs right now. Please try again." }, { status: 502 });
    }
  }

  jobs = enrich(jobs, resume);
  // Best-match first by default (the client can re-sort).
  jobs.sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));

  const total = jobs.length;
  const visible = pro ? jobs : jobs.slice(0, 5);
  return NextResponse.json({ jobs: visible, total, pro, source, lockedCount: pro ? 0 : Math.max(0, total - visible.length) });
}

interface AdzunaJob {
  id: string | number;
  title?: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  description?: string;
  redirect_url?: string;
  salary_min?: number;
  salary_max?: number;
  created?: string;
  contract_time?: string;
}

function salaryText(j: AdzunaJob): string | null {
  const fmt = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
  if (j.salary_min && j.salary_max) {
    if (Math.round(j.salary_min) === Math.round(j.salary_max)) return fmt(j.salary_min);
    return `${fmt(j.salary_min)} – ${fmt(j.salary_max)}`;
  }
  if (j.salary_min) return `From ${fmt(j.salary_min)}`;
  return null;
}

function timeAgo(iso: string): string {
  const d = Date.parse(iso);
  if (!d) return "Recently";
  const days = Math.floor((Date.now() - d) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "1 day ago";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}
