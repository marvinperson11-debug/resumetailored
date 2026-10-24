"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Ban, AlertTriangle } from "lucide-react";
import { Btn, Field, Area, Modal } from "./ui";

/**
 * Void an envelope still awaiting signature (Fix Round 7) — only ever offered
 * for status 'sent' (the server enforces the same rule; a completed envelope
 * is immutable history and this control is simply never rendered for one).
 * DocuSign sends its own standard void notice to the signer.
 */
export function VoidEnvelopeControl({ envelopeId, onVoided }: { envelopeId: number; onVoided?: () => void }) {
  const t = useTranslations("employerEsign");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [voiding, setVoiding] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function confirmVoid() {
    setVoiding(true);
    setErr(null);
    try {
      const res = await fetch(`/api/employer/docusign/envelopes/${envelopeId}/void`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        setErr(d.message || d.error || t("voidModal.failed"));
        return;
      }
      setOpen(false);
      setReason("");
      onVoided?.();
    } finally {
      setVoiding(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-300 hover:underline"
      >
        <Ban className="h-3.5 w-3.5" /> {t("void")}
      </button>

      {open && (
        <Modal title={t("voidModal.title")} onClose={() => setOpen(false)}>
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{t("voidModal.irreversible")}</span>
            </div>
            <Field label={t("voidModal.reasonLabel")}>
              <Area
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("voidModal.reasonPlaceholder")}
                rows={3}
              />
            </Field>
            {err && <p className="text-xs text-red-300">{err}</p>}
            <div className="flex justify-end gap-2">
              <Btn variant="ghost" onClick={() => setOpen(false)} disabled={voiding}>
                {t("voidModal.cancel")}
              </Btn>
              <Btn variant="danger" onClick={() => void confirmVoid()} loading={voiding}>
                <Ban className="h-4 w-4" /> {t("voidModal.confirm")}
              </Btn>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
