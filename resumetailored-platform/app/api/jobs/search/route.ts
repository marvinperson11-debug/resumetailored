import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isPro } from "@/lib/plan";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Job Finder — live search via the Adzuna API (ADZUNA_APP_ID / ADZUNA_APP_KEY
 *  in the Railway env). Free: 10 results, basic query. Pro: up to 50 + salary /
 *  remote / date filters. */
export interface JobResult {
  id: string;
  title: string;
  company: string;
  location: string;
  salary: string | null;
  snippet: string;
  url: string;
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", message: "Please sign in." }, { status: 401 });

  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) {
    return NextResponse.json({ error: "jobs_unconfigured", message: "Live job search isn't configured (ADZUNA keys)." }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    query?: string;
    location?: string;
    salaryMin?: number;
    remote?: boolean;
    maxDaysOld?: number;
    page?: number;
  };
  const pro = await isPro();
  const perPage = pro ? 50 : 10;
  const page = Math.max(1, Math.min(Number(body.page) || 1, 20));

  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    results_per_page: String(perPage),
    "content-type": "application/json",
    what: (body.query || "").toString().slice(0, 120) || "jobs",
  });
  const where = (body.location || "").toString().slice(0, 80);
  if (where) params.set("where", where);
  // Advanced filters are Pro-only.
  if (pro) {
    if (body.salaryMin && Number(body.salaryMin) > 0) params.set("salary_min", String(Math.floor(Number(body.salaryMin))));
    if (body.remote) params.set("what_and", `${body.query || ""} remote`.trim());
    if (body.maxDaysOld && Number(body.maxDaysOld) > 0) params.set("max_days_old", String(Math.floor(Number(body.maxDaysOld))));
  }

  const country = "us";
  const url = `https://api.adzuna.com/v1/api/jobs/${country}/search/${page}?${params.toString()}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { Accept: "application/json" } });
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ error: "jobs_unconfigured", message: "Job search credentials are invalid or expired." }, { status: 503 });
    }
    if (!res.ok) return NextResponse.json({ error: "jobs_error", message: "Job source is temporarily unavailable." }, { status: 502 });
    const data = (await res.json()) as { results?: AdzunaJob[]; count?: number };
    const jobs: JobResult[] = (data.results || []).map((j) => ({
      id: String(j.id),
      title: j.title || "Untitled role",
      company: j.company?.display_name || "Company",
      location: j.location?.display_name || "",
      salary: salaryText(j),
      snippet: (j.description || "").replace(/\s+/g, " ").slice(0, 280),
      url: j.redirect_url || "",
    }));
    return NextResponse.json({ jobs, total: data.count ?? jobs.length, pro });
  } catch (err) {
    const e = err as { name?: string };
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      return NextResponse.json({ error: "jobs_error", message: "Job search timed out. Please try again." }, { status: 504 });
    }
    return NextResponse.json({ error: "jobs_error", message: "Job search failed. Please try again." }, { status: 502 });
  }
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
