"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Compass, Plus, Trash2, Check, Loader2, Lock, Target, Award, DollarSign,
  ChevronDown, Sparkles, Route, TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ToolModal } from "../components/tool-modal";
import { TextInput, TextArea, Select, UpgradeNote } from "../components/ui";
import {
  INDUSTRIES, GOAL_CATEGORIES, PRIORITIES, GOAL_STATUSES, MILESTONE_TYPES, daysUntil, velocityScore,
  type CareerProfile, type CareerGoal, type CareerMilestone, type GoalCategory, type Priority,
  type GoalStatus, type MilestoneType, type Roadmap, type SkillGap, type Insights,
} from "@/lib/career-ai";

const FREE_GOAL_LIMIT = 3;
const CAT_TONE: Record<string, string> = {
  promotion: "bg-violet/20 text-violet", skill: "bg-teal/15 text-teal", certification: "bg-gold/20 text-gold",
  networking: "bg-sky-500/15 text-sky-300", salary: "bg-emerald-500/15 text-emerald-300", transition: "bg-rose-500/15 text-rose-300",
};
const MS_COLOR: Record<string, string> = {
  job: "#2563eb", promotion: "#8B5CF6", certification: "#14B8A6", project: "#F59E0B", salary: "#059669", education: "#e11d48",
};
const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

