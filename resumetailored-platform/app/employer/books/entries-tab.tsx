"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Upload, Download, Loader2, Trash2, Paperclip } from "lucide-react";
import { Panel, Btn, Field, Input, Area, Picker, Badge, EmptyState, Modal } from "../components/ui";
import { BOOKS_CATEGORIES, formatMoney, type BooksEntryType } from "@/lib/books-hub";

interface Entry {
  id: string;
  type: BooksEntryType;
  entryDate: string;
  amountCents: number;
  description: string;
  category: string;
  jobId: number | null;
  receiptPath: string | null;
}

export function EntriesTab({ locked, canFull, canManage }: { locked: boolean; canFull: boolean; canManage: boolean }) {
  const t = useTranslations("employerBooks.entries");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);

  async function load() {
    if (locked) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const res = await fetch("/api/employer/books/entries", { cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as { entries?: Entry[] };
    setEntries(data.entries || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked]);

  async function remove(id: string) {
    await fetch(`/api/employer/books/entries/${id}`, { method: "DELETE" });
    load();
  }

  if (locked) {
    return <EmptyState icon={Plus} title={t("lockedTitle")} body={t("lockedBody")} />;
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {canManage && (
          <Btn onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> {t("addButton")}
          </Btn>
        )}
        {canManage && (
          <Btn variant="ghost" onClick={() => setImporting(true)}>
            <Upload className="h-4 w-4" /> {t("importButton")}
          </Btn>
        )}
        <a href="/api/employer/books/entries/import-template" className="inline-flex items-center gap-2 rounded-lg border border-border-gold bg-white/[0.03] px-4 py-2 text-sm text-cream hover:bg-white/[0.08]">
          <Download className="h-4 w-4" /> {t("downloadTemplate")}
        </a>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("loading")}
        </div>
      ) : entries.length === 0 ? (
        <EmptyState icon={Plus} title={t("emptyTitle")} body={t("emptyBody")} />
      ) : (
        <Panel className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-gold text-left text-xs uppercase tracking-wide text-white/50">
                <th className="px-4 py-3">{t("colDate")}</th>
                <th className="px-4 py-3">{t("colType")}</th>
                <th className="px-4 py-3">{t("colCategory")}</th>
                <th className="px-4 py-3">{t("colDescription")}</th>
                <th className="px-4 py-3 text-right">{t("colAmount")}</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-border-gold/50">
                  <td className="px-4 py-2.5 text-white/70">{e.entryDate}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={e.type === "income" ? "teal" : "gold"}>{t(e.type === "income" ? "income" : "expense")}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-white/70">{e.category}</td>
                  <td className="px-4 py-2.5 text-cream">
                    {e.description}
                    {e.receiptPath && <Paperclip className="ml-1.5 inline h-3.5 w-3.5 text-white/40" />}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium text-cream">{formatMoney(e.amountCents)}</td>
                  <td className="px-4 py-2.5 text-right">
                    {canManage && (
                      <button type="button" onClick={() => remove(e.id)} aria-label={t("delete")} className="text-white/40 hover:text-red-300">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {adding && <AddEntryModal canFull={canFull} onClose={() => setAdding(false)} onSaved={load} />}
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={load} />}
    </div>
  );
}

function AddEntryModal({ canFull, onClose, onSaved }: { canFull: boolean; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations("employerBooks.entries");
  const [type, setType] = useState<BooksEntryType>("expense");
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [suggested, setSuggested] = useState<string | null>(null);
  const [jobId, setJobId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function suggest() {
    if (!description.trim()) return;
    const res = await fetch("/api/employer/books/entries/suggest-category", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description, type }) });
    const data = (await res.json().catch(() => ({}))) as { category?: string | null };
    setSuggested(data.category || null);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { type, entryDate, amount: Number(amount), description, category: category || suggested || "" };
      if (canFull && jobId) body.jobId = Number(jobId);
      const res = await fetch("/api/employer/books/entries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as { error?: string; entry?: { id: string } };
      if (!res.ok) throw new Error(data.error || t("errorGeneric"));
      if (file && data.entry) {
        const form = new FormData();
        form.append("file", file);
        await fetch(`/api/employer/books/entries/${data.entry.id}/receipt`, { method: "POST", body: form });
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errorGeneric"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={t("addButton")} onClose={onClose}>
      <div className="space-y-4">
        <Field label={t("formType")}>
          <Picker value={type} onChange={(e) => { setType(e.target.value as BooksEntryType); setCategory(""); setSuggested(null); }}>
            <option value="expense">{t("expense")}</option>
            <option value="income">{t("income")}</option>
          </Picker>
        </Field>
        <Field label={t("formDate")}>
          <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
        </Field>
        <Field label={t("formAmount")}>
          <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </Field>
        <Field label={t("formDescription")}>
          <Area value={description} onChange={(e) => setDescription(e.target.value)} onBlur={suggest} rows={2} placeholder={t("formDescriptionPlaceholder")} />
        </Field>
        <Field label={t("formCategory")} hint={suggested ? t("suggestedHint", { category: suggested }) : undefined}>
          <Picker value={category || suggested || ""} onChange={(e) => setCategory(e.target.value)}>
            <option value="">{t("formCategoryPlaceholder")}</option>
            {BOOKS_CATEGORIES[type].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Picker>
        </Field>
        {canFull && (
          <Field label={t("formJob")} hint={t("formJobHint")}>
            <Input value={jobId} onChange={(e) => setJobId(e.target.value)} placeholder={t("formJobPlaceholder")} />
          </Field>
        )}
        <Field label={t("formReceipt")}>
          <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-sm text-white/70" />
        </Field>
        {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
      </div>
      <div className="mt-5 flex justify-end gap-2 border-t border-border-gold pt-4">
        <Btn variant="ghost" onClick={onClose}>
          {t("cancel")}
        </Btn>
        <Btn onClick={save} loading={saving} disabled={!amount || !entryDate}>
          {t("save")}
        </Btn>
      </div>
    </Modal>
  );
}

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const t = useTranslations("employerBooks.entries");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ importedCount: number; skippedCount: number; skipped: { row: number; reason: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/employer/books/entries/import", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t("errorGeneric"));
      setResult(data);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errorGeneric"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={t("importButton")} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-white/60">{t("importHint")}</p>
        <input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-sm text-white/70" />
        {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
        {result && (
          <div className="rounded-lg border border-border-gold bg-white/[0.03] p-3 text-sm">
            <p className="text-cream">{t("importResult", { imported: result.importedCount, skipped: result.skippedCount })}</p>
            {result.skipped.length > 0 && (
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-white/50">
                {result.skipped.map((s, i) => (
                  <li key={i}>
                    {t("rowLabel", { row: s.row })}: {s.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      <div className="mt-5 flex justify-end gap-2 border-t border-border-gold pt-4">
        <Btn variant="ghost" onClick={onClose}>
          {result ? t("close") : t("cancel")}
        </Btn>
        {!result && (
          <Btn onClick={run} loading={busy} disabled={!file}>
            {t("importButton")}
          </Btn>
        )}
      </div>
    </Modal>
  );
}
