"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, FileSignature } from "lucide-react";
import { Modal, Field, Input, Area, Btn } from "./ui";

/**
 * "Send offer" modal — collects the offer terms and posts to
 * /api/employer/docusign/send, which builds the offer letter and dispatches a
 * DocuSign envelope for the candidate to sign. Reused from the candidate drawer
 * and the shortlist views.
 */
export function SendOfferModal({
  applicantId,
  shortlistMemberId,
  candidateName,
  candidateEmail,
  defaultPosition,
  onClose,
  onSent,
}: {
  applicantId?: number;
  shortlistMemberId?: number;
  candidateName: string;
  candidateEmail: string;
  defaultPosition?: string;
  onClose: () => void;
  onSent?: () => void;
}) {
  const [position, setPosition] = useState(defaultPosition || "");
  const [salary, setSalary] = useState("");
  const [startDate, setStartDate] = useState("");
  const [extraTerms, setExtraTerms] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConnected, setNotConnected] = useState(false);
  const [sent, setSent] = useState(false);

  const missingEmail = !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(candidateEmail || "");

  async function submit() {
    setError(null);
    setNotConnected(false);
    if (!position.trim()) {
      setError("Enter the position title.");
      return;
    }
    setSending(true);
    try {
      const res = await fetch("/api/employer/docusign/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicantId,
          shortlistMemberId,
          candidateName,
          candidateEmail,
          position: position.trim(),
          salary: salary.trim(),
          startDate: startDate.trim(),
          extraTerms: extraTerms.trim(),
          message: message.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      if (!res.ok) {
        if (data.code === "not_connected") setNotConnected(true);
        setError(data.error || "Couldn't send the offer.");
        return;
      }
      setSent(true);
      onSent?.();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal title="Send offer letter" onClose={onClose}>
      {sent ? (
        <div className="flex flex-col items-center py-6 text-center">
          <CheckCircle2 className="mb-3 h-12 w-12 text-teal" />
          <h3 className="font-serif text-lg text-cream">Offer sent</h3>
          <p className="mt-1.5 max-w-sm text-sm text-white/60">
            {candidateName || "The candidate"} will receive an email from DocuSign to review and sign the offer. Track
            its status on the Offer Letters page.
          </p>
          <div className="mt-5 flex gap-2">
            <Link
              href="/employer/docusign"
              className="inline-flex items-center gap-2 rounded-lg border border-border-gold bg-white/[0.03] px-4 py-2 text-sm font-semibold text-cream hover:bg-white/[0.08]"
            >
              <FileSignature className="h-4 w-4 text-violet" /> View offers
            </Link>
            <Btn onClick={onClose}>Done</Btn>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border border-border-gold bg-white/[0.03] px-3 py-2.5 text-sm">
            <div className="text-cream">{candidateName || "Candidate"}</div>
            <div className={missingEmail ? "text-red-300" : "text-white/55"}>
              {candidateEmail || "No email on file"}
            </div>
          </div>

          {missingEmail && (
            <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              This candidate has no email address, so DocuSign can&apos;t reach them. Add their email first.
            </p>
          )}

          <Field label="Position">
            <Input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="Senior Product Designer" />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Annual salary">
              <Input value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="$140,000" />
            </Field>
            <Field label="Start date">
              <Input value={startDate} onChange={(e) => setStartDate(e.target.value)} placeholder="March 3, 2026" />
            </Field>
          </div>
          <Field label="Additional terms" hint="Bonus, equity, benefits, conditions — appears in the letter.">
            <Area rows={3} value={extraTerms} onChange={(e) => setExtraTerms(e.target.value)} placeholder="e.g. 15% annual bonus target, 20 days PTO, remote-friendly." />
          </Field>
          <Field label="Personal message" hint="A short note included in the offer email + letter.">
            <Area rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="We're thrilled to have you join the team!" />
          </Field>

          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
              {notConnected && (
                <>
                  {" "}
                  <Link href="/employer/docusign" className="font-semibold text-violet underline">
                    Connect DocuSign
                  </Link>
                </>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-border-gold pt-4">
            <Btn variant="ghost" onClick={onClose}>
              Cancel
            </Btn>
            <Btn onClick={submit} loading={sending} disabled={missingEmail}>
              <FileSignature className="h-4 w-4" /> Send for signature
            </Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}
