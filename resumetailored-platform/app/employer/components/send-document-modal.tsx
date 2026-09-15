"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, FileSignature } from "lucide-react";
import { Modal, Field, Input, Area, Picker, Btn } from "./ui";
import { DOC_TYPES, DOC_TYPE_LABELS, type DocType } from "@/lib/employer-ai";

/**
 * "Send document" modal — sends any document type for e-signature via DocuSign.
 * offer/agreement/nda are generated server-side from the fields below; custom is
 * an employer-uploaded PDF (uploaded first, then referenced by path). Reused from
 * the candidate drawer and the shortlist views.
 */
export function SendDocumentModal({
  applicantId,
  shortlistMemberId,
  candidateName,
  candidateEmail,
  defaultPosition,
  defaultDocType = "offer",
  onClose,
  onSent,
}: {
  applicantId?: number;
  shortlistMemberId?: number;
  candidateName: string;
  candidateEmail: string;
  defaultPosition?: string;
  defaultDocType?: DocType;
  onClose: () => void;
  onSent?: () => void;
}) {
  const [docType, setDocType] = useState<DocType>(defaultDocType);
  const [position, setPosition] = useState(defaultPosition || "");
  const [salary, setSalary] = useState("");
  const [startDate, setStartDate] = useState("");
  const [extraTerms, setExtraTerms] = useState("");
  const [message, setMessage] = useState("");
  const [documentName, setDocumentName] = useState("");
  const [documentPath, setDocumentPath] = useState("");
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConnected, setNotConnected] = useState(false);
  const [sent, setSent] = useState(false);

  const missingEmail = !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(candidateEmail || "");
  const showOfferFields = docType === "offer" || docType === "agreement";

  async function onPdf(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/employer/docusign/upload", { method: "POST", body: fd });
      const d = (await res.json().catch(() => ({}))) as { path?: string; name?: string; error?: string };
      if (!res.ok || !d.path) {
        setError(d.error || "Upload failed.");
      } else {
        setDocumentPath(d.path);
        if (!documentName) setDocumentName(d.name || "Document");
      }
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    setError(null);
    setNotConnected(false);
    if (showOfferFields && !position.trim()) {
      setError("Enter the position title.");
      return;
    }
    if (docType === "custom") {
      if (!documentName.trim()) {
        setError("Give the document a name.");
        return;
      }
      if (!documentPath) {
        setError("Upload a PDF to send.");
        return;
      }
    }
    setSending(true);
    try {
      const res = await fetch("/api/employer/docusign/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docType,
          documentName: documentName.trim(),
          documentPath: documentPath || undefined,
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
        setError(data.error || "Couldn't send the document.");
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
    <Modal title="Send document for signature" onClose={onClose}>
      {sent ? (
        <div className="flex flex-col items-center py-6 text-center">
          <CheckCircle2 className="mb-3 h-12 w-12 text-teal" />
          <h3 className="font-serif text-lg text-cream">Sent for signature</h3>
          <p className="mt-1.5 max-w-sm text-sm text-white/60">
            {candidateName || "The recipient"} will receive an email from DocuSign to review and sign. Track its status
            on the E-Signatures page.
          </p>
          <div className="mt-5 flex gap-2">
            <Link
              href="/employer/docusign"
              className="inline-flex items-center gap-2 rounded-lg border border-border-gold bg-white/[0.03] px-4 py-2 text-sm font-semibold text-cream hover:bg-white/[0.08]"
            >
              <FileSignature className="h-4 w-4 text-violet" /> View documents
            </Link>
            <Btn onClick={onClose}>Done</Btn>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border border-border-gold bg-white/[0.03] px-3 py-2.5 text-sm">
            <div className="text-cream">{candidateName || "Recipient"}</div>
            <div className={missingEmail ? "text-red-300" : "text-white/55"}>{candidateEmail || "No email on file"}</div>
          </div>

          {missingEmail && (
            <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              This recipient has no email address, so DocuSign can&apos;t reach them. Add their email first.
            </p>
          )}

          <Field label="Document type">
            <Picker value={docType} onChange={(e) => setDocType(e.target.value as DocType)}>
              {DOC_TYPES.map((t) => (
                <option key={t} value={t}>
                  {DOC_TYPE_LABELS[t]}
                </option>
              ))}
            </Picker>
          </Field>

          {docType === "custom" ? (
            <>
              <Field label="Document name">
                <Input value={documentName} onChange={(e) => setDocumentName(e.target.value)} placeholder="Insurance enrollment form" />
              </Field>
              <Field label="PDF to sign" hint="Any PDF · max 10MB — we auto-place a signature + date field.">
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  disabled={uploading}
                  onChange={(e) => onPdf(e.target.files?.[0])}
                  className="block w-full text-xs text-muted-cream file:mr-3 file:rounded-md file:border-0 file:bg-violet/20 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-violet hover:file:bg-violet/30"
                />
                <p className="mt-1 text-[11px] text-white/40">
                  {uploading ? "Uploading…" : documentPath ? "✓ PDF ready to send." : "No file chosen yet."}
                </p>
              </Field>
            </>
          ) : docType === "nda" ? (
            <p className="rounded-lg border border-border-gold bg-white/[0.03] px-3 py-2.5 text-xs text-white/55">
              A standard mutual non-disclosure agreement will be generated and sent for signature.
            </p>
          ) : (
            <>
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
              <Field label="Additional terms" hint="Bonus, equity, benefits, conditions — appears in the document.">
                <Area rows={3} value={extraTerms} onChange={(e) => setExtraTerms(e.target.value)} placeholder="e.g. 15% annual bonus target, 20 days PTO, remote-friendly." />
              </Field>
            </>
          )}

          <Field label="Personal message" hint="A short note included in the email + document.">
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
            <Btn onClick={submit} loading={sending} disabled={missingEmail || uploading}>
              <FileSignature className="h-4 w-4" /> Send for signature
            </Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}
