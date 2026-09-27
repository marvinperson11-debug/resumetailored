"use client";

import { useState } from "react";
import { DollarSign, UserPlus, Users, Clock, ListPlus, Plus, Trash2 } from "lucide-react";
import { Panel, Field, Input } from "../components/ui";
import {
  laborMonthlyCost,
  costPerHire,
  turnoverCost,
  overtimePay,
  staffingLineWeeklyCost,
  staffingTotalWeeklyCost,
  type StaffingLine,
} from "@/lib/office-hub";

const money = (n: number) => (Number.isFinite(n) ? n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }) : "$0.00");

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function CalcCard({ icon: Icon, title, children }: { icon: typeof DollarSign; title: string; children: React.ReactNode }) {
  return (
    <Panel>
      <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-cream">
        <Icon className="h-4 w-4 text-violet" /> {title}
      </h3>
      {children}
    </Panel>
  );
}

function Formula({ children }: { children: React.ReactNode }) {
  return <div className="mt-3 rounded-lg bg-white/5 px-3 py-2 font-mono text-xs text-white/55">{children}</div>;
}

function Result({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-3 rounded-lg border border-gold/30 bg-gold/5 px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-white/45">{label}</div>
      <div className="text-lg font-semibold text-gold">{value}</div>
    </div>
  );
}

/** Every calculator is pure client-side math (lib/office-hub.ts) — estimates
 *  only, no payroll and no payments. All tiers. */
export function CalculatorsTab() {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <LaborCostCalc />
      <CostPerHireCalc />
      <TurnoverCostCalc />
      <OvertimeCalc />
      <StaffingCostCalc />
    </div>
  );
}

function LaborCostCalc() {
  const [wage, setWage] = useState("22");
  const [hours, setHours] = useState("40");
  const [burden, setBurden] = useState("20");
  const result = laborMonthlyCost(num(wage), num(hours), num(burden));
  return (
    <CalcCard icon={DollarSign} title="Labor Cost Estimator">
      <div className="grid grid-cols-3 gap-2">
        <Field label="Hourly wage"><Input type="number" min={0} step="0.01" value={wage} onChange={(e) => setWage(e.target.value)} /></Field>
        <Field label="Hours/week"><Input type="number" min={0} step="1" value={hours} onChange={(e) => setHours(e.target.value)} /></Field>
        <Field label="Burden %"><Input type="number" min={0} step="1" value={burden} onChange={(e) => setBurden(e.target.value)} /></Field>
      </div>
      <Result label="Monthly cost" value={money(result)} />
      <Formula>
        {money(num(wage))} × (1 + {num(burden)}%) × {num(hours)} hrs/wk × 52 ÷ 12 = {money(result)}
      </Formula>
    </CalcCard>
  );
}

function CostPerHireCalc() {
  const [spend, setSpend] = useState("5000");
  const [hires, setHires] = useState("2");
  const result = costPerHire(num(spend), num(hires));
  return (
    <CalcCard icon={UserPlus} title="Cost-per-Hire">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Total hiring spend"><Input type="number" min={0} step="0.01" value={spend} onChange={(e) => setSpend(e.target.value)} /></Field>
        <Field label="Hires"><Input type="number" min={0} step="1" value={hires} onChange={(e) => setHires(e.target.value)} /></Field>
      </div>
      <Result label="Cost per hire" value={money(result)} />
      <Formula>
        {money(num(spend))} ÷ {num(hires)} hires = {money(result)}
      </Formula>
    </CalcCard>
  );
}

function TurnoverCostCalc() {
  const [replacements, setReplacements] = useState("3");
  const [avgCost, setAvgCost] = useState("4000");
  const result = turnoverCost(num(replacements), num(avgCost));
  return (
    <CalcCard icon={Users} title="Turnover Cost">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Replacements needed"><Input type="number" min={0} step="1" value={replacements} onChange={(e) => setReplacements(e.target.value)} /></Field>
        <Field label="Avg cost/replacement"><Input type="number" min={0} step="0.01" value={avgCost} onChange={(e) => setAvgCost(e.target.value)} /></Field>
      </div>
      <Result label="Total turnover cost" value={money(result)} />
      <Formula>
        {num(replacements)} × {money(num(avgCost))} = {money(result)}
      </Formula>
    </CalcCard>
  );
}

function OvertimeCalc() {
  const [rate, setRate] = useState("22");
  const [baseHours, setBaseHours] = useState("40");
  const [otHours, setOtHours] = useState("8");
  const [multiplier, setMultiplier] = useState("1.5");
  const result = overtimePay(num(baseHours), num(otHours), num(rate), num(multiplier));
  return (
    <CalcCard icon={Clock} title="Overtime Estimator">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Hourly rate"><Input type="number" min={0} step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} /></Field>
        <Field label="Rate multiplier"><Input type="number" min={1} step="0.1" value={multiplier} onChange={(e) => setMultiplier(e.target.value)} /></Field>
        <Field label="Base hours"><Input type="number" min={0} step="1" value={baseHours} onChange={(e) => setBaseHours(e.target.value)} /></Field>
        <Field label="OT hours"><Input type="number" min={0} step="1" value={otHours} onChange={(e) => setOtHours(e.target.value)} /></Field>
      </div>
      <Result label="Weekly pay" value={money(result)} />
      <Formula>
        ({num(baseHours)} × {money(num(rate))}) + ({num(otHours)} × {money(num(rate))} × {num(multiplier)}) = {money(result)}
      </Formula>
    </CalcCard>
  );
}

function StaffingCostCalc() {
  const [lines, setLines] = useState<StaffingLine[]>([{ role: "Cashier", headcount: 3, hoursPerWeek: 30, hourlyWage: 16 }]);

  function update(i: number, patch: Partial<StaffingLine>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function addLine() {
    setLines((prev) => [...prev, { role: "", headcount: 1, hoursPerWeek: 20, hourlyWage: 15 }]);
  }
  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, idx) => idx !== i));
  }

  const weeklyTotal = staffingTotalWeeklyCost(lines);

  return (
    <CalcCard icon={ListPlus} title="Staffing Cost">
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_4.5rem_4.5rem_5rem_auto] items-end gap-1.5">
            <Field label="Role"><Input value={l.role} onChange={(e) => update(i, { role: e.target.value })} placeholder="Role" /></Field>
            <Field label="Count"><Input type="number" min={0} step="1" value={l.headcount} onChange={(e) => update(i, { headcount: num(e.target.value) })} /></Field>
            <Field label="Hrs/wk"><Input type="number" min={0} step="1" value={l.hoursPerWeek} onChange={(e) => update(i, { hoursPerWeek: num(e.target.value) })} /></Field>
            <Field label="Wage"><Input type="number" min={0} step="0.01" value={l.hourlyWage} onChange={(e) => update(i, { hourlyWage: num(e.target.value) })} /></Field>
            <button
              type="button"
              onClick={() => removeLine(i)}
              disabled={lines.length <= 1}
              className="mb-0.5 rounded-md p-2 text-red-300/80 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-30"
              title="Remove line"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={addLine} className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-violet hover:underline">
        <Plus className="h-3.5 w-3.5" /> Add role
      </button>
      <Result label="Total weekly cost" value={money(weeklyTotal)} />
      <Formula>
        {lines.map((l, i) => (
          <div key={i}>
            {l.role || "Role"}: {l.headcount} × {l.hoursPerWeek}h × {money(l.hourlyWage)} = {money(staffingLineWeeklyCost(l))}
          </div>
        ))}
      </Formula>
    </CalcCard>
  );
}