export function CareerHubTool({ onClose, isPro }: { onClose: () => void; isPro: boolean }) {
  const t = useTranslations("candidateTools.careerHub");
  const categoryLabel = (c: string) => t(`categories.${c}` as "categories.skill");
  const priorityLabel = (p: string) => t(`priorities.${p}` as "priorities.high");
  const milestoneTypeLabel = (m: string) => t(`milestoneTypes.${m}` as "milestoneTypes.job");
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<CareerProfile>({ currentRole: "", targetRole: "", industry: "Tech", yearsExperience: null });
  const [savedProfile, setSavedProfile] = useState(false);
  const [goals, setGoals] = useState<CareerGoal[]>([]);
  const [milestones, setMilestones] = useState<CareerMilestone[]>([]);
  const [error, setError] = useState<string | null>(null);

  // add forms
  const [goalForm, setGoalForm] = useState<{ open: boolean; title: string; category: GoalCategory; priority: Priority; targetDate: string; notes: string }>({ open: false, title: "", category: "skill", priority: "medium", targetDate: "", notes: "" });
  const [msForm, setMsForm] = useState<{ open: boolean; type: MilestoneType; title: string; date: string; description: string; impact: string }>({ open: false, type: "job", title: "", date: "", description: "", impact: "" });

  // AI (Pro)
  const [roadmap, setRoadmap] = useState<Roadmap | null>(null);
  const [skillGap, setSkillGap] = useState<SkillGap | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [busy, setBusy] = useState<"roadmap" | "gap" | "insights" | null>(null);
  const [skillsInput, setSkillsInput] = useState("");

  // Salary progression (client-only; no table in spec)
  const [salaries, setSalaries] = useState<{ year: string; amount: number }[]>([]);
  const [salYear, setSalYear] = useState(""); const [salAmt, setSalAmt] = useState("");
  const [salaryOpen, setSalaryOpen] = useState(false);
  const [certOpen, setCertOpen] = useState(true);

  async function reload() {
    try {
      const res = await fetch("/api/career", { cache: "no-store" });
      const d = (await res.json().catch(() => ({}))) as { profile?: CareerProfile | null; goals?: CareerGoal[]; milestones?: CareerMilestone[] };
      if (d.profile) { setProfile(d.profile); setSavedProfile(true); }
      setGoals(d.goals || []);
      setMilestones(d.milestones || []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }
  useEffect(() => { reload(); }, []);

  async function saveProfile() {
    setSavedProfile(false);
    await fetch("/api/career/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(profile) });
    setSavedProfile(true);
  }

  async function addGoal(seed?: Partial<CareerGoal>) {
    const payload = seed || { title: goalForm.title.trim(), category: goalForm.category, priority: goalForm.priority, targetDate: goalForm.targetDate || null, notes: goalForm.notes || null };
    if (!payload.title) { setError(t("errorGoalTitle")); return; }
    if (!isPro && goals.length >= FREE_GOAL_LIMIT) { router.push("/candidate?upgrade=pro"); return; }
    setError(null);
    const res = await fetch("/api/career/goals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (res.status === 402) { router.push("/candidate?upgrade=pro"); return; }
    const d = (await res.json().catch(() => ({}))) as { goal?: CareerGoal; error?: string; message?: string };
    if (!res.ok || !d.goal) { setError(d.message || d.error || t("errorCouldNotSaveGoal")); return; }
    setGoals((g) => [...g, d.goal!]);
    if (!seed) setGoalForm({ open: false, title: "", category: "skill", priority: "medium", targetDate: "", notes: "" });
  }
  async function patchGoal(id: number, patch: Partial<CareerGoal>) {
    setGoals((g) => g.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    await fetch(`/api/career/goals/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
  }
  async function delGoal(id: number) { setGoals((g) => g.filter((x) => x.id !== id)); await fetch(`/api/career/goals/${id}`, { method: "DELETE" }); }

  async function addMilestone() {
    if (!msForm.title.trim() || !msForm.date) { setError(t("errorMilestoneTitleDate")); return; }
    setError(null);
    const res = await fetch("/api/career/milestones", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: msForm.type, title: msForm.title.trim(), date: msForm.date, description: msForm.description, impact: msForm.impact }) });
    const d = (await res.json().catch(() => ({}))) as { milestone?: CareerMilestone; error?: string; message?: string };
    if (!res.ok || !d.milestone) { setError(d.message || d.error || t("errorCouldNotSave")); return; }
    setMilestones((m) => [d.milestone!, ...m].sort((a, b) => (a.date < b.date ? 1 : -1)));
    setMsForm({ open: false, type: "job", title: "", date: "", description: "", impact: "" });
  }
  async function delMilestone(id: number) { setMilestones((m) => m.filter((x) => x.id !== id)); await fetch(`/api/career/milestones/${id}`, { method: "DELETE" }); }

  const skills = useMemo(() => skillsInput.split(/[,\n]/).map((s) => s.trim()).filter(Boolean), [skillsInput]);

  async function runAI(kind: "roadmap" | "gap" | "insights") {
    if (!isPro) { router.push("/candidate?upgrade=pro"); return; }
    setBusy(kind); setError(null);
    try {
      if (kind === "roadmap") {
        const res = await fetch("/api/career/roadmap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...profile, skills, goals: goals.map((g) => g.title) }) });
        if (res.status === 402) return router.push("/candidate?upgrade=pro");
        const d = await res.json(); if (!res.ok) throw new Error(d.message || d.error); setRoadmap(d as Roadmap);
      } else if (kind === "gap") {
        const res = await fetch("/api/career/skill-gap", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentSkills: skills, targetRole: profile.targetRole, industry: profile.industry }) });
        if (res.status === 402) return router.push("/candidate?upgrade=pro");
        const d = await res.json(); if (!res.ok) throw new Error(d.message || d.error); setSkillGap(d as SkillGap);
      } else {
        const res = await fetch("/api/career/insights", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentRole: profile.currentRole, targetRole: profile.targetRole, milestones: milestones.map((m) => ({ title: m.title, date: m.date })), goals: goals.map((g) => ({ title: g.title, status: g.status })) }) });
        if (res.status === 402) return router.push("/candidate?upgrade=pro");
        const d = await res.json(); if (!res.ok) throw new Error(d.message || d.error); setInsights(d as Insights);
      }
    } catch (e) { setError(e instanceof Error ? e.message : t("errorGeneric")); } finally { setBusy(null); }
  }

  const localVelocity = useMemo(() => velocityScore(milestones, goals), [milestones, goals]);
  const certs = useMemo(() => Array.from(new Set((roadmap?.roadmap || []).flatMap((s) => s.certifications))).slice(0, 10), [roadmap]);
  const maxSal = useMemo(() => Math.max(1, ...salaries.map((s) => s.amount)), [salaries]);

  if (loading) return <ToolModal title={t("title")} icon={Compass} onClose={onClose}><div className="flex h-full items-center justify-center text-white/50"><Loader2 className="h-5 w-5 animate-spin" /></div></ToolModal>;

  return (
    <ToolModal title={t("title")} icon={Compass} onClose={onClose}>
      <div className="grid h-full grid-cols-1 lg:grid-cols-[45%_55%]">
        {/* LEFT */}
        <div className="min-h-0 space-y-5 overflow-y-auto border-b border-border-gold p-4 lg:border-b-0 lg:border-r">
          {/* Profile */}
          <div className="space-y-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
            <div className="flex items-center gap-2"><Target className="h-4 w-4 text-violet" /><h4 className="text-sm font-semibold text-cream">{t("careerProfile")}</h4></div>
            <div className="grid grid-cols-2 gap-2">
              <TextInput value={profile.currentRole} onChange={(e) => setProfile((p) => ({ ...p, currentRole: e.target.value }))} placeholder={t("currentRole")} />
              <TextInput value={profile.targetRole} onChange={(e) => setProfile((p) => ({ ...p, targetRole: e.target.value }))} placeholder={t("targetRolePlaceholder")} />
              <TextInput type="number" value={profile.yearsExperience ?? ""} onChange={(e) => setProfile((p) => ({ ...p, yearsExperience: e.target.value ? Number(e.target.value) : null }))} placeholder={t("yearsExpPlaceholder")} />
              <Select value={profile.industry} onChange={(e) => setProfile((p) => ({ ...p, industry: e.target.value }))}>{INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}</Select>
            </div>
            <button type="button" onClick={saveProfile} className="inline-flex items-center gap-1.5 rounded-lg bg-violet px-3 py-1.5 text-xs font-semibold text-white">{savedProfile ? <><Check className="h-3.5 w-3.5" /> {t("saved")}</> : t("saveProfile")}</button>
          </div>

          {/* Goals */}
          <Section title={t("goals")} action={
            <button type="button" onClick={() => { if (!isPro && goals.length >= FREE_GOAL_LIMIT) { router.push("/candidate?upgrade=pro"); return; } setGoalForm((f) => ({ ...f, open: !f.open })); }} className="inline-flex items-center gap-1 text-xs font-semibold text-violet hover:underline">
              {!isPro && goals.length >= FREE_GOAL_LIMIT ? <Lock className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {t("addGoal")}
            </button>
          }>
            {goalForm.open && (
              <div className="mb-2 space-y-2 rounded-xl border border-border-gold bg-white/5 p-3">
                <TextInput value={goalForm.title} onChange={(e) => setGoalForm((f) => ({ ...f, title: e.target.value }))} placeholder={t("goalTitlePlaceholder")} />
                <div className="grid grid-cols-2 gap-2">
                  <Select value={goalForm.category} onChange={(e) => setGoalForm((f) => ({ ...f, category: e.target.value as GoalCategory }))}>{GOAL_CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}</Select>
                  <Select value={goalForm.priority} onChange={(e) => setGoalForm((f) => ({ ...f, priority: e.target.value as Priority }))}>{PRIORITIES.map((p) => <option key={p} value={p}>{t("priorityOption", { priority: priorityLabel(p) })}</option>)}</Select>
                  <TextInput type="date" value={goalForm.targetDate} onChange={(e) => setGoalForm((f) => ({ ...f, targetDate: e.target.value }))} />
                </div>
                <TextArea rows={2} value={goalForm.notes} onChange={(e) => setGoalForm((f) => ({ ...f, notes: e.target.value }))} placeholder={t("notesOptionalPlaceholder")} className="text-xs" />
                <button type="button" onClick={() => addGoal()} className="rounded-lg bg-violet px-3 py-1.5 text-xs font-semibold text-white">{t("saveGoal")}</button>
              </div>
            )}
            {goals.length === 0 ? <p className="text-xs text-white/45">{t("noGoalsYet", { limit: isPro ? t("unlimited") : t("freeLimit", { n: FREE_GOAL_LIMIT }) })}</p> : (
              <div className="space-y-2">
                {goals.map((g) => <GoalCard key={g.id} g={g} onPatch={patchGoal} onDelete={delGoal} />)}
                {!isPro && goals.length >= FREE_GOAL_LIMIT && <UpgradeNote>{t("usedFreeGoals", { limit: FREE_GOAL_LIMIT })}</UpgradeNote>}
              </div>
            )}
          </Section>

          {/* Milestones */}
          <Section title={t("milestones")} action={<button type="button" onClick={() => setMsForm((f) => ({ ...f, open: !f.open }))} className="inline-flex items-center gap-1 text-xs font-semibold text-violet hover:underline"><Plus className="h-3.5 w-3.5" /> {t("add")}</button>}>
            {msForm.open && (
              <div className="mb-2 space-y-2 rounded-xl border border-border-gold bg-white/5 p-3">
                <div className="grid grid-cols-2 gap-2">
                  <Select value={msForm.type} onChange={(e) => setMsForm((f) => ({ ...f, type: e.target.value as MilestoneType }))}>{MILESTONE_TYPES.map((mt) => <option key={mt} value={mt}>{milestoneTypeLabel(mt)}</option>)}</Select>
                  <TextInput type="date" value={msForm.date} onChange={(e) => setMsForm((f) => ({ ...f, date: e.target.value }))} />
                </div>
                <TextInput value={msForm.title} onChange={(e) => setMsForm((f) => ({ ...f, title: e.target.value }))} placeholder={t("egPromoted")} />
                <TextInput value={msForm.impact} onChange={(e) => setMsForm((f) => ({ ...f, impact: e.target.value }))} placeholder={t("impactPlaceholder")} />
                <button type="button" onClick={addMilestone} className="rounded-lg bg-violet px-3 py-1.5 text-xs font-semibold text-white">{t("saveMilestone")}</button>
              </div>
            )}
            {milestones.length === 0 ? <p className="text-xs text-white/45">{t("addMilestonesPrompt")}</p> : (
              <ol className="relative ml-1 space-y-3 border-l border-border-gold pl-4">
                {milestones.map((m) => (
                  <li key={m.id} className="relative">
                    <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ring-2 ring-navy" style={{ background: MS_COLOR[m.type] || "#8B5CF6" }} />
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-white">{m.title}</p>
                        <p className="text-xs text-white/50">{milestoneTypeLabel(m.type)} · {m.date}</p>
                        {m.impact && <p className="mt-0.5 text-xs text-white/60">{m.impact}</p>}
                      </div>
                      <button type="button" onClick={() => delMilestone(m.id)} className="text-white/30 hover:text-red-300"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          {/* AI roadmap (Pro) */}
          <Section title={t("aiRoadmap")} action={<button type="button" onClick={() => runAI("roadmap")} disabled={busy === "roadmap"} className="inline-flex items-center gap-1 text-xs font-semibold text-violet hover:underline disabled:opacity-60">{busy === "roadmap" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isPro ? <Route className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />} {t("generate")}</button>}>
            <TextInput className="mb-2" value={skillsInput} onChange={(e) => setSkillsInput(e.target.value)} placeholder={t("skillsPlaceholder")} />
            {roadmap ? (
              <div className="space-y-2">
                <p className="text-xs text-white/55">{t("monthsToTarget", { months: roadmap.estimatedMonths, confidence: roadmap.confidence })}</p>
                {roadmap.roadmap.map((s, i) => (
                  <div key={i} className="rounded-xl border border-border-gold bg-white/5 p-3">
                    <div className="flex items-center gap-2"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-violet/20 text-[11px] font-bold text-violet">{i + 1}</span><span className="text-sm font-semibold text-cream">{s.stage}</span><span className="ml-auto text-xs text-teal">{s.timeframe}</span></div>
                    {s.skills.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{s.skills.map((k) => <span key={k} className="rounded-full bg-violet/15 px-2 py-0.5 text-[11px] text-violet">{k}</span>)}</div>}
                    {s.actions.length > 0 && <ul className="mt-1.5 space-y-0.5">{s.actions.map((a, j) => <li key={j} className="text-xs text-white/70">• {a}</li>)}</ul>}
                  </div>
                ))}
              </div>
            ) : !isPro ? <UpgradeNote>{t("upgradeRoadmap")}</UpgradeNote> : <p className="text-xs text-white/45">{t("setProfileThenGenerate")}</p>}
          </Section>

          {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
        </div>

        {/* RIGHT */}
        <div className="min-h-0 space-y-5 overflow-y-auto bg-navy/40 p-4">
          {/* Timeline viz */}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-cream">{t("careerTimeline")}</h3>
            <TimelineViz milestones={milestones} goals={goals} />
          </div>

          {/* Insights */}
          <div className="rounded-xl border border-border-gold bg-white/5 p-3.5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-cream">{t("insights")}</h3>
              <button type="button" onClick={() => runAI("insights")} disabled={busy === "insights"} className="inline-flex items-center gap-1 text-xs font-semibold text-violet hover:underline disabled:opacity-60">{busy === "insights" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isPro ? <Sparkles className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />} {insights ? t("refresh") : t("generate")}</button>
            </div>
            <div className="flex items-center gap-3">
              <Ring score={insights?.velocityScore ?? localVelocity} />
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-cream">{t("careerVelocity")}</div>
                <div className="font-serif text-lg text-cream">{insights?.velocityScore ?? localVelocity}<span className="text-sm text-white/40">/100</span></div>
              </div>
            </div>
            {insights ? (
              <div className="mt-3 space-y-2">
                <p className={cn("rounded-lg px-3 py-2 text-sm", insights.onTrack ? "bg-teal/10 text-teal" : "bg-gold/10 text-gold")}>{insights.onTrack ? t("onTrack") : t("behindSchedule")} {t("targetBy", { date: insights.targetDate })}</p>
                <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-cream">{t("top3Actions")}</div><ul className="space-y-1">{insights.topActions.map((a, i) => <li key={i} className="flex gap-2 text-sm text-white/80"><span className="text-violet">{i + 1}.</span> {a}</li>)}</ul></div>
              </div>
            ) : !isPro ? <div className="mt-3"><UpgradeNote>{t("upgradeInsights")}</UpgradeNote></div> : <p className="mt-3 text-xs text-white/45">{t("addGoalsThenGenerate")}</p>}
          </div>

          {/* Skill gap (Pro) */}
          <div className="rounded-xl border border-border-gold bg-white/5 p-3.5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-cream">{t("skillGapTo", { role: profile.targetRole || t("targetRoleFallback") })}</h3>
              <button type="button" onClick={() => runAI("gap")} disabled={busy === "gap"} className="inline-flex items-center gap-1 text-xs font-semibold text-violet hover:underline disabled:opacity-60">{busy === "gap" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isPro ? <TrendingUp className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />} {t("analyze")}</button>
            </div>
            {skillGap ? (
              <div className="space-y-3">
                {skillGap.haveIt.length > 0 && <div><div className="mb-1 text-[11px] font-semibold uppercase text-teal">{t("skillsYouHave")}</div><div className="flex flex-wrap gap-1.5">{skillGap.haveIt.map((s) => <span key={s.skill} className="inline-flex items-center gap-1 rounded-full bg-teal/15 px-2 py-0.5 text-xs text-teal"><Check className="h-3 w-3" /> {s.skill}</span>)}</div></div>}
                {skillGap.gaps.length > 0 && <div><div className="mb-1 text-[11px] font-semibold uppercase text-red-300">{t("skillsYouNeed")}</div><div className="space-y-2">{skillGap.gaps.map((gp) => (
                  <div key={gp.skill} className="rounded-lg border border-border-gold bg-navy/40 p-2.5">
                    <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium text-cream">{gp.skill}</span><span className="text-[11px] text-white/45">{gp.learnTime}</span></div>
                    <div className="mt-1 h-1 rounded-full bg-white/10"><div className="h-full rounded-full bg-red-400" style={{ width: `${gp.importance}%` }} /></div>
                    {gp.resources.length > 0 && <p className="mt-1 text-xs text-white/60">📚 {gp.resources[0]}</p>}
                    <button type="button" onClick={() => addGoal({ title: t("learnSkill", { skill: gp.skill }), category: "skill", priority: gp.importance >= 70 ? "high" : "medium", notes: gp.resources[0] || null })} className="mt-1 text-[11px] font-semibold text-violet hover:underline">{t("addToGoals")}</button>
                  </div>
                ))}</div></div>}
              </div>
            ) : !isPro ? <UpgradeNote>{t("upgradeSkillGap")}</UpgradeNote> : <p className="text-xs text-white/45">{t("setTargetThenAnalyze")}</p>}
          </div>

          {/* Certification tracker (Pro, from roadmap) */}
          {(certs.length > 0 || !isPro) && (
            <div className="rounded-xl border border-border-gold bg-white/5 p-3.5">
              <button type="button" onClick={() => setCertOpen((o) => !o)} className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted-cream"><span className="inline-flex items-center gap-1.5"><Award className="h-3.5 w-3.5 text-gold" /> {t("certificationTracker")}</span><ChevronDown className={cn("h-4 w-4 transition-transform", certOpen && "rotate-180")} /></button>
              {certOpen && (isPro ? (
                certs.length ? <ul className="mt-2 space-y-1.5">{certs.map((c) => (
                  <li key={c} className="flex items-center justify-between gap-2 rounded-lg border border-border-gold bg-navy/40 p-2 text-sm text-white/85"><span>{c}</span><button type="button" onClick={() => addGoal({ title: c, category: "certification", priority: "medium" })} className="text-[11px] font-semibold text-violet hover:underline">{t("addGoalShort")}</button></li>
                ))}</ul> : <p className="mt-2 text-xs text-white/45">{t("generateRoadmapForCerts")}</p>
              ) : <div className="mt-2"><UpgradeNote>{t("upgradeCerts")}</UpgradeNote></div>)}
            </div>
          )}

          {/* Salary progression (Pro) */}
          <div className="rounded-xl border border-border-gold bg-white/5 p-3.5">
            <button type="button" onClick={() => (isPro ? setSalaryOpen((o) => !o) : router.push("/candidate?upgrade=pro"))} className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted-cream"><span className="inline-flex items-center gap-1.5">{!isPro && <Lock className="h-3.5 w-3.5 text-gold" />}<DollarSign className="h-3.5 w-3.5 text-emerald-300" /> {t("salaryProgression")}</span><ChevronDown className={cn("h-4 w-4 transition-transform", salaryOpen && isPro && "rotate-180")} /></button>
            {isPro && salaryOpen && (
              <div className="mt-2 space-y-3">
                <div className="flex gap-2">
                  <TextInput value={salYear} onChange={(e) => setSalYear(e.target.value)} placeholder={t("yearPlaceholder")} className="w-20" />
                  <TextInput type="number" value={salAmt} onChange={(e) => setSalAmt(e.target.value)} placeholder={t("salaryPlaceholder")} />
                  <button type="button" onClick={() => { if (salYear && salAmt) { setSalaries((s) => [...s, { year: salYear, amount: Number(salAmt) }].sort((a, b) => a.year.localeCompare(b.year))); setSalYear(""); setSalAmt(""); } }} className="shrink-0 rounded-lg bg-violet px-3 text-xs font-semibold text-white">{t("addShort")}</button>
                </div>
                {salaries.length > 0 && (
                  <>
                    <div className="flex items-end gap-2" style={{ height: 90 }}>
                      {salaries.map((s, i) => (
                        <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1">
                          <span className="text-[9px] text-emerald-300">{money(s.amount).replace("$", "")}</span>
                          <div className="w-full rounded-t bg-emerald-500/60" style={{ height: `${Math.max(6, (s.amount / maxSal) * 70)}px` }} />
                          <span className="text-[9px] text-white/45">{s.year}</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-[11px] text-white/50">{t("projectedAtTarget")} <span className="font-semibold text-emerald-300">{money(Math.round(salaries[salaries.length - 1].amount * 1.25))}</span> <span className="text-white/35">{t("roughEstimate")}</span></p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </ToolModal>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-cream">{title}</h3>{action}</div>
      {children}
    </div>
  );
}

function GoalCard({ g, onPatch, onDelete }: { g: CareerGoal; onPatch: (id: number, p: Partial<CareerGoal>) => void; onDelete: (id: number) => void }) {
  const t = useTranslations("candidateTools.careerHub");
  const days = daysUntil(g.targetDate);
  const countdown = days === null ? null : days < 0 ? t("overdue", { n: -days }) : days === 0 ? t("dueToday") : t("dueIn", { n: days });
  const prTone = g.priority === "high" ? "bg-red-400" : g.priority === "low" ? "bg-white/30" : "bg-gold";
  return (
    <div className="rounded-xl border border-border-gold bg-white/5 p-3">
      <div className="flex items-start gap-2">
        <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", prTone)} title={t("priorityOption", { priority: t(`priorities.${g.priority}` as "priorities.high") })} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase", CAT_TONE[g.category])}>{t(`categories.${g.category}` as "categories.skill")}</span>
            {countdown && <span className={cn("text-[11px]", days !== null && days < 0 ? "text-red-300" : "text-white/45")}>{countdown}</span>}
          </div>
          <p className={cn("mt-1 text-sm text-white", g.status === "completed" && "line-through opacity-60")}>{g.title}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <input type="range" min={0} max={100} value={g.progress} onChange={(e) => onPatch(g.id, { progress: Number(e.target.value), status: Number(e.target.value) >= 100 ? "completed" : Number(e.target.value) > 0 ? "in_progress" : "not_started" })} className="h-1 flex-1 accent-violet" />
            <span className="w-9 text-right text-[11px] text-white/55">{g.progress}%</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <Select className="w-auto py-0.5 text-[11px]" value={g.status} onChange={(e) => onPatch(g.id, { status: e.target.value as GoalStatus, progress: e.target.value === "completed" ? 100 : g.progress })}>{GOAL_STATUSES.map((s) => <option key={s} value={s}>{t(`statuses.${s}` as "statuses.completed")}</option>)}</Select>
            {g.status !== "completed" && <button type="button" onClick={() => onPatch(g.id, { status: "completed", progress: 100 })} className="inline-flex items-center gap-1 text-[11px] text-teal hover:underline"><Check className="h-3 w-3" /> {t("complete")}</button>}
            <button type="button" onClick={() => onDelete(g.id)} className="ml-auto text-white/30 hover:text-red-300"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TimelineViz({ milestones, goals }: { milestones: CareerMilestone[]; goals: CareerGoal[] }) {
  const t = useTranslations("candidateTools.careerHub");
  const past = milestones.map((m) => ({ label: m.title, sub: m.date, color: MS_COLOR[m.type] || "#2563eb", future: false }));
  const future = goals.filter((g) => g.targetDate).map((g) => ({ label: g.title, sub: g.targetDate!, color: "#8B5CF6", future: true }));
  const points = [...[...past].reverse(), ...future.sort((a, b) => a.sub.localeCompare(b.sub))];
  if (!points.length) return <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-border-gold text-xs text-white/40">{t("addMilestonesTimelinePrompt")}</div>;
  return (
    <div className="overflow-x-auto rounded-xl border border-border-gold bg-white/5 p-4">
      <div className="flex min-w-max items-start gap-6">
        {points.map((p, i) => (
          <div key={i} className="flex w-28 flex-col items-center text-center">
            <div className="flex w-full items-center">
              <span className={cn("h-px flex-1", i === 0 ? "bg-transparent" : "bg-border-gold")} />
              <span className="h-3 w-3 rounded-full ring-2 ring-navy" style={{ background: p.color, boxShadow: p.future ? `0 0 0 2px ${p.color}55` : "none", opacity: p.future ? 0.85 : 1, borderStyle: p.future ? "dashed" : "solid" }} />
              <span className={cn("h-px flex-1", i === points.length - 1 ? "bg-transparent" : "bg-border-gold")} />
            </div>
            <p className={cn("mt-1.5 line-clamp-2 text-[11px]", p.future ? "text-white/60" : "text-white/85")}>{p.label}</p>
            <p className="text-[10px] text-white/40">{p.sub}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Ring({ score }: { score: number }) {
  const deg = Math.max(0, Math.min(100, score)) * 3.6;
  const color = score >= 66 ? "#14B8A6" : score >= 33 ? "#F59E0B" : "#f87171";
  return (
    <div className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full" style={{ background: `conic-gradient(${color} ${deg}deg, rgba(255,255,255,0.1) 0deg)` }}>
      <div className="flex h-[50px] w-[50px] items-center justify-center rounded-full bg-navy text-sm font-bold text-white">{score}</div>
    </div>
  );
}
