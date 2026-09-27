/**
 * Office suite — shared types and pure helpers (no DB, no network). Mirrors the
 * `cert-hub.ts` convention: this file holds the calculator math, the
 * hand-rolled SVG chart builder (no chart library, per the brief), the
 * Spreadsheet Creator's grid parsing/validation, and the Report Writer's
 * prompt builders — all fully unit-testable without a browser. `office-store.ts`
 * is the DB/service-role counterpart (live chart data sources, the
 * office-assets upload, and the report data gatherers).
 */
import { parseISODate } from "./time-hub";

// ── Calculators (all tiers) ─────────────────────────────────────────────────
// Every calculator is a pure function: same inputs, same number out. The
// client shows the formula alongside the live result using these same inputs.

/** Monthly labor cost for one role: hourly wage, hours/week, and a burden %
 *  (payroll tax, benefits, workers' comp — layered on top of base wage). */
export function laborMonthlyCost(hourlyWage: number, hoursPerWeek: number, burdenPct: number): number {
  const loaded = hourlyWage * (1 + burdenPct / 100);
  return loaded * hoursPerWeek * (52 / 12);
}

/** Cost per hire: total hiring spend (job ads, agency fees, recruiter time)
 *  divided by the number of hires it produced. */
export function costPerHire(totalSpend: number, hires: number): number {
  return hires > 0 ? totalSpend / hires : 0;
}

/** Turnover cost: replacements needed × the average fully-loaded cost to
 *  replace one person (recruiting + onboarding + lost productivity). */
export function turnoverCost(replacements: number, avgCostPerReplacement: number): number {
  return replacements * avgCostPerReplacement;
}

/** Weekly overtime pay: base hours at the base rate, plus OT hours at the
 *  rate × multiplier (1.5 for standard time-and-a-half). */
export function overtimePay(baseHours: number, otHours: number, hourlyRate: number, otMultiplier: number): number {
  return baseHours * hourlyRate + otHours * hourlyRate * otMultiplier;
}

export interface StaffingLine {
  role: string;
  headcount: number;
  hoursPerWeek: number;
  hourlyWage: number;
}

/** One staffing line's weekly cost: headcount × hours/week × hourly wage. */
export function staffingLineWeeklyCost(line: Pick<StaffingLine, "headcount" | "hoursPerWeek" | "hourlyWage">): number {
  return line.headcount * line.hoursPerWeek * line.hourlyWage;
}

/** Total weekly staffing cost across every line. */
export function staffingTotalWeeklyCost(lines: Pick<StaffingLine, "headcount" | "hoursPerWeek" | "hourlyWage">[]): number {
  return lines.reduce((sum, l) => sum + staffingLineWeeklyCost(l), 0);
}

// ── Charts (Scale+) ──────────────────────────────────────────────────────────

export type ChartType = "bar" | "line" | "pie";
export const CHART_TYPES: ChartType[] = ["bar", "line", "pie"];

export interface ChartPoint {
  label: string;
  value: number;
}

export interface ChartConfig {
  type: ChartType;
  title: string;
  points: ChartPoint[];
  xLabel?: string;
  yLabel?: string;
}

/** Live platform data sources a chart can be built from. */
export const CHART_SOURCES = ["applicants", "timesheet", "training"] as const;
export type ChartSource = (typeof CHART_SOURCES)[number];
export const isChartSource = (v: unknown): v is ChartSource => (CHART_SOURCES as readonly string[]).includes(String(v));
export const CHART_SOURCE_LABELS: Record<ChartSource, string> = {
  applicants: "Applicants over time",
  timesheet: "Timesheet hours per employee (this week)",
  training: "Training completion % per employee",
};

/** Parse pasted/uploaded CSV text into chart points. Expects two columns
 *  (label,value); a non-numeric second column on the first row is treated as
 *  a header and skipped. Malformed or empty rows are dropped rather than
 *  thrown — a partial paste still produces a usable (if partial) chart. */
export function parseCsvPoints(text: string): ChartPoint[] {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const points: ChartPoint[] = [];
  lines.forEach((line, i) => {
    const cols = line.split(",").map((c) => c.trim().replace(/^"(.*)"$/, "$1"));
    if (cols.length < 2) return;
    const value = Number(cols[1]);
    if (!Number.isFinite(value)) {
      if (i === 0) return; // header row
      return;
    }
    const label = cols[0].slice(0, 60);
    if (!label) return;
    points.push({ label, value });
  });
  return points.slice(0, 100);
}

