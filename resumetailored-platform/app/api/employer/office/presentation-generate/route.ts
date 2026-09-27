import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { isScalePlusTier } from "@/lib/employer-plan";
import { gatherHiringActivityData, gatherTimesheetSummaryData, gatherTrainingComplianceData } from "@/lib/office-store";
import { getAnthropic, CLAUDE_MODEL, isProviderUnavailable } from "@/lib/ai";
import { extractJson } from "@/lib/tools-ai";
import {
  isReportSource,
  isValidReportRange,
  isPresentationSlideCount,
  buildPresentationPrompt,
  sanitizeDeck,
  type ReportSource,
  type ReportDateRange,
  type PresentationDeck,
} from "@/lib/office-hub";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_TOPIC = 500;

/**
 * POST { slideCount, topic } OR { slideCount, source, start, end } → one
 * Claude call that returns the whole deck as strict JSON (no per-slide AI
 * calls). The "data" mode reuses the Report Writer's three data gatherers —
 * the model sees only the pre-aggregated JSON, never raw rows. Scale+ only,
 * same gate as Charts; this route only generates — saving is a separate
 * explicit action (`/presentation-save`).
 */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isScalePlusTier(ctx.access)) return NextResponse.json({ error: "The Presentation Builder is available on the Scale+ plan." }, { status: 403 });

  const b = (await req.json().catch(() => ({}))) as { topic?: string; source?: string; start?: string; end?: string; slideCount?: number };
  if (!isPresentationSlideCount(b.slideCount)) return NextResponse.json({ error: "Pick 5, 10, or 15 slides." }, { status: 400 });
  const slideCount = b.slideCount;

  const anthropic = getAnthropic();
  if (!anthropic) return NextResponse.json({ error: "not_configured", message: "AI generation isn't configured on this server." }, { status: 501 });

  let system: string;
  let user: string;
  if (b.source) {
    if (!isReportSource(b.source)) return NextResponse.json({ error: "bad_request" }, { status: 400 });
    const source: ReportSource = b.source;
    const range: ReportDateRange = { start: b.start || "", end: b.end || "" };
    if (!isValidReportRange(range)) return NextResponse.json({ error: "Pick a valid date range (up to a year)." }, { status: 400 });
    const data =
      source === "hiring"
        ? await gatherHiringActivityData(ctx.employerId, range)
        : source === "timesheet"
        ? await gatherTimesheetSummaryData(ctx.employerId, range)
        : await gatherTrainingComplianceData(ctx.employerId, range);
    ({ system, user } = buildPresentationPrompt({ source, range, data, slideCount }));
  } else {
    const topic = (b.topic || "").trim().slice(0, MAX_TOPIC);
    if (!topic) return NextResponse.json({ error: "Describe a topic, or pick a data source." }, { status: 400 });
    ({ system, user } = buildPresentationPrompt({ topic, slideCount }));
  }

  try {
    const msg = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: 4000, system, messages: [{ role: "user", content: user }] });
    console.log("[presentation-generate] usage", { employerId: ctx.employerId, slideCount, ...msg.usage });
    const block = msg.content[0];
    const raw = extractJson<Record<string, unknown>>(block && block.type === "text" ? block.text : "");
    const deck: PresentationDeck | null = raw ? sanitizeDeck(raw, slideCount) : null;
    if (!deck) return NextResponse.json({ error: "Could not generate a deck from that. Please try again." }, { status: 502 });
    return NextResponse.json({ deck });
  } catch (err) {
    console.error("[presentation-generate]", err);
    const message = isProviderUnavailable(err) ? "The AI provider is temporarily overloaded. Please try again." : "Could not generate the presentation. Please try again.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
