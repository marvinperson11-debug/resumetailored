import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isPro } from "@/lib/plan";
import { getAnthropic, CLAUDE_MODEL, isProviderUnavailable } from "@/lib/ai";
import { extractJson } from "@/lib/tools-ai";
import { buildSiteCopyPrompt, type SiteSection } from "@/lib/site-templates";

export const runtime = "nodejs";
export const maxDuration = 60;

interface SiteCopy {
  name: string;
  headline: string;
  about: string;
  sections: SiteSection[];
}

/** Generate personal-website copy from a resume. Personal Website is a Pro-only
 *  tool, so this is Pro-gated (belt-and-suspenders behind the UI gate). */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", message: "Please sign in." }, { status: 401 });

  if (!(await isPro())) {
    return NextResponse.json({ error: "pro_required", message: "Personal Website is a Pro feature." }, { status: 402 });
  }

  const body = (await req.json().catch(() => ({}))) as { resume?: string };
  const resume = (body.resume || "").trim();
  if (resume.length < 40) return NextResponse.json({ error: "Paste your resume (a few sentences at least)." }, { status: 400 });

  const anthropic = getAnthropic();
  if (!anthropic) return NextResponse.json({ error: "not_configured", message: "AI is not configured." }, { status: 501 });

  const { system, user } = buildSiteCopyPrompt(resume);
  try {
    const msg = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: 1500, system, messages: [{ role: "user", content: user }] });
    const block = msg.content[0];
    const copy = extractJson<SiteCopy>(block && block.type === "text" ? block.text : "");
    if (!copy) throw new Error("bad copy json");
    return NextResponse.json({ copy });
  } catch (err) {
    const message = isProviderUnavailable(err) ? "AI is temporarily busy. Try again in 30 seconds." : "Could not generate copy. Please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