export function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Qualitative palette drawn from the app's own accent colors (violet/gold
 *  rebrand + teal), extended with a few complementary hues for charts with
 *  more categories than the brand palette alone covers. */
const PALETTE = ["#C2870B", "#14B8A6", "#F59E0B", "#8B5CF6", "#EC4899", "#3B82F6", "#EF4444", "#84CC16"];

const SVG_WIDTH = 640;
const SVG_HEIGHT = 400;

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function pieSlicePath(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const start = polarToCartesian(cx, cy, r, startAngle);
  const end = polarToCartesian(cx, cy, r, endAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${cx} ${cy} L ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)} Z`;
}

/** Build a complete, self-contained `<svg>` string for the given config — no
 *  external stylesheet or font dependency, so it renders identically inline
 *  and after being rasterized to PNG for download. Hand-rolled (no chart
 *  library), per the brief. */
export function buildChartSvg(config: ChartConfig): string {
  const points = config.points.filter((p) => Number.isFinite(p.value));
  const title = escapeXml(config.title || "Untitled chart");
  if (points.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}"><rect width="100%" height="100%" fill="#0B0F19"/><text x="${SVG_WIDTH / 2}" y="${SVG_HEIGHT / 2}" fill="#ffffff88" font-family="sans-serif" font-size="14" text-anchor="middle">No data</text></svg>`;
  }

  if (config.type === "pie") return buildPieSvg(points, title);
  return buildAxisSvg(points, title, config.type === "line", config.xLabel, config.yLabel);
}

/** A "nice" round number close to `range` — the classic Heckbert algorithm
 *  used to pick pleasant axis tick steps (1/2/5/10 × a power of 10) instead of
 *  dividing the max into equal parts and rounding, which collapses small
 *  values (e.g. a few hours) to all-zero ticks and gives ugly steps (12, 24,
 *  36…) for larger ones. `round`: true picks the nearest nice value (for a
 *  step size), false rounds UP (for an envelope around the data). */
function niceNumber(range: number, round: boolean): number {
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / Math.pow(10, exponent);
  let niceFraction: number;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }
  return niceFraction * Math.pow(10, exponent);
}

/** Nice tick values from 0 to a nice max covering `dataMax`, at roughly
 *  `targetTicks` steps. Works across any magnitude — fractional hours, small
 *  applicant counts, or 0-100 percentages — so the y-axis never renders a
 *  column of zeros just because every real value is under 1. */
function niceTicks(dataMax: number, targetTicks = 4): { max: number; step: number; values: number[] } {
  if (!(dataMax > 0)) return { max: 1, step: 1, values: [0, 1] };
  const roughStep = niceNumber(dataMax / targetTicks, true);
  const max = Math.ceil(dataMax / roughStep) * roughStep;
  const values: number[] = [];
  for (let v = 0; v <= max + roughStep / 2; v += roughStep) values.push(Math.round(v * 1000) / 1000);
  return { max, step: roughStep, values };
}

/** Tick label formatting: whole-number steps stay plain; a fractional step
 *  (e.g. 0.5h, or 0.01h for a very light week) shows just enough decimals to
 *  distinguish its ticks, instead of rounding every one of them to 0. */
