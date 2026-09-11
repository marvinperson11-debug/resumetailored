import { NextResponse } from "next/server";
import { requireEmployerId } from "@/lib/employer-auth";
import { getAnthropic, CLAUDE_MODEL, isProviderUnavailable } from "@/lib/ai";
import { buildJobAssistPrompt } from "@/lib/employer-ai";

export const runtime = "nodejs";
export const maxDuration = 60;

/** AI job-description assist: rough notes → polished, inclusive description.
 *  Available to every employer (no extra gate). */
export async function POST(req: Request) {
  const employerId = await requireEmployerId();
  if (!employerId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const b = (await req.json().catch(() => ({}))) as {
    title?: string;
    notes?: string;
    department?: string;
    location?: string;
    employmentType?: string;
  };
  const notes = (b.notes || "").trim();
  if (notes.length < 12) return NextResponse.json({ error: "Add a few notes for the AI to work from." }, { status: 400 });

  const anthropic = getAnthropic();
  if (!anthropic) return NextResponse.json({ error: "not_configured", message: "AI is not configured." }, { status: 501 });

  const { system, user } = buildJobAssistPrompt({
    title: (b.title || "").trim(),
    notes,
    department: (b.department || "").trim(),
    location: (b.location || "").trim(),
    employmentType: (b.employmentType || "").trim(),
  });
  try {
    const msg = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: 1500, system, messages: [{ role: "user", content: user }] });
    const block = msg.content[0];
    const description = block && block.type === "text" ? block.text.trim() : "";
    if (!description) throw new Error("empty");
    return NextResponse.json({ description });
  } catch (err) {
    const message = isProviderUnavailable(err)
      ? "AI is temporarily busy. Try again in 30 seconds."
      : "Could not improve that description. Please try again.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
