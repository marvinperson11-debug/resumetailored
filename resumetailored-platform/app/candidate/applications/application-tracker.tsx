"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search, Pencil, Trash2, Loader2, X, ExternalLink, CalendarClock, Briefcase } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { formatDate, formatMoney } from "@/lib/format";
import { Label, TextInput, TextArea, Select, PrimaryButton, SecondaryButton } from "../components/ui";
import { APPLICATION_STATUSES, type Application, type ApplicationStatus, type ApplicationInput } from "@/lib/applications";
import type { ResumeDraft } from "@/lib/draft-types";

const STATUS_TONE: Record<ApplicationStatus, string> = {
  Applied: "bg-violet/20 text-violet",
  "Phone Screen": "bg-sky-500/15 text-sky-300",
  Interview: "bg-gold/20 text-gold",
  Offer: "bg-teal/20 text-teal",
  Rejected: "bg-red-500/15 text-red-300",
  Ghosted: "bg-white/10 text-white/60",
  Withdrawn: "bg-white/10 text-white/50",
};

type SortKey = "date" | "company" | "status" | "days";

type Tr = ReturnType<typeof useTranslations>;

const STATUS_KEY: Record<ApplicationStatus, string> = {
  Applied: "applied",
  "Phone Screen": "phoneScreen",
  Interview: "interview",
  Offer: "offer",
  Rejected: "rejected",
  Ghosted: "ghosted",
  Withdrawn: "withdrawn",
};

/** "3 days ago" / "2 weeks ago" / "1 month ago" from an ISO timestamp (ICU plurals per locale). */
function daysSince(iso: string, t: Tr): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return t("ago.today");
  if (days === 1) return t("ago.yesterday");
  if (days < 7) return t("ago.days", { n: days });
  if (days < 14) return t("ago.weeks", { n: 1 });
  if (days < 30) return t("ago.weeks", { n: Math.floor(days / 7) });
  if (days < 60) return t("ago.months", { n: 1 });
  if (days < 365) return t("ago.months", { n: Math.floor(days / 30) });
  return t("ago.years", { n: Math.floor(days / 365) });
}
function daysNum(iso: string): number {
  const then = new Date(iso).getTime();
  return Number.isFinite(then) ? Math.floor((Date.now() - then) / 86400000) : 0;
}
function fmtDate(iso: string, locale: string): string {
  return formatDate(iso, locale, "medium", iso);
}
function followUpLabel(d: string | null, locale: string, t: Tr): { text: string; overdue: boolean } | null {
  if (!d) return null;
  const due = new Date(d + "T12:00:00").getTime();
  if (!Number.isFinite(due)) return null;
  return { text: t("followUp", { date: formatDate(d, locale, "monthDay") }), overdue: due < Date.now() };
}

const EMPTY: ApplicationInput = {
  company: "",
  role: "",
  status: "Applied",
  contactName: "",
  contactEmail: "",
  salary: "",
  location: "",
  url: "",
  notes: "",
  resumeId: "",
  followUpDate: "",
};

