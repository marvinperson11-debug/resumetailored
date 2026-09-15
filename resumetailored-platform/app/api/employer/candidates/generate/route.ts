import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { getJob, getEmployerProfile } from "@/lib/employer-store";
import { getAnthropic, CLAUDE_MODEL, isProviderUnavailable } from "@/lib/ai";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Draft a resume or cover letter for a manually-added candidate, so the employer
 * has an editable starting point. Reuses the shared Anthropic client. `kind` is
 * "resume" or "cover"; the selected job (when given) supplies role context.
 */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const b = (await req.json().catch(() => ({}))) as { kind?: string; name?: string; jobId?: number };
  const kind = b.kind === "cover" ? "cover" : "resume";
  const name = (b.name || "").trim() || "the candidate";

  let jobTitle = "";
  let jobDescription = "";
  if (b.jobId && Number.isFinite(b.jobId)) {
    const job = await getJob(ctx.employerId, Number(b.jobId));
    if (job) {
      jobTitle = job.title;
      jobDescription = [job.description, ...(job.requirements || [])].filter(Boolean).join("\n");
    }
  }
  const profile = await getEmployerProfile(ctx.employerId);
  const company = profile?.companyName || "the company";

  const anthropic = getAnthropic();
  if (!anthropic) return NextResponse.json({ error: "AI drafting isn't configured on this deployment." }, { status: 503 });

  const system =
    kind === "cover"
      ? "You are an expert career writer. Write a concise, professional cover letter in plain text (no markdown). 3–4 short paragraphs. Do not invent specific employers, dates, or metrics that weren't provided; keep claims general where details are unknown."
      : "You are an expert resume writer. Write a clean, ATS-friendly resume in plain text (no markdown), with clear sections (SUMMARY, EXPERIENCE, SKILLS, EDUCATION). Do not fabricate specific employers, dates, or metrics; use realistic placeholders like [Company] and [Year] where specifics are unknown so the employer can fill them in.";
  const user =
    kind === "cover"
      ? `Draft a cover letter for ${name}${jobTitle ? ` applying for the ${jobTitle} role` : ""} at ${company}.` +
        (jobDescription ? `\n\nRole details:\n${jobDescription.slice(0, 4000)}` : "")
      : `Draft a resume for ${name}${jobTitle ? ` targeting a ${jobTitle} role` : ""}.` +
        (jobDescription ? `\n\nTailor it to this role:\n${jobDescription.slice(0, 4000)}` : "");

  try {
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1600,
      system,
      messages: [{ role: "user", content: user }],
    });
    const block = msg.content[0];
    const text = block && block.type === "text" ? block.text.trim() : "";
    if (!text) return NextResponse.json({ error: "Couldn't generate a draft. Please try again." }, { status: 502 });
    return NextResponse.json({ text });
  } catch (err) {
    if (isProviderUnavailable(err)) {
      return NextResponse.json({ error: "The AI service is busy right now. Please try again in a moment." }, { status: 503 });
    }
    console.error("[candidates/generate]", err);
    return NextResponse.json({ error: "Couldn't generate a draft. Please try again." }, { status: 500 });
  }
}
