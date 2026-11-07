import { NextResponse } from "next/server";
import { employerContext } from "@/lib/employer-auth";
import { canUseBooks, canUseFullBooks } from "@/lib/employer-plan";
import { listEntries, monthlyPayrollCostCents } from "@/lib/books-store";
import { computeProfitAndLoss, expensesByCategory, incomeByMonth, scheduleCSummary, quarterlyEstimateWorksheet, formatMoney } from "@/lib/books-hub";

export const dynamic = "force-dynamic";

const REPORT_TYPES = ["pnl", "by-category", "by-month", "schedule-c", "quarterly-estimate"] as const;
type ReportType = (typeof REPORT_TYPES)[number];
const FULL_ONLY_REPORTS: ReportType[] = ["schedule-c", "quarterly-estimate"];

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const to = now.toISOString().slice(0, 10);
  return { from, to };
}

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** GET ?type=pnl|by-category|by-month|schedule-c|quarterly-estimate&from=&to=&format=json|csv
 *  Basic reports (pnl/by-category/by-month) are Portal+; the tax-ready
 *  exports (schedule-c/quarterly-estimate) are Corporate-only ("full
 *  Books" — see BOOKS.md). `pnl`'s JSON response adds a `payrollCostCents`
 *  line (from Timesheets × Employees' hourly wage) ONLY for a full-Books
 *  caller — a Portal/Scale employer's P&L is income/expense entries alone. */
export async function GET(req: Request) {
  const ctx = await employerContext();
  if (!ctx) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!canUseBooks(ctx.access)) return NextResponse.json({ error: "Books is available on the Portal plan and above." }, { status: 403 });

  const url = new URL(req.url);
  const typeRaw = url.searchParams.get("type");
  const type = (REPORT_TYPES as readonly string[]).includes(typeRaw || "") ? (typeRaw as ReportType) : "pnl";
  if (FULL_ONLY_REPORTS.includes(type) && !canUseFullBooks(ctx.access)) {
    return NextResponse.json({ error: "Tax-ready reports are available on the Corporate plan." }, { status: 403 });
  }
  const { from: defaultFrom, to: defaultTo } = defaultRange();
  const from = url.searchParams.get("from") || defaultFrom;
  const to = url.searchParams.get("to") || defaultTo;
  const format = url.searchParams.get("format") === "csv" ? "csv" : "json";

  const entries = await listEntries(ctx.employerId, { from, to });

  if (type === "pnl") {
    const pnl = computeProfitAndLoss(entries);
    const payrollCostCents = canUseFullBooks(ctx.access) ? await monthlyPayrollCostCents(ctx.employerId, from, to) : null;
    if (format === "csv") {
      const csv = ["line,amount", `Income,${(pnl.incomeCents / 100).toFixed(2)}`, `Expenses,${(pnl.expenseCents / 100).toFixed(2)}`, `Net,${(pnl.netCents / 100).toFixed(2)}`].join("\n");
      return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="pnl_${from}_${to}.csv"` } });
    }
    return NextResponse.json({ range: { from, to }, ...pnl, payrollCostCents });
  }

  if (type === "by-category") {
    const rows = expensesByCategory(entries);
    if (format === "csv") {
      const csv = ["category,amount", ...rows.map((r) => `${csvEscape(r.category)},${(r.amountCents / 100).toFixed(2)}`)].join("\n");
      return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="expenses_by_category_${from}_${to}.csv"` } });
    }
    return NextResponse.json({ range: { from, to }, rows });
  }

  if (type === "by-month") {
    const rows = incomeByMonth(entries);
    if (format === "csv") {
      const csv = ["month,income,expense", ...rows.map((r) => `${r.month},${(r.incomeCents / 100).toFixed(2)},${(r.expenseCents / 100).toFixed(2)}`)].join("\n");
      return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="income_by_month_${from}_${to}.csv"` } });
    }
    return NextResponse.json({ range: { from, to }, rows });
  }

  if (type === "schedule-c") {
    const rows = scheduleCSummary(entries);
    if (format === "csv") {
      const csv = ["category,schedule_c_line,amount", ...rows.map((r) => `${csvEscape(r.category)},${csvEscape(r.scheduleCLine)},${(r.amountCents / 100).toFixed(2)}`)].join("\n");
      return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="schedule_c_${from}_${to}.csv"` } });
    }
    return NextResponse.json({ range: { from, to }, rows, disclaimer: "Informational mapping only — not tax advice or a filing. Review with your accountant." });
  }

  // quarterly-estimate
  const worksheet = quarterlyEstimateWorksheet(entries);
  if (format === "csv") {
    const csv = [
      "line,amount",
      `Net profit,${(worksheet.netProfitCents / 100).toFixed(2)}`,
      `Estimated self-employment tax,${(worksheet.estimatedSelfEmploymentTaxCents / 100).toFixed(2)}`,
      `Suggested set-aside,${(worksheet.suggestedSetAsideCents / 100).toFixed(2)}`,
    ].join("\n");
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="quarterly_estimate_${from}_${to}.csv"` } });
  }
  return NextResponse.json({
    range: { from, to },
    ...worksheet,
    formatted: { netProfit: formatMoney(worksheet.netProfitCents), estimatedSelfEmploymentTax: formatMoney(worksheet.estimatedSelfEmploymentTaxCents), suggestedSetAside: formatMoney(worksheet.suggestedSetAsideCents) },
    disclaimer: "A rough planning estimate only — not tax advice or a filing. Review with your accountant before setting money aside.",
  });
}