function formatTick(v: number, step: number): string {
  const decimals = step > 0 && step < 1 ? Math.min(4, Math.ceil(-Math.log10(step))) : 0;
  return v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function buildAxisSvg(points: ChartPoint[], title: string, isLine: boolean, xLabel?: string, yLabel?: string): string {
  const margin = { top: 56, right: 28, bottom: xLabel ? 78 : 62, left: yLabel ? 64 : 50 };
  const plotW = SVG_WIDTH - margin.left - margin.right;
  const plotH = SVG_HEIGHT - margin.top - margin.bottom;
  const dataMax = Math.max(...points.map((p) => p.value), 0);
  const { max: maxValue, step, values: tickValues } = niceTicks(dataMax);

  const gridlines: string[] = [];
  const yTickLabels: string[] = [];
  for (const v of tickValues) {
    const y = margin.top + plotH - (v / maxValue) * plotH;
    gridlines.push(`<line x1="${margin.left}" y1="${y.toFixed(1)}" x2="${margin.left + plotW}" y2="${y.toFixed(1)}" stroke="#ffffff1a" stroke-width="1"/>`);
    yTickLabels.push(`<text x="${margin.left - 10}" y="${(y + 4).toFixed(1)}" fill="#ffffff99" font-family="sans-serif" font-size="10" text-anchor="end">${formatTick(v, step)}</text>`);
  }

  // Rotated labels anchor at their END (not middle) so the text reads
  // diagonally up-and-left from each tick instead of spilling outward past
  // the plot edges — the previous middle-anchored rotation clipped against
  // the SVG boundary for the first/last categories and for longer names.
  const slot = plotW / points.length;
  const labelY = margin.top + plotH + 14;
  const xLabels = points
    .map((p, i) => {
      const cx = margin.left + slot * i + slot / 2;
      const label = escapeXml(p.label.length > 10 ? p.label.slice(0, 9) + "…" : p.label);
      return `<text x="${cx.toFixed(1)}" y="${labelY}" fill="#ffffff99" font-family="sans-serif" font-size="10" text-anchor="end" transform="rotate(-30 ${cx.toFixed(1)} ${labelY})">${label}</text>`;
    })
    .join("");

  let series = "";
  if (isLine) {
    const coords = points.map((p, i) => {
      const x = margin.left + slot * i + slot / 2;
      const y = margin.top + plotH - (p.value / maxValue) * plotH;
      return { x, y };
    });
    const path = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
    const dots = coords.map((c) => `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3.5" fill="${PALETTE[0]}"/>`).join("");
    series = `<path d="${path}" fill="none" stroke="${PALETTE[0]}" stroke-width="2.5"/>${dots}`;
  } else {
    // Capped so a chart with only one or two categories doesn't draw a bar
    // that spans (most of) the whole plot width — still centered in its slot.
    const barW = Math.min(slot * 0.6, 64);
    series = points
      .map((p, i) => {
        const x = margin.left + slot * i + (slot - barW) / 2;
        const h = (p.value / maxValue) * plotH;
        const y = margin.top + plotH - h;
        return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${PALETTE[0]}"/>`;
      })
      .join("");
  }

  const axisLabels = `
    ${xLabel ? `<text x="${margin.left + plotW / 2}" y="${SVG_HEIGHT - 12}" fill="#ffffffcc" font-family="sans-serif" font-size="12" text-anchor="middle">${escapeXml(xLabel)}</text>` : ""}
    ${yLabel ? `<text x="16" y="${margin.top + plotH / 2}" fill="#ffffffcc" font-family="sans-serif" font-size="12" text-anchor="middle" transform="rotate(-90 16 ${margin.top + plotH / 2})">${escapeXml(yLabel)}</text>` : ""}
  `;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" font-family="sans-serif">
    <rect width="100%" height="100%" fill="#0B0F19"/>
    <text x="${SVG_WIDTH / 2}" y="28" fill="#ffffff" font-size="16" font-weight="600" text-anchor="middle">${title}</text>
    ${gridlines.join("")}
    <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotH}" stroke="#ffffff33"/>
    <line x1="${margin.left}" y1="${margin.top + plotH}" x2="${margin.left + plotW}" y2="${margin.top + plotH}" stroke="#ffffff33"/>
    ${yTickLabels.join("")}
    ${xLabels}
    ${series}
    ${axisLabels}
  </svg>`;
}

function buildPieSvg(points: ChartPoint[], title: string): string {
  const total = points.reduce((s, p) => s + Math.max(0, p.value), 0);
  const cx = 200;
  const cy = SVG_HEIGHT / 2 + 10;
  const r = 130;
  const nonZero = points.filter((p) => p.value > 0);

  let slices = "";
  if (total <= 0) {
    slices = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff1a"/>`;
  } else if (nonZero.length === 1) {
    const i = points.indexOf(nonZero[0]);
    slices = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${PALETTE[i % PALETTE.length]}"/>`;
  } else {
    let angle = 0;
    slices = points
      .map((p, i) => {
        if (p.value <= 0) return "";
        const sliceAngle = (p.value / total) * 360;
        const path = pieSlicePath(cx, cy, r, angle, angle + sliceAngle);
        angle += sliceAngle;
        return `<path d="${path}" fill="${PALETTE[i % PALETTE.length]}" stroke="#0B0F19" stroke-width="1.5"/>`;
      })
      .join("");
  }

  const legend = points
    .map((p, i) => {
      const pct = total > 0 ? Math.round((p.value / total) * 100) : 0;
      const y = 70 + i * 26;
      const label = escapeXml(p.label.length > 22 ? p.label.slice(0, 21) + "…" : p.label);
      return `
        <rect x="410" y="${y - 11}" width="12" height="12" rx="2" fill="${PALETTE[i % PALETTE.length]}"/>
        <text x="430" y="${y}" fill="#ffffffcc" font-family="sans-serif" font-size="12">${label} — ${pct}%</text>
      `;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" font-family="sans-serif">
    <rect width="100%" height="100%" fill="#0B0F19"/>
    <text x="${SVG_WIDTH / 2}" y="28" fill="#ffffff" font-size="16" font-weight="600" text-anchor="middle">${title}</text>
    ${slices}
    ${legend}
  </svg>`;
}

// ── Spreadsheet Creator (Scale+, Phase 5) ───────────────────────────────────

export interface SpreadsheetGrid {
  title: string;
  headers: string[];
  rows: string[][];
}

const SPREADSHEET_MAX_COLS = 30;
const SPREADSHEET_MAX_ROWS = 500;
const SPREADSHEET_MAX_CELL = 300;

function clampCell(v: unknown): string {
  return String(v ?? "").slice(0, SPREADSHEET_MAX_CELL);
}

/** One-click presets for the "Describe it" box — the label IS the prompt (word
 *  for word), so the user always sees exactly what will be sent before editing
 *  or submitting it. */
export const SPREADSHEET_PRESETS = [
  {
    key: "payroll",
    label: "Payroll-ready hours sheet",
    prompt:
      "Build a payroll-ready hours sheet from last week's timesheets: one row per employee with columns for Employee, Role, Mon, Tue, Wed, Thu, Fri, Sat, Sun hours, Total hours, and Overtime hours (anything over 40 total). Use realistic sample data if none is provided.",
  },
  {
    key: "candidates",
    label: "Candidate comparison matrix",
    prompt:
      "Build a candidate comparison matrix for a hiring decision: one row per applicant with columns for Candidate, Role Applied For, Years of Experience, Key Skills, Interview Score (1-10), and Recommendation. Use realistic sample data if none is provided.",
  },
  {
    key: "training",
    label: "Training compliance report",
    prompt:
      "Build a training compliance sheet: one row per employee with columns for Employee, Required Training Docs (comma-separated), Completed Count, Status (Compliant / Overdue / Pending), and Last Completed Date. Use realistic sample data if none is provided.",
  },
] as const;

/** Parse a generic multi-column CSV into a grid — the first row is the header,
 *  every data row is padded/truncated to that width so the result is always
 *  rectangular. Unlike `parseCsvPoints` (the Charts tab's 2-column label/value
 *  parser), this keeps every column. Malformed rows are dropped, not thrown —
 *  a partial paste/upload still produces a usable (if partial) sheet. */
export function parseCsvTable(text: string): SpreadsheetGrid {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, SPREADSHEET_MAX_ROWS + 1);
  if (lines.length === 0) return { title: "Untitled sheet", headers: [], rows: [] };

  const splitRow = (line: string): string[] =>
    line
      .split(",")
      .map((c) => clampCell(c.trim().replace(/^"(.*)"$/, "$1")))
      .slice(0, SPREADSHEET_MAX_COLS);

  const headers = splitRow(lines[0]);
  const rows = lines.slice(1).map((l) => {
    const cols = splitRow(l);
    return headers.map((_, i) => cols[i] ?? "");
  });
  return { title: "Untitled sheet", headers, rows };
}

/** Clamp+coerce a loosely-typed grid (model JSON, or a client-submitted body)
 *  into a valid, rectangular `SpreadsheetGrid` — or null if there's nothing
 *  usable at all. Never trusts the shape of model output or a request body:
 *  every cell is stringified and length-capped, every row is padded/truncated
 *  to the header width, and the whole grid is capped at the size limits above. */
export function sanitizeGrid(v: unknown, fallbackTitle = "Untitled sheet"): SpreadsheetGrid | null {
  if (!v || typeof v !== "object") return null;
  const g = v as Record<string, unknown>;
  const headersRaw = Array.isArray(g.headers) ? g.headers : [];
  const headers = headersRaw.slice(0, SPREADSHEET_MAX_COLS).map((h, i) => clampCell(h) || `Column ${i + 1}`);
  if (headers.length === 0) return null;
  const rowsRaw = Array.isArray(g.rows) ? g.rows : [];
  const rows = rowsRaw.slice(0, SPREADSHEET_MAX_ROWS).map((r) => {
    const arr = Array.isArray(r) ? r : [];
    return headers.map((_, i) => clampCell((arr as unknown[])[i]));
  });
  const title = clampCell(g.title) || fallbackTitle;
  return { title, headers, rows };
}

/** Render a grid as a plain, print-safe HTML `<table>` for a Documents row's
 *  `body_html` — inline styles only (no `<style>` block, no script), so it
 *  survives `sanitizeDocumentHtml` untouched and renders identically in the
 *  editor, the viewer, and a printed PDF. */
export function spreadsheetGridToHtmlTable(grid: SpreadsheetGrid): string {
  const cellStyle = "border:1px solid #ccc;padding:6px 10px;text-align:left;";
  const thead = `<tr>${grid.headers.map((h) => `<th style="${cellStyle}background:#f3f3f3;font-weight:700;">${escapeXml(h)}</th>`).join("")}</tr>`;
  const tbody = grid.rows.map((r) => `<tr>${r.map((c) => `<td style="${cellStyle}">${escapeXml(c)}</td>`).join("")}</tr>`).join("");
  return `<table style="border-collapse:collapse;width:100%;font-size:13px;">${thead}${tbody}</table>`;
}

/** Prompt for the Spreadsheet Creator's "Describe it" and upload-structuring
 *  paths — asks for strict JSON matching `SpreadsheetGrid` so the route can
 *  parse it with `extractJson` (lib/tools-ai.ts) and clamp it with
 *  `sanitizeGrid`. When `extractedText` is given (an uploaded PDF/DOCX/TXT),
 *  the description becomes an instruction for how to structure that text
 *  rather than a request to invent data from nothing. */
export function buildSpreadsheetPrompt(args: { description: string; extractedText?: string }): { system: string; user: string } {
  const { description, extractedText } = args;
  const system = `You are a meticulous data-entry analyst who turns a plain-language request — and, when given, raw source text extracted from an uploaded file — into a clean, structured spreadsheet. Return ONLY valid JSON, no markdown, no explanation, nothing else, in this exact shape:
{
  "title": "<a short, specific sheet title>",
  "headers": [<column names as strings, at most ${SPREADSHEET_MAX_COLS}>],
  "rows": [[<one string per header, same order, same length as headers>], ...]
}
Every row array must have exactly as many strings as there are headers — use "" for a genuinely empty cell, never omit one. Keep numbers as plain strings ("42", "40.5"), not JSON numbers. Cap the sheet at ${SPREADSHEET_MAX_ROWS} rows.`;

  let user = `Build a spreadsheet for this request:\n\n${description.trim() || "(no description given — infer a reasonable sheet from the source text below)"}`;
  if (extractedText) {
    user += `\n\n## Source text (extracted from an uploaded file — structure THIS data; do not invent rows that aren't grounded in it unless the request above explicitly asks you to fill gaps):\n${extractedText.slice(0, 12000)}`;
  }
  return { system, user };
}

