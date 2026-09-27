/**
 * Office suite — shared types and pure helpers (no DB, no network). Mirrors the
 * `cert-hub.ts` convention: this file holds the calculator math and the
 * hand-rolled SVG chart builder (no chart library, per the brief), both fully
 * unit-testable without a browser. `office-store.ts` is the DB/service-role
 * counterpart (live chart data sources + the office-assets upload).
 */

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

function escapeXml(s: string): string {
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

function buildAxisSvg(points: ChartPoint[], title: string, isLine: boolean, xLabel?: string, yLabel?: string): string {
  const margin = { top: 56, right: 28, bottom: xLabel ? 76 : 60, left: yLabel ? 64 : 50 };
  const plotW = SVG_WIDTH - margin.left - margin.right;
  const plotH = SVG_HEIGHT - margin.top - margin.bottom;
  const maxValue = Math.max(...points.map((p) => p.value), 0) * 1.15 || 1;

  const ticks = 4;
  const gridlines: string[] = [];
  const yTickLabels: string[] = [];
  for (let i = 0; i <= ticks; i++) {
    const v = (maxValue / ticks) * i;
    const y = margin.top + plotH - (v / maxValue) * plotH;
    gridlines.push(`<line x1="${margin.left}" y1="${y.toFixed(1)}" x2="${margin.left + plotW}" y2="${y.toFixed(1)}" stroke="#ffffff1a" stroke-width="1"/>`);
    yTickLabels.push(`<text x="${margin.left - 10}" y="${(y + 4).toFixed(1)}" fill="#ffffff99" font-family="sans-serif" font-size="10" text-anchor="end">${Math.round(v).toLocaleString()}</text>`);
  }

  const slot = plotW / points.length;
  const xLabels = points
    .map((p, i) => {
      const cx = margin.left + slot * i + slot / 2;
      const label = escapeXml(p.label.length > 12 ? p.label.slice(0, 11) + "…" : p.label);
      return `<text x="${cx.toFixed(1)}" y="${margin.top + plotH + 18}" fill="#ffffff99" font-family="sans-serif" font-size="10" text-anchor="middle" transform="rotate(20 ${cx.toFixed(1)} ${margin.top + plotH + 18})">${label}</text>`;
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
    const barW = slot * 0.6;
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
