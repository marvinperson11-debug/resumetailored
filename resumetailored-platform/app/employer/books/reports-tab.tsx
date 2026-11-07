"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, Loader2, BarChart3 } from "lucide-react";
import { Panel, Field, Input, TierUpgradeNote, EmptyState } from "../components/ui";
import { formatMoney } from "@/lib/books-hub";
import { buildChartSvg, type ChartPoint } from "@/lib/office-hub";

interface Pnl {
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  payrollCostCents: number | null;
}
interface CategoryRow {
  category: string;
  amountCents: number;
}
interface MonthRow {
  month: string;
  incomeCents: number;
  expenseCents: number;
}
interface ScheduleCRow {
  category: string;
  scheduleCLine: string;
  amountCents: number;
}
interface Worksheet {
  netProfitCents: number;
  estimatedSelfEmploymentTaxCents: number;
  suggestedSetAsideCents: number;
  disclaimer: string;
}

function defaultRange() {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const to = now.toISOString().slice(0, 10);
  return { from, to };
}

export function ReportsTab({ locked, canFull }: { locked: boolean; canFull: boolean }) {
  const t = useTranslations("employerBooks.reports");
  const [{ from, to }, setRange] = useState(defaultRange());
  const [pnl, setPnl] = useState<Pnl | null>(null);
  const [byCategory, setByCategory] = useState<CategoryRow[]>([]);
  const [byMonth, setByMonth] = useState<MonthRow[]>([]);
  const [scheduleC, setScheduleC] = useState<ScheduleCRow[]>([]);
  const [worksheet, setWorksheet] = useState<Worksheet | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (locked) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const qs = `from=${from}&to=${to}`;
    const [pnlRes, catRes, monthRes] = await Promise.all([
      fetch(`/api/employer/books/reports?type=pnl&${qs}`, { cache: "no-store" }),
      fetch(`/api/employer/books/reports?type=by-category&${qs}`, { cache: "no-store" }),
      fetch(`/api/employer/books/reports?type=by-month&${qs}`, { cache: "no-store" }),
    ]);
    setPnl(await pnlRes.json().catch(() => null));
    const cat = await catRes.json().catch(() => ({}));
    setByCategory(cat.rows || []);
    const month = await monthRes.json().catch(() => ({}));
    setByMonth(month.rows || []);

    if (canFull) {
      const [scRes, wsRes] = await Promise.all([
        fetch(`/api/employer/books/reports?type=schedule-c&${qs}`, { cache: "no-store" }),
        fetch(`/api/employer/books/reports?type=quarterly-estimate&${qs}`, { cache: "no-store" }),
      ]);
      const sc = await scRes.json().catch(() => ({}));
      setScheduleC(sc.rows || []);
      setWorksheet(await wsRes.json().catch(() => null));
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, canFull, from, to]);

  if (locked) {
    return <EmptyState icon={BarChart3} title={t("lockedTitle")} body={t("lockedBody")} />;
  }

  const categoryPoints: ChartPoint[] = byCategory.map((r) => ({ label: r.category, value: r.amountCents / 100 }));
  const monthPoints: ChartPoint[] = byMonth.map((r) => ({ label: r.month, value: r.incomeCents / 100 }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("rangeFrom")}>
          <Input type="date" value={from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
        </Field>
        <Field label={t("rangeTo")}>
          <Input type="date" value={to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
        </Field>
      </div>

      {loading || !pnl ? (
        <div className="flex items-center gap-2 text-sm text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("loading")}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Panel>
              <p className="text-xs uppercase tracking-wide text-white/50">{t("income")}</p>
              <p className="mt-1 text-2xl font-semibold text-teal">{formatMoney(pnl.incomeCents)}</p>
            </Panel>
            <Panel>
              <p className="text-xs uppercase tracking-wide text-white/50">{t("expenses")}</p>
              <p className="mt-1 text-2xl font-semibold text-gold">{formatMoney(pnl.expenseCents)}</p>
            </Panel>
            <Panel>
              <p className="text-xs uppercase tracking-wide text-white/50">{t("net")}</p>
              <p className={`mt-1 text-2xl font-semibold ${pnl.netCents >= 0 ? "text-teal" : "text-red-300"}`}>{formatMoney(pnl.netCents)}</p>
            </Panel>
          </div>
          {pnl.payrollCostCents !== null && (
            <p className="text-sm text-white/60">{t("payrollLine", { amount: formatMoney(pnl.payrollCostCents) })}</p>
          )}
          {canFull && <EmployeeWages />}
          <div className="flex justify-end">
            <a href={`/api/employer/books/reports?type=pnl&from=${from}&to=${to}&format=csv`} className="inline-flex items-center gap-1 text-xs text-violet hover:underline">
              <Download className="h-3.5 w-3.5" /> {t("exportCsv")}
            </a>
          </div>

          <Panel>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-serif text-lg font-medium text-cream">{t("byCategoryTitle")}</h3>
              <a href={`/api/employer/books/reports?type=by-category&from=${from}&to=${to}&format=csv`} className="inline-flex items-center gap-1 text-xs text-violet hover:underline">
                <Download className="h-3.5 w-3.5" /> {t("exportCsv")}
              </a>
            </div>
            {categoryPoints.length === 0 ? (
              <p className="text-sm text-white/50">{t("noData")}</p>
            ) : (
              <div dangerouslySetInnerHTML={{ __html: buildChartSvg({ type: "pie", title: t("byCategoryTitle"), points: categoryPoints }) }} />
            )}
          </Panel>

          <Panel>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-serif text-lg font-medium text-cream">{t("byMonthTitle")}</h3>
              <a href={`/api/employer/books/reports?type=by-month&from=${from}&to=${to}&format=csv`} className="inline-flex items-center gap-1 text-xs text-violet hover:underline">
                <Download className="h-3.5 w-3.5" /> {t("exportCsv")}
              </a>
            </div>
            {monthPoints.length === 0 ? (
              <p className="text-sm text-white/50">{t("noData")}</p>
            ) : (
              <div dangerouslySetInnerHTML={{ __html: buildChartSvg({ type: "bar", title: t("byMonthTitle"), points: monthPoints, yLabel: t("income") }) }} />
            )}
          </Panel>

          {canFull ? (
            <>
              <Panel>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-serif text-lg font-medium text-cream">{t("scheduleCTitle")}</h3>
                  <a href={`/api/employer/books/reports?type=schedule-c&from=${from}&to=${to}&format=csv`} className="inline-flex items-center gap-1 text-xs text-violet hover:underline">
                    <Download className="h-3.5 w-3.5" /> {t("exportCsv")}
                  </a>
                </div>
                <p className="mb-2 text-xs text-white/40">{t("taxDisclaimer")}</p>
                {scheduleC.length === 0 ? (
                  <p className="text-sm text-white/50">{t("noData")}</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border-gold text-left text-xs uppercase tracking-wide text-white/50">
                        <th className="py-2">{t("category")}</th>
                        <th className="py-2">{t("scheduleCLine")}</th>
                        <th className="py-2 text-right">{t("amount")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scheduleC.map((r) => (
                        <tr key={r.category} className="border-b border-border-gold/50">
                          <td className="py-1.5 text-cream">{r.category}</td>
                          <td className="py-1.5 text-white/60">{r.scheduleCLine}</td>
                          <td className="py-1.5 text-right text-cream">{formatMoney(r.amountCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Panel>

              {worksheet && (
                <Panel>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="font-serif text-lg font-medium text-cream">{t("quarterlyTitle")}</h3>
                    <a href={`/api/employer/books/reports?type=quarterly-estimate&from=${from}&to=${to}&format=csv`} className="inline-flex items-center gap-1 text-xs text-violet hover:underline">
                      <Download className="h-3.5 w-3.5" /> {t("exportCsv")}
                    </a>
                  </div>
                  <p className="mb-2 text-xs text-white/40">{worksheet.disclaimer}</p>
                  <ul className="space-y-1 text-sm text-cream">
                    <li>{t("netProfit")}: {formatMoney(worksheet.netProfitCents)}</li>
                    <li>{t("estimatedSeTax")}: {formatMoney(worksheet.estimatedSelfEmploymentTaxCents)}</li>
                    <li className="font-semibold">{t("suggestedSetAside")}: {formatMoney(worksheet.suggestedSetAsideCents)}</li>
                  </ul>
                </Panel>
              )}
            </>
          ) : (
            <TierUpgradeNote feature={t("taxReadyTitle")} tier="Corporate" />
          )}
        </>
      )}
    </div>
  );
}

interface WagedEmployee {
  id: number;
  name: string;
  role: string;
  hourlyWageCents: number | null;
}

/** The hiring tie-in's one write path (migration 0095 has no editor
 *  anywhere else): set each employee's hourly wage so Timesheets' existing
 *  hours roll up into the payroll-cost line above. Corporate only. */
function EmployeeWages() {
  const t = useTranslations("employerBooks.reports");
  const [employees, setEmployees] = useState<WagedEmployee[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);

  async function load() {
    const res = await fetch("/api/employer/books/employees-wage", { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    setEmployees(data.employees || []);
  }

  async function save(id: number, dollars: string) {
    setSaving(id);
    const hourlyWageCents = dollars === "" ? null : Math.round(Number(dollars) * 100);
    await fetch("/api/employer/books/employees-wage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeId: id, hourlyWageCents }) });
    setSaving(null);
  }

  return (
    <Panel>
      <button type="button" onClick={() => { setOpen((o) => !o); if (!open) load(); }} className="text-sm font-semibold text-violet hover:underline">
        {t("employeeWagesToggle")}
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          {employees.length === 0 ? (
            <p className="text-sm text-white/50">{t("noEmployees")}</p>
          ) : (
            employees.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-cream">
                  {e.name} {e.role ? `— ${e.role}` : ""}
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={e.hourlyWageCents !== null ? (e.hourlyWageCents / 100).toFixed(2) : ""}
                  onBlur={(ev) => save(e.id, ev.target.value)}
                  placeholder={t("hourlyWagePlaceholder")}
                  disabled={saving === e.id}
                  className="w-28 rounded-lg border border-border-gold bg-white/5 px-2 py-1 text-right text-sm text-cream outline-none focus:border-violet"
                />
              </div>
            ))
          )}
        </div>
      )}
    </Panel>
  );
}