// ── Report Writer (Scale+, Phase 5) ─────────────────────────────────────────

export const REPORT_SOURCES = ["hiring", "timesheet", "training"] as const;
export type ReportSource = (typeof REPORT_SOURCES)[number];
export const isReportSource = (v: unknown): v is ReportSource => (REPORT_SOURCES as readonly string[]).includes(String(v));
export const REPORT_SOURCE_LABELS: Record<ReportSource, string> = {
  hiring: "Hiring activity",
  timesheet: "Timesheet hours",
  training: "Training compliance",
};

export interface ReportDateRange {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD, inclusive
}

/** A report range must be two real calendar dates, start on/before end, and no
 *  more than a year — generous for "last 30/90 days" while still bounding how
 *  much data (and prompt size) a single report can pull in. */
export function isValidReportRange(r: unknown): r is ReportDateRange {
  if (!r || typeof r !== "object") return false;
  const { start, end } = r as Partial<ReportDateRange>;
  if (typeof start !== "string" || typeof end !== "string") return false;
  const s = parseISODate(start);
  const e = parseISODate(end);
  if (!s || !e) return false;
  if (s.getTime() > e.getTime()) return false;
  return (e.getTime() - s.getTime()) / 864e5 <= 366;
}

function fmtRangeDate(d: Date, withYear: boolean): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
}

