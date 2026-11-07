"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Loader2, Send, CheckCircle2, BellRing } from "lucide-react";
import { Panel, Btn, Field, Input, Badge, EmptyState, Modal } from "../components/ui";
import { formatMoney, invoiceTotalCents, type InvoiceLineItem, type InvoiceStatus } from "@/lib/books-hub";

type Tone = "neutral" | "violet" | "teal" | "gold" | "red" | "sky";

interface Invoice {
  id: string;
  invoiceNumber: string;
  clientName: string;
  clientEmail: string | null;
  issueDate: string;
  dueDate: string;
  amountCents: number;
  status: InvoiceStatus;
}

const STATUS_TONE: Record<InvoiceStatus, Tone> = { draft: "neutral", sent: "sky", paid: "teal", overdue: "red", void: "neutral" };

export function InvoicesTab({ locked, canManage }: { locked: boolean; canManage: boolean }) {
  const t = useTranslations("employerBooks.invoices");
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (locked) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const res = await fetch("/api/employer/books/invoices", { cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as { invoices?: Invoice[] };
    setInvoices(data.invoices || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked]);

  async function act(id: string, action: "send" | "remind" | "paid") {
    setBusyId(id);
    setError(null);
    try {
      const res =
        action === "paid"
          ? await fetch(`/api/employer/books/invoices/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "paid" }) })
          : await fetch(`/api/employer/books/invoices/${id}/${action}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t("errorGeneric"));
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errorGeneric"));
    } finally {
      setBusyId(null);
    }
  }

  if (locked) {
    return <EmptyState icon={Plus} title={t("lockedTitle")} body={t("lockedBody")} />;
  }

  return (
    <div>
      {canManage && (
        <div className="mb-4">
          <Btn onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" /> {t("addButton")}
          </Btn>
        </div>
      )}
      {error && <p className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("loading")}
        </div>
      ) : invoices.length === 0 ? (
        <EmptyState icon={Plus} title={t("emptyTitle")} body={t("emptyBody")} />
      ) : (
        <Panel className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-gold text-left text-xs uppercase tracking-wide text-white/50">
                <th className="px-4 py-3">{t("colNumber")}</th>
                <th className="px-4 py-3">{t("colClient")}</th>
                <th className="px-4 py-3">{t("colDue")}</th>
                <th className="px-4 py-3 text-right">{t("colAmount")}</th>
                <th className="px-4 py-3">{t("colStatus")}</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id} className="border-b border-border-gold/50">
                  <td className="px-4 py-2.5 text-cream">{inv.invoiceNumber}</td>
                  <td className="px-4 py-2.5 text-white/70">{inv.clientName}</td>
                  <td className="px-4 py-2.5 text-white/70">{inv.dueDate}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-cream">{formatMoney(inv.amountCents)}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={STATUS_TONE[inv.status]}>{t(`status.${inv.status}`)}</Badge>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {canManage && (
                      <div className="flex justify-end gap-2">
                        {inv.status === "draft" && inv.clientEmail && (
                          <button type="button" disabled={busyId === inv.id} onClick={() => act(inv.id, "send")} title={t("send")} className="text-white/50 hover:text-violet disabled:opacity-40">
                            <Send className="h-4 w-4" />
                          </button>
                        )}
                        {(inv.status === "sent" || inv.status === "overdue") && (
                          <>
                            <button type="button" disabled={busyId === inv.id} onClick={() => act(inv.id, "remind")} title={t("remind")} className="text-white/50 hover:text-gold disabled:opacity-40">
                              <BellRing className="h-4 w-4" />
                            </button>
                            <button type="button" disabled={busyId === inv.id} onClick={() => act(inv.id, "paid")} title={t("markPaid")} className="text-white/50 hover:text-teal disabled:opacity-40">
                              <CheckCircle2 className="h-4 w-4" />
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {adding && <AddInvoiceModal onClose={() => setAdding(false)} onSaved={load} />}
    </div>
  );
}

function AddInvoiceModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const t = useTranslations("employerBooks.invoices");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10));
  const [items, setItems] = useState<InvoiceLineItem[]>([{ description: "", quantity: 1, unitPriceCents: 0 }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateItem(i: number, patch: Partial<InvoiceLineItem>) {
    setItems((prev) => prev.map((li, idx) => (idx === i ? { ...li, ...patch } : li)));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const lineItems = items.filter((li) => li.description.trim() && li.quantity > 0);
      const res = await fetch("/api/employer/books/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientName, clientEmail, issueDate, dueDate, lineItems }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t("errorGeneric"));
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errorGeneric"));
    } finally {
      setSaving(false);
    }
  }

  const total = invoiceTotalCents(items);

  return (
    <Modal title={t("addButton")} onClose={onClose} wide>
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
        <Field label={t("formClientName")}>
          <Input value={clientName} onChange={(e) => setClientName(e.target.value)} />
        </Field>
        <Field label={t("formClientEmail")} hint={t("formClientEmailHint")}>
          <Input type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("formIssueDate")}>
            <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </Field>
          <Field label={t("formDueDate")}>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
        <div>
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-cream">{t("formLineItems")}</span>
          <div className="space-y-2">
            {items.map((li, i) => (
              <div key={i} className="flex gap-2">
                <Input className="flex-1" placeholder={t("formItemDescription")} value={li.description} onChange={(e) => updateItem(i, { description: e.target.value })} />
                <Input className="w-20" type="number" min="1" value={li.quantity} onChange={(e) => updateItem(i, { quantity: Number(e.target.value) || 1 })} />
                <Input
                  className="w-28"
                  type="number"
                  min="0"
                  step="0.01"
                  value={li.unitPriceCents / 100}
                  onChange={(e) => updateItem(i, { unitPriceCents: Math.round(Number(e.target.value) * 100) || 0 })}
                />
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setItems((prev) => [...prev, { description: "", quantity: 1, unitPriceCents: 0 }])} className="mt-2 text-xs text-violet hover:underline">
            {t("addLineItem")}
          </button>
        </div>
        <p className="text-right text-sm font-semibold text-cream">{t("total")}: {formatMoney(total)}</p>
        {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
      </div>
      <div className="mt-5 flex justify-end gap-2 border-t border-border-gold pt-4">
        <Btn variant="ghost" onClick={onClose}>
          {t("cancel")}
        </Btn>
        <Btn onClick={save} loading={saving} disabled={!clientName.trim()}>
          {t("save")}
        </Btn>
      </div>
    </Modal>
  );
}
