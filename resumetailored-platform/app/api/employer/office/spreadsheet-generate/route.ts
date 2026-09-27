import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { isScalePlusTier } from "@/lib/employer-plan";
import { getAnthropic, CLAUDE_MODEL, isProviderUnavailable } from "@/lib/ai";
import { extractJson } from "@/lib/tools-ai";
import { buildSpreadsheetPrompt, sanitizeGrid, type SpreadsheetGrid } from "@/lib/office-hub";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_DESCRIPTION = 2000;

/** POST { description } → an AI-structured spreadsheet grid ("Describe it"
 *  path of the Spreadsheet Creator). Scale+ only, same gate as Charts. */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isScalePlusTier(ctx.access)) return NextResponse.json({ error: "The Spreadsheet Creator is available on the Scale+ plan." }, { status: 403 });

  const b = (await req.json().catch(() => ({}))) as { description?: string };
  const description = (b.description || "").trim().slice(0, MAX_DESCRIPTION);
  if (!description) return NextResponse.json({ error: "Describe the spreadsheet you want." }, { status: 400 });

  const anthropic = getAnthropic();
  if (!anthropic) return NextResponse.json({ error: "not_configured", message: "AI generation isn't configured on this server." }, { status: 501 });

  const { system, user } = buildSpreadsheetPrompt({ description });
  try {
    const msg = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: 4000, system, messages: [{ role: "user", content: user }] });
    console.log("[spreadsheet-generate] usage", { employerId: ctx.employerId, ...msg.usage });
    const block = msg.content[0];
    const raw = extractJson<Record<string, unknown>>(block && block.type === "text" ? block.text : "");
    const grid: SpreadsheetGrid | null = raw ? sanitizeGrid(raw) : null;
    if (!grid) return NextResponse.json({ error: "Could not structure a spreadsheet from that description. Try being more specific." }, { status: 502 });
    return NextResponse.json({ grid });
  } catch (err) {
    console.error("[spreadsheet-generate]", err);
    const message = isProviderUnavailable(err) ? "The AI provider is temporarily overloaded. Please try again." : "Could not generate the spreadsheet. Please try again.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