/** Human label for a range, e.g. "Aug 28 – Sep 27, 2026" (mirrors time-hub's
 *  `weekLabel`). */
export function reportRangeLabel(r: ReportDateRange): string {
  const s = parseISODate(r.start);
  const e = parseISODate(r.end);
  if (!s || !e) return `${r.start} – ${r.end}`;
  return `${fmtRangeDate(s, false)} – ${fmtRangeDate(e, true)}`;
}

/** "{Source} report — {date range}" — the title used both to auto-save the
 *  generated report to Documents and to show in the Report Writer UI before
 *  it's generated. */
export function reportTitle(source: ReportSource, r: ReportDateRange): string {
  return `${REPORT_SOURCE_LABELS[source]} report — ${reportRangeLabel(r)}`;
}

/** The three data shapes `office-store.ts`'s gatherers populate from the
 *  platform's own tables — plain JSON handed to the model as the report's
 *  only source of facts (the prompt instructs it never to cite a number
 *  that isn't in here). */
export interface HiringActivityData {
  jobsPosted: number;
  totalApplicants: number;
  interviewed: number;
  offersExtended: number;
  hired: number;
  topJobs: { title: string; applicants: number }[];
}

export interface TimesheetSummaryData {
  totalHours: number;
  employeeCount: number;
  byEmployee: { name: string; hours: number }[];
  /** Employees whose TOTAL hours across the whole range exceeded 40 — a rough
   *  signal for a range that may span more than one week, not a per-week
   *  overtime calculation (see `overtimePay` above for that). */
  overtimeEmployees: { name: string; hours: number }[];
}

