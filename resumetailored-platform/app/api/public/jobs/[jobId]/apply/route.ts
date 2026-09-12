import { NextResponse } from "next/server";
// eslint-disable-next-line @typescript-eslint/no-require-imports
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import mammoth from "mammoth";
import { getPublicJob, createPublicApplicant } from "@/lib/employer-store";
import { localMatchFallback } from "@/lib/employer-ai";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_BYTES = 10 * 1024 * 1024;

/** Public job application (Feature E) — no auth. Multipart form with an optional
 *  resume file; saves the applicant to the employer's pipeline (status "new"),
 *  auto-scores against the posting, and best-effort emails the employer. */
export async function POST(req: Request, { params }: { params: { jobId: string } }) {
  const jobId = Number(params.jobId);
  if (!Number.isFinite(jobId)) return NextResponse.json({ error: "bad job" }, { status: 400 });

  const job = await getPublicJob(jobId);
  if (!job) return NextResponse.json({ error: "This posting is no longer accepting applications." }, { status: 404 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid submission." }, { status: 400 });
  }

  const name = String(form.get("name") || "").trim();
  const email = String(form.get("email") || "").trim();
  const phone = String(form.get("phone") || "").trim();
  const portfolio = String(form.get("portfolio") || "").trim();
  let coverLetter = String(form.get("coverLetter") || "").trim();
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "A valid name and email are required." }, { status: 400 });
  }
  // Fold phone/portfolio into the cover letter so the employer sees them.
  const extra = [phone && `Phone: ${phone}`, portfolio && `Portfolio: ${portfolio}`].filter(Boolean).join(" · ");
  if (extra) coverLetter = coverLetter ? `${coverLetter}\n\n${extra}` : extra;

  // Extract resume text from the uploaded file (best-effort).
  let resumeText = "";
  const file = form.get("resume");
  if (file instanceof File && file.size > 0 && file.size <= MAX_BYTES) {
    const ext = (file.name || "").toLowerCase().split(".").pop() || "";
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      if (ext === "txt") resumeText = buf.toString("utf-8");
      else if (ext === "pdf") resumeText = (await pdfParse(buf)).text;
      else if (ext === "docx" || ext === "doc") resumeText = (await mammoth.extractRawText({ buffer: buf })).value;
    } catch {
      /* unreadable file → applicant still saved, just without a match score */
    }
  }
  resumeText = resumeText.trim();

  // Auto match score from the resume vs the posting (local, no AI cost).
  let matchScore: number | undefined;
  let matchAnalysis;
  if (resumeText.length >= 40) {
    const jd = `${job.description}\n\n${job.requirements.join("\n")}`;
    const a = localMatchFallback(job.requirements, jd, resumeText);
    matchScore = a.score;
    matchAnalysis = a;
  }

  const saved = await createPublicApplicant(jobId, { name, email, resumeText, coverLetter, matchScore, matchAnalysis });
  if (!saved) return NextResponse.json({ error: "Could not submit your application. Please try again." }, { status: 500 });

  // Best-effort employer notification (skipped silently if Resend/Clerk unset).
  notifyEmployer(saved.employerId, job.title, name).catch(() => {});

  return NextResponse.json({ ok: true });
}

async function notifyEmployer(employerId: string, jobTitle: string, applicantName: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return; // placeholder — no email provider configured
  try {
    const { clerkClient } = await import("@clerk/nextjs/server");
    const client = await clerkClient();
    const user = await client.users.getUser(employerId);
    const to = user?.emailAddresses?.[0]?.emailAddress;
    if (!to) return;
    const from = process.env.RESEND_FROM || "ResumeTailored <onboarding@resend.dev>";
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        subject: `New applicant for ${jobTitle}`,
        html: `<div style="font-family:system-ui,sans-serif"><p><strong>${escapeHtml(applicantName)}</strong> applied for <strong>${escapeHtml(jobTitle)}</strong> via your public job board.</p><p>Review them in your <a href="https://resumetailored.com/employer/candidates">Candidates dashboard</a>.</p></div>`,
      }),
    });
  } catch {
    /* best-effort */
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] || ch);
}
