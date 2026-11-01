"use client";

import { useEffect, useState, useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Send, MessageCircle, X } from "lucide-react";
import { countSegments } from "@/lib/sms-phone";
import { formatDateTime } from "@/lib/format";
import { Modal, Btn, Badge, employerCheckoutHref } from "../components/ui";

interface ThreadMessage {
  id: string;
  direction: "outbound" | "inbound";
  body: string;
  status: string;
  queueReason?: string | null;
  createdAt: string;
}

/**
 * Candidate SMS thread (Portal+). Every send goes through an inline
 * confirm step (click "Send" -> the button becomes "Confirm send?" for a
 * few seconds, or Cancel) before the API is ever called with
 * `confirm: true` — the build's own guardrail that every candidate-facing
 * send needs an explicit UI confirmation.
 */
export function SmsThreadModal({ applicantId, applicantName, onClose }: { applicantId: number; applicantName: string; onClose: () => void }) {
  const t = useTranslations("employerSms");
  const locale = useLocale();
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [consented, setConsented] = useState(false);
  const [hasPhone, setHasPhone] = useState(false);
  const [body, setBody] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [planRequired, setPlanRequired] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/employer/sms/conversations/by-applicant/${applicantId}`, { cache: "no-store" });
      if (res.status === 402) {
        setPlanRequired(true);
        return;
      }
      const d = (await res.json().catch(() => ({}))) as { messages?: ThreadMessage[]; consented?: boolean; hasPhone?: boolean };
      setMessages(d.messages || []);
      setConsented(!!d.consented);
      setHasPhone(!!d.hasPhone);
    } finally {
      setLoading(false);
    }
  }, [applicantId]);

  useEffect(() => {
    load();
    fetch(`/api/employer/sms/applicants/${applicantId}/read`, { method: "POST" }).catch(() => {});
  }, [load, applicantId]);

  const seg = countSegments(body);
  const canCompose = consented && hasPhone;

  async function doSend() {
    setSending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/employer/sms/applicants/${applicantId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, confirm: true }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; queued?: boolean; queueReason?: string };
      if (!res.ok || !d.ok) throw new Error(d.error || t("errorSendFailed"));
      setBody("");
      if (d.queued) setNotice(d.queueReason === "cap" ? t("noticeQueuedCap") : t("noticeQueuedQuietHours"));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errorSendFailed"));
    } finally {
      setSending(false);
      setConfirming(false);
    }
  }

  if (planRequired) {
    return (
      <Modal title={t("threadTitle", { name: applicantName })} onClose={onClose}>
        <div className="space-y-3 text-sm text-white/70">
          <p>{t("planRequired")}</p>
          <Btn onClick={() => { window.location.href = employerCheckoutHref("portal"); }}>{t("upgrade")}</Btn>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={t("threadTitle", { name: applicantName })} onClose={onClose}>
      <div className="flex max-h-[60vh] flex-col gap-3">
        {!canCompose && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            {!hasPhone ? t("explainerNoPhone") : t("explainerNoConsent")}
          </div>
        )}
        <div className="flex-1 space-y-2 overflow-y-auto rounded-lg border border-border-gold bg-white/[0.02] p-3">
          {loading ? (
            <p className="text-sm text-white/50">{t("loading")}</p>
          ) : messages.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-white/40">
              <MessageCircle className="h-4 w-4" /> {t("noMessages")}
            </p>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${m.direction === "outbound" ? "ml-auto bg-violet/20 text-cream" : "bg-white/[0.06] text-cream"}`}>
                <div className="whitespace-pre-wrap">{m.body}</div>
                <div className="mt-1 flex items-center gap-1.5 text-[10px] text-white/40">
                  <span>{formatDateTime(m.createdAt, locale)}</span>
                  {m.direction === "outbound" && <Badge tone={m.status === "failed" ? "red" : m.status === "queued" ? "gold" : "neutral"}>{t(`status.${m.status}`)}</Badge>}
                </div>
              </div>
            ))
          )}
        </div>

        {notice && <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">{notice}</p>}
        {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

        <div className="space-y-1.5">
          <textarea
            rows={3}
            disabled={!canCompose || sending}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setConfirming(false);
            }}
            placeholder={canCompose ? t("composePlaceholder") : ""}
            className="w-full rounded-lg border border-border-gold bg-white/5 px-3 py-2 text-sm text-cream placeholder:text-white/35 outline-none focus:border-violet focus:ring-1 focus:ring-violet disabled:opacity-50"
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-white/40">{t("segmentCount", { count: seg.segments, encoding: seg.encoding })}</span>
            {!confirming ? (
              <Btn disabled={!canCompose || !body.trim() || sending} onClick={() => setConfirming(true)}>
                <Send className="h-4 w-4" /> {t("send")}
              </Btn>
            ) : (
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setConfirming(false)} className="inline-flex items-center gap-1 rounded-lg border border-border-gold px-3 py-2 text-sm text-muted-cream hover:bg-white/5">
                  <X className="h-3.5 w-3.5" /> {t("cancel")}
                </button>
                <Btn onClick={doSend} loading={sending}>
                  {t("confirmSend")}
                </Btn>
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
