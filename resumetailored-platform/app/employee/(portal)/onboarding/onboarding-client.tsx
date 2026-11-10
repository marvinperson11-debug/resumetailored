"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ClipboardCheck, CalendarClock, ExternalLink, Upload, CheckCircle2 } from "lucide-react";
import { checklistProgress, isLegalChecklistLabel, type EmployeeChecklistWithItems } from "@/lib/checklist-hub";

const inputCls = "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-cream focus:border-violet focus:outline-none";
const selectCls = inputCls + " [&>option]:bg-navy";
const primaryBtn = "inline-flex items-center gap-2 rounded-lg bg-violet px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet/90 disabled:opacity-50";

interface PaperworkStatusLite {
  status: "not_started" | "submitted" | "verified";
  last4?: string | null;
}
interface OnboardingData {
  plan: { startDateDisplay: string; firstWeekSchedule: { label: string; dateDisplay: string }[]; paperwork: { item: string; dueDateDisplay: string }[] } | null;
  paperwork: { w4: PaperworkStatusLite; i9: PaperworkStatusLite; direct_deposit: PaperworkStatusLite };
  handbook: { docId: number; title: string; status: string } | null;
  whiteLabel: boolean;
}

export function OnboardingClient() {
  const t = useTranslations("employeeOnboarding");
  const tc = useTranslations("employeeCommon");
  const [data, setData] = useState<OnboardingData | null>(null);
  const [checklist, setChecklist] = useState<EmployeeChecklistWithItems | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [onboarding, checklistRes] = await Promise.all([
      fetch("/api/employee/onboarding").then((r) => r.json()).catch(() => ({})),
      fetch("/api/employee/checklist").then((r) => r.json()).catch(() => ({})),
    ]);
    setData(onboarding as OnboardingData);
    setChecklist((checklistRes.checklist as EmployeeChecklistWithItems) || null);
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function toggleItem(itemId: number, done: boolean) {
    await fetch(`/api/employee/checklist/${itemId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ done }) });
    load();
  }

  if (loading || !data) return <p className="text-sm text-white/50">{tc("loading")}</p>;

  const pct = checklist ? checklistProgress(checklist.items) : 0;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <h1 className="font-serif text-3xl font-medium text-cream">{t("title")}</h1>
        {data.plan?.startDateDisplay && <p className="mt-1 text-sm text-white/60">{t("startDate", { date: data.plan.startDateDisplay })}</p>}
      </header>

      {checklist && (
        <section className="glass px-5 py-5">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-white/70">
              <ClipboardCheck className="h-4 w-4 text-violet" /> {checklist.name}
            </div>
            <span className="text-xs text-white/40">{t("percentComplete", { percent: pct })}</span>
          </div>
          <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-violet transition-all" style={{ width: `${pct}%` }} />
          </div>
          <ul className="space-y-1.5">
            {checklist.items.map((it) => {
              const legal = isLegalChecklistLabel(it.label);
              return (
                <li key={it.id} className="flex items-center gap-2 text-sm">
                  <button
                    type="button"
                    disabled={legal}
                    onClick={() => toggleItem(it.id, !it.done)}
                    className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border ${it.done ? "border-violet bg-violet" : "border-white/25"} ${legal ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                  >
                    {it.done && <span className="h-1.5 w-1.5 rounded-sm bg-white" />}
                  </button>
                  <span className={it.done ? "text-white/40 line-through" : "text-white/80"}>{it.label}</span>
                  {legal && <span className="text-xs text-white/35">{t("employerConfirms")}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {data.plan && (
        <section className="glass px-5 py-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white/70">
            <CalendarClock className="h-4 w-4 text-violet" /> {t("firstWeekSchedule")}
          </div>
          <ul className="space-y-1.5 text-sm">
            {data.plan.firstWeekSchedule.map((s, i) => (
              <li key={i} className="flex justify-between gap-3 text-white/75">
                <span>{s.label}</span>
                <span className="text-white/45">{s.dateDisplay}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-4">
        <h2 className="text-sm font-medium text-white/70">{t("paperworkPacket")}</h2>

        <W4Card status={data.paperwork.w4.status} onSaved={load} t={t} tc={tc} />
        <I9Card status={data.paperwork.i9.status} onSaved={load} t={t} tc={tc} />
        <DirectDepositCard status={data.paperwork.direct_deposit.status} last4={data.paperwork.direct_deposit.last4} onSaved={load} t={t} tc={tc} />

        {data.handbook && (
          <div className="glass flex items-center justify-between gap-3 px-5 py-4">
            <div>
              <div className="text-sm font-medium text-cream">{data.handbook.title}</div>
              <div className="mt-0.5 text-xs text-white/45">{data.handbook.status === "signed" ? t("handbookSigned") : t("handbookNotSigned")}</div>
            </div>
            <Link href={`/employee/training?open=${data.handbook.docId}`} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-sm text-white/70 transition hover:bg-white/5">
              {data.handbook.status === "signed" ? t("handbookView") : t("handbookReadAndSign")} <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
        <p className="text-xs text-white/40">{t("paperworkHonestyNote")}</p>
      </section>

      {!data.whiteLabel && (
        <p className="text-center text-xs text-white/35">
          {t("poweredBy")}{" "}
          <a href="https://resumetailored.com" className="text-white/50 hover:underline">
            ResumeTailored
          </a>
        </p>
      )}
    </div>
  );
}

type TFn = ReturnType<typeof useTranslations>;

function StatusPill({ status, t }: { status: string; t: TFn }) {
  const tone = status === "verified" ? "bg-teal/20 text-teal" : status === "submitted" ? "bg-gold/20 text-gold" : "bg-white/10 text-white/60";
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${tone}`}>{t(`paperworkStatus.${status}` as "paperworkStatus.not_started")}</span>;
}

function W4Card({ status, onSaved, t, tc }: { status: string; onSaved: () => void; t: TFn; tc: TFn }) {
  const [open, setOpen] = useState(false);
  const [filingStatus, setFilingStatus] = useState("single");
  const [multipleJobs, setMultipleJobs] = useState(false);
  const [signatureName, setSignatureName] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!signatureName.trim()) {
      setErr(t("signatureRequired"));
      return;
    }
    setSaving(true);
    setErr("");
    const res = await fetch("/api/employee/onboarding/w4", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filingStatus, multipleJobsOrSpouseWorks: multipleJobs, claimDependentsCents: 0, otherIncomeCents: 0, deductionsCents: 0, extraWithholdingCents: 0, signatureName }),
    });
    setSaving(false);
    if (!res.ok) {
      setErr((await res.json().catch(() => ({}))).error || t("errorGeneric"));
      return;
    }
    setOpen(false);
    onSaved();
  }

  return (
    <div className="glass px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-cream">{t("paperworkW4")}</div>
        <div className="flex items-center gap-2">
          <StatusPill status={status} t={t} />
          {status === "not_started" && !open && (
            <button onClick={() => setOpen(true)} className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-white/70 hover:bg-white/5">
              {t("fillOut")}
            </button>
          )}
        </div>
      </div>
      {status === "not_started" && open && (
        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs text-white/50">{t("w4FilingStatus")}</label>
            <select className={selectCls} value={filingStatus} onChange={(e) => setFilingStatus(e.target.value)}>
              <option value="single">{t("w4Single")}</option>
              <option value="married_jointly">{t("w4MarriedJointly")}</option>
              <option value="head_of_household">{t("w4HeadOfHousehold")}</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-white/70">
            <input type="checkbox" checked={multipleJobs} onChange={(e) => setMultipleJobs(e.target.checked)} />
            {t("w4MultipleJobs")}
          </label>
          <div>
            <label className="mb-1 block text-xs text-white/50">{t("signature")}</label>
            <input className={inputCls} value={signatureName} onChange={(e) => setSignatureName(e.target.value)} placeholder={t("signaturePlaceholder")} />
          </div>
          {err && <p className="text-sm text-red-300">{err}</p>}
          <div className="flex gap-2">
            <button onClick={submit} disabled={saving} className={primaryBtn}>
              {saving ? t("saving") : t("submit")}
            </button>
            <button onClick={() => setOpen(false)} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/70 hover:bg-white/5">
              {tc("cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function I9Card({ status, onSaved, t, tc }: { status: string; onSaved: () => void; t: TFn; tc: TFn }) {
  const [open, setOpen] = useState(false);
  const [citizenshipStatus, setCitizenshipStatus] = useState("citizen");
  const [fullLegalName, setFullLegalName] = useState("");
  const [signatureName, setSignatureName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!fullLegalName.trim() || !signatureName.trim() || !file) {
      setErr(t("i9MissingFields"));
      return;
    }
    setSaving(true);
    setErr("");
    try {
      const form = new FormData();
      form.set("file", file);
      const uploadRes = await fetch("/api/employee/onboarding/id-upload", { method: "POST", body: form });
      const uploadData = (await uploadRes.json().catch(() => ({}))) as { path?: string; error?: string };
      if (!uploadRes.ok || !uploadData.path) throw new Error(uploadData.error || t("errorGeneric"));

      const res = await fetch("/api/employee/onboarding/i9", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ citizenshipStatus, fullLegalName, signatureName, idDocPath: uploadData.path }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || t("errorGeneric"));
      setOpen(false);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("errorGeneric"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="glass px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-cream">{t("paperworkI9")}</div>
          <div className="mt-0.5 text-xs text-white/45">{t("i9Disclaimer")}</div>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill status={status} t={t} />
          {status === "not_started" && !open && (
            <button onClick={() => setOpen(true)} className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-white/70 hover:bg-white/5">
              {t("fillOut")}
            </button>
          )}
        </div>
      </div>
      {status === "not_started" && open && (
        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs text-white/50">{t("i9CitizenshipStatus")}</label>
            <select className={selectCls} value={citizenshipStatus} onChange={(e) => setCitizenshipStatus(e.target.value)}>
              <option value="citizen">{t("i9Citizen")}</option>
              <option value="noncitizen_national">{t("i9NoncitizenNational")}</option>
              <option value="lawful_permanent_resident">{t("i9LawfulPermanentResident")}</option>
              <option value="authorized_alien">{t("i9AuthorizedAlien")}</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-white/50">{t("i9FullLegalName")}</label>
            <input className={inputCls} value={fullLegalName} onChange={(e) => setFullLegalName(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-white/50">{t("i9UploadId")}</label>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-white/20 px-3 py-2 text-sm text-white/60 hover:bg-white/5">
              <Upload className="h-4 w-4" />
              {file ? file.name : t("i9ChooseFile")}
              <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </label>
          </div>
          <div>
            <label className="mb-1 block text-xs text-white/50">{t("signature")}</label>
            <input className={inputCls} value={signatureName} onChange={(e) => setSignatureName(e.target.value)} placeholder={t("signaturePlaceholder")} />
          </div>
          {err && <p className="text-sm text-red-300">{err}</p>}
          <div className="flex gap-2">
            <button onClick={submit} disabled={saving} className={primaryBtn}>
              {saving ? t("saving") : t("submit")}
            </button>
            <button onClick={() => setOpen(false)} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/70 hover:bg-white/5">
              {tc("cancel")}
            </button>
          </div>
        </div>
      )}
      {status === "submitted" && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-gold">
          <CheckCircle2 className="h-3.5 w-3.5" /> {t("i9AwaitingVerification")}
        </p>
      )}
    </div>
  );
}

function DirectDepositCard({ status, last4, onSaved, t, tc }: { status: string; last4?: string | null; onSaved: () => void; t: TFn; tc: TFn }) {
  const [open, setOpen] = useState(false);
  const [bankName, setBankName] = useState("");
  const [accountType, setAccountType] = useState("checking");
  const [routingNumber, setRoutingNumber] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [signatureName, setSignatureName] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    setSaving(true);
    setErr("");
    const res = await fetch("/api/employee/onboarding/direct-deposit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bankName, accountType, routingNumber, accountNumber, signatureName }),
    });
    setSaving(false);
    if (!res.ok) {
      setErr((await res.json().catch(() => ({}))).error || t("errorGeneric"));
      return;
    }
    setOpen(false);
    onSaved();
  }

  return (
    <div className="glass px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-cream">{t("paperworkDirectDeposit")}</div>
          {last4 && <div className="mt-0.5 text-xs text-white/45">{t("accountEndingIn", { last4 })}</div>}
        </div>
        <div className="flex items-center gap-2">
          <StatusPill status={status} t={t} />
          {status === "not_started" && !open && (
            <button onClick={() => setOpen(true)} className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-white/70 hover:bg-white/5">
              {t("fillOut")}
            </button>
          )}
        </div>
      </div>
      {status === "not_started" && open && (
        <div className="mt-4 space-y-3">
          <input className={inputCls} value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder={t("ddBankName")} />
          <select className={selectCls} value={accountType} onChange={(e) => setAccountType(e.target.value)}>
            <option value="checking">{t("ddChecking")}</option>
            <option value="savings">{t("ddSavings")}</option>
          </select>
          <input className={inputCls} value={routingNumber} onChange={(e) => setRoutingNumber(e.target.value)} placeholder={t("ddRoutingNumber")} inputMode="numeric" />
          <input className={inputCls} value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder={t("ddAccountNumber")} inputMode="numeric" />
          <input className={inputCls} value={signatureName} onChange={(e) => setSignatureName(e.target.value)} placeholder={t("signaturePlaceholder")} />
          {err && <p className="text-sm text-red-300">{err}</p>}
          <div className="flex gap-2">
            <button onClick={submit} disabled={saving} className={primaryBtn}>
              {saving ? t("saving") : t("submit")}
            </button>
            <button onClick={() => setOpen(false)} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/70 hover:bg-white/5">
              {tc("cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