export function ApplicationTracker() {
  const locale = useLocale();
  const t = useTranslations("applicationTracker");
  const tRef = useRef(t);
  tRef.current = t;
  const [apps, setApps] = useState<Application[] | null>(null);
  const [resumes, setResumes] = useState<ResumeDraft[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ApplicationStatus>("all");
  const [sort, setSort] = useState<SortKey>("date");

  const [editing, setEditing] = useState<Application | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Application | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/applications", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { applications?: Application[]; error?: string };
      if (!res.ok) throw new Error(data.error || tRef.current("errors.load"));
      setApps(data.applications || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : tRef.current("errors.generic"));
      setApps([]);
    }
  }, []);

  useEffect(() => {
    load();
    fetch("/api/resumes", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { drafts?: ResumeDraft[] }) => setResumes(d.drafts || []))
      .catch(() => {});
  }, [load]);

  const resumeTitle = (id: string | null) => (id ? resumes.find((r) => r.id === id)?.title || "—" : "—");

  const visible = useMemo(() => {
    let list = apps || [];
    if (statusFilter !== "all") list = list.filter((a) => a.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((a) => a.company.toLowerCase().includes(q) || a.role.toLowerCase().includes(q));
    const sorted = [...list];
    sorted.sort((a, b) => {
      if (sort === "company") return a.company.localeCompare(b.company);
      if (sort === "status") return a.status.localeCompare(b.status);
      if (sort === "days") return daysNum(b.appliedAt) - daysNum(a.appliedAt);
      return new Date(b.appliedAt).getTime() - new Date(a.appliedAt).getTime(); // date (default)
    });
    return sorted;
  }, [apps, statusFilter, search, sort]);

  async function remove(a: Application) {
    setConfirmDelete(null);
    setApps((cur) => (cur ? cur.filter((x) => x.id !== a.id) : cur));
    await fetch(`/api/applications/${a.id}`, { method: "DELETE" });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-12">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-serif text-2xl font-medium text-white sm:text-3xl">{t("title")}</h1>
          <p className="mt-1 text-sm text-white/55">{t("subtitle")}</p>
        </div>
        <PrimaryButton onClick={() => setCreating(true)} className="self-start sm:self-auto">
          <Plus className="h-4 w-4" /> {t("add")}
        </PrimaryButton>
      </header>

      {/* Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchPlaceholder")}
            className="w-full rounded-xl border border-border-gold bg-white/5 py-2.5 pl-9 pr-3 text-sm text-cream placeholder:text-white/35 outline-none focus:border-violet"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "all" | ApplicationStatus)}
          className="rounded-xl border border-border-gold bg-white/5 px-3 py-2.5 text-sm text-cream outline-none focus:border-violet [&>option]:bg-navy"
        >
          <option value="all">{t("allStatuses")}</option>
          {APPLICATION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`statuses.${STATUS_KEY[s]}`)}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="rounded-xl border border-border-gold bg-white/5 px-3 py-2.5 text-sm text-cream outline-none focus:border-violet [&>option]:bg-navy"
        >
          <option value="date">{t("sort.date")}</option>
          <option value="company">{t("sort.company")}</option>
          <option value="status">{t("sort.status")}</option>
          <option value="days">{t("sort.days")}</option>
        </select>
      </div>

      {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}

      {apps === null ? (
        <div className="flex items-center justify-center py-20 text-white/50"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-border-gold bg-white/5 px-6 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet/15"><Briefcase className="h-6 w-6 text-violet" /></div>
          <div>
            <p className="font-medium text-cream">{apps.length === 0 ? t("empty.noneTitle") : t("empty.noMatchTitle")}</p>
            <p className="mt-1 text-sm text-white/55">{apps.length === 0 ? t("empty.noneBody") : t("empty.noMatchBody")}</p>
          </div>
          {apps.length === 0 && (
            <PrimaryButton onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> {t("add")}</PrimaryButton>
          )}
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-2xl border border-border-gold lg:block">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-b border-border-gold bg-white/5 text-xs uppercase tracking-wide text-white/50">
                <tr>
                  <th className="px-4 py-3 font-semibold">{t("cols.companyRole")}</th>
                  <th className="px-4 py-3 font-semibold">{t("cols.status")}</th>
                  <th className="px-4 py-3 font-semibold">{t("cols.submitted")}</th>
                  <th className="px-4 py-3 font-semibold">{t("cols.resume")}</th>
                  <th className="px-4 py-3 font-semibold">{t("cols.followUp")}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {visible.map((a) => {
                  const fu = followUpLabel(a.followUpDate, locale, t);
                  return (
                    <tr key={a.id} className="border-b border-border-gold/50 transition-colors hover:bg-white/5">
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">{a.company}</div>
                        <div className="text-white/60">{a.role}</div>
                        {a.location && <div className="text-xs text-white/40">{a.location}</div>}
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={a.status} /></td>
                      <td className="px-4 py-3">
                        <div className="text-white/80">{fmtDate(a.appliedAt, locale)}</div>
                        <div className="text-xs text-white/45">{daysSince(a.appliedAt, t)}</div>
                      </td>
                      <td className="px-4 py-3 text-white/70">{resumeTitle(a.resumeId)}</td>
                      <td className="px-4 py-3">
                        {fu ? <span className={cn("inline-flex items-center gap-1 text-xs", fu.overdue ? "text-red-300" : "text-white/60")}><CalendarClock className="h-3.5 w-3.5" />{fu.text}</span> : <span className="text-white/30">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <IconBtn label={t("edit")} onClick={() => setEditing(a)}><Pencil className="h-4 w-4" /></IconBtn>
                          <IconBtn label={t("delete")} onClick={() => setConfirmDelete(a)} danger><Trash2 className="h-4 w-4" /></IconBtn>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-3 lg:hidden">
            {visible.map((a) => {
              const fu = followUpLabel(a.followUpDate, locale, t);
              return (
                <div key={a.id} className="glass p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-white">{a.company}</div>
                      <div className="text-sm text-white/60">{a.role}</div>
                    </div>
                    <StatusBadge status={a.status} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/50">
                    <span>{fmtDate(a.appliedAt, locale)} · {daysSince(a.appliedAt, t)}</span>
                    {a.location && <span>{a.location}</span>}
                    {a.resumeId && <span>{t("resumeUsed", { title: resumeTitle(a.resumeId) })}</span>}
                    {fu && <span className={fu.overdue ? "text-red-300" : "text-white/60"}>{fu.text}</span>}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <SecondaryButton onClick={() => setEditing(a)} className="flex-1 py-2 text-xs"><Pencil className="h-3.5 w-3.5" /> {t("edit")}</SecondaryButton>
                    <SecondaryButton onClick={() => setConfirmDelete(a)} className="py-2 text-xs"><Trash2 className="h-3.5 w-3.5" /></SecondaryButton>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {(creating || editing) && (
        <ApplicationForm
          initial={editing}
          resumes={resumes}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={(saved) => {
            setApps((cur) => {
              const list = cur ? [...cur] : [];
              const i = list.findIndex((x) => x.id === saved.id);
              if (i >= 0) list[i] = saved;
              else list.unshift(saved);
              return list;
            });
            setCreating(false);
            setEditing(null);
          }}
        />
      )}

      {confirmDelete && (
        <Overlay onClose={() => setConfirmDelete(null)}>
          <h3 className="font-serif text-lg text-white">{t("deleteTitle")}</h3>
          <p className="mt-2 text-sm text-white/60">
            {t("deleteBody", { company: confirmDelete.company, role: confirmDelete.role })}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <SecondaryButton onClick={() => setConfirmDelete(null)}>{t("cancel")}</SecondaryButton>
            <button
              type="button"
              onClick={() => remove(confirmDelete)}
              className="rounded-xl bg-red-500/90 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-500"
            >
              {t("delete")}
            </button>
          </div>
        </Overlay>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: ApplicationStatus }) {
  const t = useTranslations("applicationTracker");
  return <span className={cn("inline-block rounded-full px-2.5 py-1 text-xs font-semibold", STATUS_TONE[status])}>{t(`statuses.${STATUS_KEY[status]}`)}</span>;
}

function IconBtn({ children, label, onClick, danger }: { children: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn("inline-flex items-center justify-center rounded-lg border border-border-gold px-2 py-1.5 text-white/60 transition-colors hover:bg-white/8", danger ? "hover:border-red-500/50 hover:text-red-300" : "hover:text-cream")}
    >
      {children}
    </button>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-navy/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-border-gold bg-navy p-5 shadow-2xl">{children}</div>
    </div>
  );
}

function ApplicationForm({
  initial,
  resumes,
  onClose,
  onSaved,
}: {
  initial: Application | null;
  resumes: ResumeDraft[];
  onClose: () => void;
  onSaved: (a: Application) => void;
}) {
  const locale = useLocale();
  const t = useTranslations("applicationTracker");
  const [form, setForm] = useState<ApplicationInput>(
    initial
      ? {
          company: initial.company,
          role: initial.role,
          status: initial.status,
          contactName: initial.contactName || "",
          contactEmail: initial.contactEmail || "",
          salary: initial.salary || "",
          location: initial.location || "",
          url: initial.url || "",
          notes: initial.notes || "",
          resumeId: initial.resumeId || "",
          followUpDate: initial.followUpDate || "",
          appliedAt: initial.appliedAt,
        }
      : { ...EMPTY, appliedAt: new Date().toISOString() }
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = <K extends keyof ApplicationInput>(k: K, v: ApplicationInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  // Date input uses YYYY-MM-DD; store back as ISO noon to avoid TZ slips.
  const appliedDateValue = (form.appliedAt || new Date().toISOString()).slice(0, 10);

  async function save() {
    if (!form.company?.trim() || !form.role?.trim()) {
      setErr(t("errors.required"));
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const url = initial ? `/api/applications/${initial.id}` : "/api/applications";
      const res = await fetch(url, {
        method: initial ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await res.json().catch(() => ({}))) as { application?: Application; error?: string };
      if (!res.ok || !data.application) throw new Error(data.error || t("errors.save"));
      onSaved(data.application);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("errors.generic"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Overlay onClose={onClose}>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-serif text-lg text-white">{initial ? t("form.editTitle") : t("add")}</h3>
        <button type="button" onClick={onClose} aria-label={t("close")} className="text-white/50 hover:text-cream"><X className="h-5 w-5" /></button>
      </div>
      <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
        <div className="grid grid-cols-2 gap-3">
          <div><Label>{t("form.company")}</Label><TextInput value={form.company} onChange={(e) => set("company", e.target.value)} placeholder={t("form.companyPh")} /></div>
          <div><Label>{t("form.role")}</Label><TextInput value={form.role} onChange={(e) => set("role", e.target.value)} placeholder={t("form.rolePh")} /></div>
          <div>
            <Label>{t("form.status")}</Label>
            <Select value={form.status} onChange={(e) => set("status", e.target.value as ApplicationStatus)}>
              {APPLICATION_STATUSES.map((s) => <option key={s} value={s}>{t(`statuses.${STATUS_KEY[s]}`)}</option>)}
            </Select>
          </div>
          <div><Label>{t("form.dateSubmitted")}</Label><TextInput type="date" value={appliedDateValue} onChange={(e) => set("appliedAt", e.target.value ? new Date(e.target.value + "T12:00:00").toISOString() : "")} /></div>
          <div><Label>{t("form.contactName")}</Label><TextInput value={form.contactName || ""} onChange={(e) => set("contactName", e.target.value)} placeholder={t("form.contactNamePh")} /></div>
          <div><Label>{t("form.contactEmail")}</Label><TextInput type="email" value={form.contactEmail || ""} onChange={(e) => set("contactEmail", e.target.value)} placeholder={t("form.contactEmailPh")} /></div>
          <div><Label>{t("form.salary")}</Label><TextInput value={form.salary || ""} onChange={(e) => set("salary", e.target.value)} placeholder={`${formatMoney(120000, locale, { compact: true })}–${formatMoney(150000, locale, { compact: true })}`} /></div>
          <div><Label>{t("form.location")}</Label><TextInput value={form.location || ""} onChange={(e) => set("location", e.target.value)} placeholder={t("form.locationPh")} /></div>
          <div>
            <Label>{t("form.resumeUsed")}</Label>
            <Select value={form.resumeId || ""} onChange={(e) => set("resumeId", e.target.value)}>
              <option value="">{t("form.none")}</option>
              {resumes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </Select>
          </div>
          <div><Label>{t("form.followUpDate")}</Label><TextInput type="date" value={form.followUpDate || ""} onChange={(e) => set("followUpDate", e.target.value)} /></div>
        </div>
        <div><Label>{t("form.url")}</Label><TextInput value={form.url || ""} onChange={(e) => set("url", e.target.value)} placeholder="https://…" /></div>
        <div><Label>{t("form.notes")}</Label><TextArea rows={3} value={form.notes || ""} onChange={(e) => set("notes", e.target.value)} placeholder={t("form.notesPh")} /></div>
        {form.url && <a href={form.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-violet hover:underline"><ExternalLink className="h-3 w-3" /> {t("form.openPosting")}</a>}
        {err && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{err}</p>}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <SecondaryButton onClick={onClose}>{t("cancel")}</SecondaryButton>
        <PrimaryButton onClick={save} loading={saving}>{initial ? t("form.save") : t("add")}</PrimaryButton>
      </div>
    </Overlay>
  );
}