export interface TrainingComplianceData {
  totalAssigned: number;
  signed: number;
  overdue: number;
  pending: number;
  compliancePct: number;
  byDoc: { title: string; signed: number; total: number }[];
}

export type ReportData = HiringActivityData | TimesheetSummaryData | TrainingComplianceData;

/** Prompt for the Report Writer — the model only ever sees the pre-aggregated
 *  JSON, never raw rows, so it can't leak more than the numbers it's given and
 *  can't be steered by anything in a resume/applicant/timesheet field. */
export function buildReportPrompt(source: ReportSource, range: ReportDateRange, data: ReportData): { system: string; user: string } {
  const system = `You are a sharp, plain-language business writer producing an internal report for a small company's owner or manager — never fluffy, never generic. Write in clear prose with short paragraphs and, where it clarifies the numbers, a simple HTML table. Ground every sentence in the data given; never invent a figure that isn't in it. If the data is essentially empty (all zeros, no rows), say so plainly instead of padding with generic advice.

Return ONLY a fragment of HTML for the report body: a few <h2> section headings, <p> paragraphs, an optional <table>/<tr>/<td> table, and a short <ul>/<li> list of 2-4 concrete takeaways at the end. No <html>/<head>/<body> wrapper, no markdown, no inline <script> or <style>.`;

  const user = `## Report: ${REPORT_SOURCE_LABELS[source]}
## Date range: ${reportRangeLabel(range)}

## Data (JSON — the only facts you may cite):
${JSON.stringify(data, null, 2)}

Write the report now.`;

  return { system, user };
}

// ── Presentation Builder (Scale+, Phase 6) ──────────────────────────────────

export const PRESENTATION_SLIDE_COUNTS = [5, 10, 15] as const;
export type PresentationSlideCount = (typeof PRESENTATION_SLIDE_COUNTS)[number];
export const isPresentationSlideCount = (v: unknown): v is PresentationSlideCount =>
  (PRESENTATION_SLIDE_COUNTS as readonly number[]).includes(Number(v));

const PRESENTATION_MAX_TITLE = 100;
const PRESENTATION_MAX_BULLET = 200;
const PRESENTATION_MAX_BULLETS_PER_SLIDE = 6;

export interface PresentationSlide {
  title: string;
  bullets: string[];
}

export interface PresentationDeck {
  title: string;
  slides: PresentationSlide[];
}

function clampTitle(v: unknown): string {
  return String(v ?? "").slice(0, PRESENTATION_MAX_TITLE);
}
function clampBullet(v: unknown): string {
  return String(v ?? "").slice(0, PRESENTATION_MAX_BULLET);
}

