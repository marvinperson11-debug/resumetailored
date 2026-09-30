import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { isEmployer } from "@/lib/plan";
import { isScalePlusTier, checkDocumentAllowance } from "@/lib/employer-plan";
import { gatherHiringActivityData, gatherTimesheetSummaryData, gatherTrainingComplianceData } from "@/lib/office-store";
import { listDocuments, createDocument } from "@/lib/documents-store";
import { getAnthropic, CLAUDE_MODEL, isProviderUnavailable } from "@/lib/ai";
import { isReportSource, isValidReportRange, buildReportPrompt, reportTitle, type ReportSource, type ReportDateRange } from "@/lib/office-hub";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST { source, start, end } → gathers the requested data (hiring activity /
 * timesheet hours / training compliance) for the range, writes a
 * plain-language report with Claude, and auto-saves it to Documents (kind:
 * "report") so it opens there as an editable HTML doc. Scale+ only, same gate
 * as Charts; owner-only, same as creating any other document.
 */
export async function POST(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!isScalePlusTier(ctx.access)) return NextResponse.json({ error: "The Report Writer is available on the Scale+ plan." }, { status: 403 });
  if (!isEmployer(ctx.access)) return NextResponse.json({ error: "Only the account owner can save documents." }, { status: 403 });

  const b = (await req.json().catch(() => ({}))) as { source?: string; start?: string; end?: string };
  if (!isReportSource(b.source)) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const source: ReportSource = b.source;
  const range: ReportDateRange = { start: b.start || "", end: b.end || "" };
  if (!isValidReportRange(range)) return NextResponse.json({ error: "Pick a valid date range (up to a year)." }, { status: 400 });

  const used = (await listDocuments(ctx.employerId)).length;
  const allowance = checkDocumentAllowance(ctx.access, used);
  if (!allowance.allowed) return NextResponse.json({ error: allowance.message, code: "limit_reached" }, { status: 402 });

  const anthropic = getAnthropic();
  if (!anthropic) return NextResponse.json({ error: "not_configured", message: "AI generation isn't configured on this server." }, { status: 501 });

  const data =
    source === "hiring"
      ? await gatherHiringActivityData(ctx.employerId, range)
      : source === "timesheet"
      ? await gatherTimesheetSummaryData(ctx.employerId, range)
      : await gatherTrainingComplianceData(ctx.employerId, range);

  const { system, user } = buildReportPrompt(source, range, data);
  let bodyHtml = "";
  try {
    const msg = await anthropic.messages.create({ model: CLAUDE_MODEL, max_tokens: 2000, system, messages: [{ role: "user", content: user }] });
    console.log("[report-generate] usage", { employerId: ctx.employerId, source, ...msg.usage });
    const block = msg.content[0];
    bodyHtml = block && block.type === "text" ? block.text.trim() : "";
  } catch (err) {
    console.error("[report-generate]", err);
    const message = isProviderUnavailable(err) ? "The AI provider is temporarily overloaded. Please try again." : "Could not generate the report. Please try again.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
  if (!bodyHtml) return NextResponse.json({ error: "The report came back empty. Please try again." }, { status: 502 });

  const title = reportTitle(source, range);
  const doc = await createDocument(ctx.employerId, { title, bodyHtml, kind: "report" });
  if (!doc) return NextResponse.json({ error: "Could not save the report." }, { status: 500 });

  return NextResponse.json({ document: doc });
}
