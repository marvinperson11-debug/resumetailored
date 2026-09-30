"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Send } from "lucide-react";
import { Btn } from "./ui";

/**
 * "Send a copy" (forward) control — emails the combined signed PDF + certificate
 * to any name/email (plain email, no DocuSign step). Used in the E-Signatures
 * envelope detail and in the Documents view rows.
 */
export function SendCopyControl({ envelopeId, onSent }: { envelopeId: number; onSent?: () => void }) {
  const t = useTranslations("employerSendCopy");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  async function send() {
    if (!email.trim()) return;
    setSending(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/employer/docusign/envelopes/${envelopeId}/send-copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setMsg({ tone: "err", text: d.error || t("couldntSend") });
        return;
      }
      setMsg({ tone: "ok", text: t("sent", { email: email.trim() }) });
      setName("");
      setEmail("");
      setOpen(false);
      onSent?.();
    } finally {
      setSending(false);
    }
  }

  if (!open) {
    return (
      <span className="inline-flex flex-col items-start gap-0.5">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet hover:underline"
        >
          <Send className="h-3.5 w-3.5" /> {t("sendCopy")}
        </button>
        {msg && <span className={`text-[11px] ${msg.tone === "ok" ? "text-teal" : "text-red-300"}`}>{msg.text}</span>}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t("namePlaceholder")}
        className="w-28 rounded-lg border border-border-gold bg-white/5 px-2 py-1.5 text-xs text-cream placeholder:text-white/35 outline-none focus:border-violet"
      />
      <input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t("emailPlaceholder")}
        className="w-48 rounded-lg border border-border-gold bg-white/5 px-2 py-1.5 text-xs text-cream placeholder:text-white/35 outline-none focus:border-violet"
      />
      <Btn variant="ghost" onClick={() => void send()} loading={sending} disabled={!email.trim()}>
        <Send className="h-4 w-4" /> {t("send")}
      </Btn>
      <button type="button" onClick={() => { setOpen(false); setMsg(null); }} className="text-xs text-muted-cream hover:text-cream">
        {t("cancel")}
      </button>
      {msg?.tone === "err" && <span className="text-[11px] text-red-300">{msg.text}</span>}
    </span>
  );
}
