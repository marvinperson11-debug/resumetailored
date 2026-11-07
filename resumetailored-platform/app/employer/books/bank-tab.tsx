"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Landmark, Loader2, Unlink, Check, X, FilePlus2 } from "lucide-react";
import { Panel, Btn, TierUpgradeNote, EmptyState } from "../components/ui";
import { formatMoney } from "@/lib/books-hub";

const PLAID_LINK_SRC = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

declare global {
  interface Window {
    Plaid?: {
      create: (opts: {
        token: string;
        onSuccess: (publicToken: string) => void;
        onExit?: () => void;
      }) => { open: () => void };
    };
  }
}

function loadPlaidScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.Plaid) return resolve();
    const existing = document.querySelector(`script[src="${PLAID_LINK_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      return;
    }
    const script = document.createElement("script");
    script.src = PLAID_LINK_SRC;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("load failed"));
    document.body.appendChild(script);
  });
}

interface BankAccount {
  id: string;
  institutionName: string | null;
  accountName: string | null;
  accountMask: string | null;
  status: "active" | "error" | "disconnected";
}

interface Candidate {
  id: string;
  entryDate: string;
  description: string;
  amountCents: number;
}

interface BankTxn {
  id: string;
  txnDate: string;
  amountCents: number;
  name: string;
  merchantName: string | null;
  candidates: Candidate[];
}

/** Bank Feeds — Plaid, full-Books (Corporate) only. Scale sees this as a
 *  locked "taste" (TierUpgradeNote); Portal doesn't see the tab's content at
 *  all beyond the same note (the spec's "basic Books" never mentions bank
 *  feeds). No `plaid`/`react-plaid-link` npm dependency is installed in
 *  this environment, so Plaid Link loads from Plaid's own CDN script at
 *  runtime instead — see `loadPlaidScript` above. */
export function BankTab({ locked, canFull }: { locked: boolean; canFull: boolean }) {
  const t = useTranslations("employerBooks.bank");
  const [status, setStatus] = useState<{ allowed: boolean; configured: boolean } | null>(null);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [transactions, setTransactions] = useState<BankTxn[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (locked || !canFull) return;
    const [statusRes, accountsRes, txnsRes] = await Promise.all([
      fetch("/api/employer/books/bank/status", { cache: "no-store" }),
      fetch("/api/employer/books/bank/accounts", { cache: "no-store" }),
      fetch("/api/employer/books/bank/transactions", { cache: "no-store" }),
    ]);
    setStatus(await statusRes.json().catch(() => null));
    const accountsData = (await accountsRes.json().catch(() => ({}))) as { accounts?: BankAccount[] };
    setAccounts(accountsData.accounts || []);
    const txnsData = (await txnsRes.json().catch(() => ({}))) as { transactions?: BankTxn[] };
    setTransactions(txnsData.transactions || []);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, canFull]);

  async function connect() {
    setConnecting(true);
    setError(null);
    try {
      const res = await fetch("/api/employer/books/bank/connect", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t("errorGeneric"));
      await loadPlaidScript();
      if (!window.Plaid) throw new Error(t("errorGeneric"));
      window.Plaid.create({
        token: data.linkToken,
        onSuccess: async (publicToken: string) => {
          await fetch("/api/employer/books/bank/exchange", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ publicToken }) });
          load();
        },
      }).open();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errorGeneric"));
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect(id: string) {
    await fetch(`/api/employer/books/bank/accounts?id=${id}`, { method: "DELETE" });
    load();
  }

  async function act(txnId: string, body: Record<string, unknown>) {
    await fetch(`/api/employer/books/bank/transactions/${txnId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    load();
  }

  if (locked || !canFull) {
    return <TierUpgradeNote feature={t("title")} tier="Corporate" />;
  }
  if (!status) {
    return (
      <div className="flex items-center gap-2 text-sm text-white/50">
        <Loader2 className="h-4 w-4 animate-spin" /> {t("loading")}
      </div>
    );
  }
  if (!status.configured) {
    return <EmptyState icon={Landmark} title={t("notConfiguredTitle")} body={t("notConfiguredBody")} />;
  }

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

      <Panel>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-serif text-lg font-medium text-cream">{t("accountsTitle")}</h3>
          <Btn onClick={connect} loading={connecting}>
            <Landmark className="h-4 w-4" /> {t("connectButton")}
          </Btn>
        </div>
        {accounts.length === 0 ? (
          <p className="text-sm text-white/50">{t("noAccounts")}</p>
        ) : (
          <div className="space-y-2">
            {accounts.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-lg border border-border-gold bg-white/[0.03] px-3 py-2 text-sm">
                <span className="text-cream">
                  {a.institutionName || t("unknownInstitution")} — {a.accountName || ""} {a.accountMask ? `••${a.accountMask}` : ""}
                </span>
                {a.status === "active" && (
                  <button type="button" onClick={() => disconnect(a.id)} title={t("disconnect")} className="text-white/40 hover:text-red-300">
                    <Unlink className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel>
        <h3 className="mb-3 font-serif text-lg font-medium text-cream">{t("unmatchedTitle")}</h3>
        {transactions.length === 0 ? (
          <p className="text-sm text-white/50">{t("noTransactions")}</p>
        ) : (
          <div className="space-y-3">
            {transactions.map((txn) => (
              <div key={txn.id} className="rounded-lg border border-border-gold bg-white/[0.03] p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-cream">
                    {txn.txnDate} — {txn.merchantName || txn.name}
                  </span>
                  <span className="font-medium text-cream">{formatMoney(Math.abs(txn.amountCents))}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => act(txn.id, { action: "create-entry" })}
                    className="inline-flex items-center gap-1 rounded-md border border-border-gold bg-white/[0.04] px-2.5 py-1 text-xs text-cream hover:bg-white/[0.08]"
                  >
                    <FilePlus2 className="h-3.5 w-3.5" /> {t("addAsEntry")}
                  </button>
                  {txn.candidates.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => act(txn.id, { action: "match", entryId: c.id })}
                      className="inline-flex items-center gap-1 rounded-md border border-border-gold bg-white/[0.04] px-2.5 py-1 text-xs text-cream hover:bg-white/[0.08]"
                    >
                      <Check className="h-3.5 w-3.5" /> {t("matchTo", { description: c.description || c.entryDate })}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => act(txn.id, { action: "ignore" })}
                    className="inline-flex items-center gap-1 rounded-md border border-border-gold bg-white/[0.04] px-2.5 py-1 text-xs text-white/60 hover:bg-white/[0.08]"
                  >
                    <X className="h-3.5 w-3.5" /> {t("ignore")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