/** Clamp+coerce loosely-typed deck JSON (model output, or a client-submitted
 *  body) into a valid `PresentationDeck` — or null if there's nothing usable.
 *  Same never-trust-the-shape approach as `sanitizeGrid`: every string is
 *  length-capped, every slide's bullet list is capped, and the whole deck is
 *  capped at `maxSlides` (the slide count the user asked for). */
export function sanitizeDeck(v: unknown, maxSlides: number, fallbackTitle = "Untitled presentation"): PresentationDeck | null {
  if (!v || typeof v !== "object") return null;
  const g = v as Record<string, unknown>;
  const slidesRaw = Array.isArray(g.slides) ? g.slides : [];
  const slides: PresentationSlide[] = slidesRaw.slice(0, Math.max(1, maxSlides)).map((s) => {
    const slide = s && typeof s === "object" ? (s as Record<string, unknown>) : {};
    const bulletsRaw = Array.isArray(slide.bullets) ? slide.bullets : [];
    return {
      title: clampTitle(slide.title) || "Untitled slide",
      bullets: bulletsRaw
        .slice(0, PRESENTATION_MAX_BULLETS_PER_SLIDE)
        .map(clampBullet)
        .filter(Boolean),
    };
  });
  if (slides.length === 0) return null;
  return { title: clampTitle(g.title) || fallbackTitle, slides };
}

/** Prompt for the Presentation Builder — one generation produces the whole
 *  deck as strict JSON (no per-slide AI calls). Either a free-text `topic`,
 *  or the same `source`/`range`/`data` triple the Report Writer uses (the
 *  model sees only the pre-aggregated JSON there, never raw rows). */
export function buildPresentationPrompt(args: {
  topic?: string;
  source?: ReportSource;
  range?: ReportDateRange;
  data?: ReportData;
  slideCount: PresentationSlideCount;
}): { system: string; user: string } {
  const { topic, source, range, data, slideCount } = args;
  const system = `You are a sharp business presentation writer who turns a topic — or a set of internal numbers — into a clean, scannable slide deck for a small company's owner or manager. Return ONLY valid JSON, no markdown, no explanation, nothing else, in this exact shape:
{
  "title": "<a short, specific deck title>",
  "slides": [
    { "title": "<slide title, at most ${PRESENTATION_MAX_TITLE} characters>", "bullets": [<2 to ${PRESENTATION_MAX_BULLETS_PER_SLIDE} short bullet strings, at most ${PRESENTATION_MAX_BULLET} characters each>] }
  ]
}
Produce EXACTLY ${slideCount} slides: the first is a title/overview slide, the last is a closing takeaways slide. Every bullet is a short, punchy phrase — never a full paragraph, never a complete sentence with a period. Ground every claim in the data given (when data is given); never invent a figure that isn't there.`;

  const user =
    source && range && data
      ? `## Presentation topic: ${REPORT_SOURCE_LABELS[source]}
## Date range: ${reportRangeLabel(range)}
## Data (JSON — the only facts you may cite):
${JSON.stringify(data, null, 2)}

Write the ${slideCount}-slide deck now.`
      : `## Presentation topic:
${(topic || "").trim() || "(no topic given — write a short generic business deck)"}

Write the ${slideCount}-slide deck now.`;

  return { system, user };
}

/** Render a deck as static, print-safe HTML for a Documents row's `body_html`
 *  — one stacked block per slide (no JS, no per-slide viewport sizing), so it
 *  opens in the Documents viewer as a scrollable deck rather than needing the
 *  interactive Present mode. Inline styles only, matching `sanitizeDocumentHtml`'s
 *  allowlist (no `<style>` block, no script). */
export function presentationDeckToHtml(deck: PresentationDeck): string {
  const slideStyle = "border:1px solid #ddd;border-radius:10px;padding:24px 28px;margin:0 0 20px;background:#fafafa;";
  return deck.slides
    .map(
      (s, i) => `<div style="${slideStyle}">
  <h2 style="margin:0 0 12px;font-size:1.3rem;">${escapeXml(s.title)}</h2>
  <ul style="margin:0;padding-left:1.3rem;">
    ${s.bullets.map((b) => `<li style="margin:0 0 6px;">${escapeXml(b)}</li>`).join("\n    ")}
  </ul>
  <div style="margin-top:14px;font-size:11px;color:#999;">Slide ${i + 1} of ${deck.slides.length}</div>
</div>`
    )
    .join("\n");
}
