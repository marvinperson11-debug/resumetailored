"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Sparkles, Loader2 } from "lucide-react";
import { Panel, Btn } from "../components/ui";

const INTENTS = ["spend_this_month", "unpaid_invoices", "monthly_summary"] as const;

/**
 * "Ask Taylor" — the spec's three read-only Books questions. A deterministic
 * lookup (lib/books-hub.ts `answerTaylorBooksQuestion`), not a chat turn
 * through the Employer Portal Assistant's own hiring-only tool-use loop —
 * see that function's header comment for why. Every ask is logged to the
 * existing assistant audit log server-side (the API route), so this still
 * honors the spec's "anything Taylor does is written to the audit log"
 * guardrail even though it never mutates anything.
 */
export function TaylorBooksWidget() {
  const t = useTranslations("employerBooks.taylor");
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function ask(intent: (typeof INTENTS)[number]) {
    setBusy(intent);
    setAnswer(null);
    try {
      const res = await fetch("/api/employer/books/taylor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intent }) });
      const data = await res.json().catch(() => ({}));
      setAnswer(res.ok ? data.answer : data.error || t("errorGeneric"));
    } catch {
      setAnswer(t("errorGeneric"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel className="mb-6">
      <div className="mb-2 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-violet" />
        <h3 className="font-serif text-base font-medium text-cream">{t("title")}</h3>
      </div>
      <div className="flex flex-wrap gap-2">
        {INTENTS.map((intent) => (
          <Btn key={intent} variant="ghost" onClick={() => ask(intent)} disabled={busy !== null}>
            {busy === intent && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t(`questions.${intent}`)}
          </Btn>
        ))}
      </div>
      {answer && <p className="mt-3 whitespace-pre-line rounded-lg border border-border-gold bg-white/[0.03] p-3 text-sm text-cream">{answer}</p>}
    </Panel>
  );
}
