import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getAnthropic, CLAUDE_MODEL } from "@/lib/ai";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Fetch a job posting from a supported job-board URL and return its text
 * (FIX 7 #5). Ported from the old site's `/api/fetch-job-url`: tries structured
 * JSON-LD first, then strips the HTML, then (if a key is set) has Claude extract
 * just the posting. Signed-in only, and restricted to an allowlist of job boards
 * so it can't be used as an open proxy.
 */
const ALLOWED_JOB_DOMAINS = new Set([
  "linkedin.com", "indeed.com", "glassdoor.com", "ziprecruiter.com", "monster.com",
  "careerbuilder.com", "dice.com", "theladders.com", "simplyhired.com", "snagajob.com",
  "flexjobs.com", "themuse.com", "hired.com", "wellfound.com", "angel.co",
  "builtin.com", "remote.co", "weworkremotely.com", "remoteok.com", "remoteok.io",
  "lever.co", "greenhouse.io", "ashbyhq.com", "bamboohr.com", "myworkdayjobs.com",
  "workday.com", "icims.com", "smartrecruiters.com", "jobvite.com", "taleo.net",
  "breezy.hr", "workable.com", "recruitee.com", "pinpoint.com", "teamtailor.com",
  "handshake.com", "wayup.com", "internships.com", "chegg.com", "recruiter.com",
  "zippia.com", "jora.com", "jobrapido.com", "otta.com", "cord.co",
  "techinasia.com", "careers.google.com", "jobs.apple.com",
  "microsoft.com", "amazon.jobs", "meta.com", "netflix.jobs",
  "zhipin.com", "liepin.com", "zhaopin.com", "lagou.com", "51job.com", "maimai.cn",
]);

function isAllowedJobUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.replace(/^www\./, "");
    return Array.from(ALLOWED_JOB_DOMAINS).some((d) => host === d || host.endsWith("." + d));
  } catch {
    return false;
  }
}

function extractJsonLdJob(html: string): string | null {
  const matches = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of matches) {
    try {
      const json = JSON.parse(block.replace(/<script[^>]*>|<\/script>/gi, ""));
      const objs = Array.isArray(json) ? json : [json];
      for (const obj of objs) {
        if (obj["@type"] === "JobPosting") {
          const parts: string[] = [];
          if (obj.title) parts.push(obj.title);
          if (obj.hiringOrganization?.name) parts.push("Company: " + obj.hiringOrganization.name);
          if (obj.jobLocation?.address) {
            const a = obj.jobLocation.address;
            parts.push("Location: " + [a.addressLocality, a.addressRegion, a.addressCountry].filter(Boolean).join(", "));
          }
          if (obj.description) parts.push(String(obj.description).replace(/<[^>]+>/g, " ").replace(/\s{3,}/g, "\n\n").trim());
          if (obj.employmentType) parts.push("Employment Type: " + obj.employmentType);
          if (obj.baseSalary?.value) {
            const s = obj.baseSalary.value;
            parts.push("Salary: " + (s.minValue || "") + (s.maxValue ? "–" + s.maxValue : "") + " " + (s.unitText || ""));
          }
          const text = parts.join("\n\n").trim();
          if (text.length > 200) return text;
        }
      }
    } catch {
      /* not valid JSON, skip */
    }
  }
  return null;
}

function stripHtml(html: string): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<(nav|header|footer|aside)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ").replace(/&#\d+;/g, " ").replace(/&[a-z]+;/g, " ")
    .replace(/\s{3,}/g, "\n\n")
    .trim();
  return text.length > 8000 ? text.slice(0, 8000) + "…" : text;
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", message: "Your session expired. Please refresh and sign in again." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { url?: string };
  const url = body.url;
  if (!url) return NextResponse.json({ error: "URL is required." }, { status: 400 });
  if (!isAllowedJobUrl(url)) {
    return NextResponse.json({ error: "Only https URLs from supported job boards are accepted." }, { status: 400 });
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });

    if (response.status === 401 || response.status === 403) {
      return NextResponse.json(
        { error: "This job board requires a login to view postings. Please copy and paste the job description instead." },
        { status: 422 }
      );
    }
    if (!response.ok) {
      return NextResponse.json(
        { error: `Could not load that page (HTTP ${response.status}). Please paste the job description manually.` },
        { status: 422 }
      );
    }

    const html = await response.text();

    const jsonLdText = extractJsonLdJob(html);
    if (jsonLdText) return NextResponse.json({ text: jsonLdText });

    const rawText = stripHtml(html);
    if (rawText.length < 100) {
      return NextResponse.json(
        { error: "Could not extract job text — the page may require a login. Please paste the job description manually." },
        { status: 422 }
      );
    }

    const anthropic = getAnthropic();
    if (!anthropic) return NextResponse.json({ text: rawText });

    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      system:
        "You extract job descriptions from raw webpage text. Output ONLY the job posting content — title, company, responsibilities, requirements, qualifications. Remove all navigation, ads, footers, related jobs, and unrelated site content. Preserve structure. No preamble.",
      messages: [{ role: "user", content: rawText }],
    });
    const block = msg.content[0];
    const text = (block && block.type === "text" ? block.text : "").trim() || rawText;
    return NextResponse.json({ text });
  } catch (err) {
    const e = err as { name?: string; message?: string };
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      return NextResponse.json(
        { error: "Request timed out. The job board may be blocking automated access — please paste the description manually." },
        { status: 422 }
      );
    }
    console.error("fetch-job-url error:", e?.message || err);
    return NextResponse.json({ error: "Failed to fetch the job posting. Please paste the job description manually." }, { status: 500 });
  }
}
