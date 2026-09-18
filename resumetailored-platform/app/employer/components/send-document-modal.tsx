"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, FileSignature, Plus, X } from "lucide-react";
import { Modal, Field, Input, Area, Picker, Btn } from "./ui";
import { DOC_TYPES, DOC_TYPE_LABELS, type DocType } from "@/lib/employer-ai";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * "Send document" modal — sends any document type for e-signature via DocuSign.
 * offer/agreement/nda render from the employer's editable template; writeup is
 * the employee write-up form (signer entered manually, not an applicant); custom
 * is an employer-uploaded PDF. Reused from the candidate drawer, shortlist rows,
 * and the E-Signatures page (standalone / write-up).
 */
export function SendDocumentModal({
  applicantId,
  shortlistMemberId,
  candidateName = "",
  candidateEmail = "",
  defaultPosition,
  defaultDocType = "offer",
  onClose,
  onSent,
}: {
  applicantId?: number;
  shortlistMemberId?: number;
  candidateName?: string;
  candidateEmail?: string;
  defaultPosition?: string;
  defaultDocType?: DocType;
  onClose: () => void;
  onSent?: () => void;
}) {
  const [docType, setDocType] = useState<DocType>(defaultDocType);
  const [signerName, setSignerName] = useState(candidateName);
  const [signerEmail, setSignerEmail] = useState(candidateEmail);
  const [position, setPosition] = useState(defaultPosition || "");
  const [salary, setSalary] = useState("");
  const [startDate, setStartDate] = useState("");
  const [extraTerms, setExtraTerms] = useState("");
  const [message, setMessage] = useState("");
  const [documentName, setDocumentName] = useState("");
  const [documentPath, setDocumentPath] = useState("");
  const [uploading, setUploading] = useState(false);
  // Documents to request back from the signer (named upload slots).
  const [requestedDocs, setRequestedDocs] = useState<string[]>([]);
  const [reqInput, setReqInput] = useState("");
  // Writeup fields
  const [wIncidentDate, setWIncidentDate] = useState("");
  const [wPolicy, setWPolicy] = useState("");
  const [wDescription, setWDescription] = useState("");
  const [wCorrective, setWCorrective] = useState("");
  const [wNotes, setWNotes] = useState("");

  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConnected, setNotConnected] = useState(false);
  const [sent, setSent] = useState(false);

  const showOfferFields = docType === "offer" || docType === "agreement";
  const isWriteup = docType === "writeup";
  // Bound to an applicant only for the hiring doc types; writeup + no-applicant
  // opens editable signer inputs.
  const manualSigner = !applicantId || isWriteup;
  const effectiveEmail = manualSigner ? signerEmail : candidateEmail;
  const missingEmail = !EMAIL_RE.test((effectiveEmail || "").trim());

  async function onPdf(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/employer/docusign/upload", { method: "POST", body: fd });
      const d = (await res.json().catch(() => ({}))) as { path?: string; name?: string; error?: string };
      if (!res.ok || !d.path) setError(d.error || "Upload failed.");
      else {
        setDocumentPath(d.path);
        if (!documentName) setDocumentName(d.name || "Document");
      }
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  function addRequest(raw?: string) {
    const v = (raw ?? reqInput).trim();
    if (!v) return;
    setRequestedDocs((prev) =>
      prev.some((p) => p.toLowerCase() === v.toLowerCase()) || prev.length >= 20 ? prev : [...prev, v]
    );
    setReqInput("");
  }
  function removeRequest(name: string) {
    setRequestedDocs((prev) => prev.filter((p) => p !== name));
  }

  async function submit() {
    setError(null);
    setNotConnected(false);
    if (manualSigner && !signerName.trim()) return setError(isWriteup ? "Enter the employee's name." : "Enter the recipient's name.");
    if (showOfferFields && !position.trim()) return setError("Enter the position title.");
    if (isWriteup && !wDescription.trim()) return setError("Describe the incident.");
    if (docType === "custom") {
      if (!documentName.trim()) return setError("Give the document a name.");
      if (!documentPath) return setError("Upload a PDF to send.");
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
          applicantId: isWriteup ? undefined : applicantId,
          shortlistMemberId,
          candidateName: manualSigner ? signerName.trim() : candidateName,
          candidateEmail: manualSigner ? signerEmail.trim() : candidateEmail,
          position: position.trim(),
          salary: salary.trim(),
          startDate: startDate.trim(),
          extraTerms: extraTerms.trim(),
          message: message.trim(),
          requestedDocs,
          writeup: isWriteup
            ? {
                employeeName: signerName.trim(),
                employeeEmail: signerEmail.trim(),
                dateOfIncident: wIncidentDate.trim(),
                policyViolated: wPolicy.trim(),
                description: wDescription.trim(),
                correctiveAction: wCorrective.trim(),
                additionalNotes: wNotes.trim(),
              }
            : undefined,
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
            {signerName || candidateName || "The recipient"} will receive an email from DocuSign to review and sign.
            {requestedDocs.length > 0
              ? " They'll also get a secure link to upload the documents you requested."
              : ""}{" "}
            Track its status on the E-Signatures page.
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
          <Field label="Document type">
            <Picker value={docType} onChange={(e) => setDocType(e.target.value as DocType)}>
              {DOC_TYPES.map((t) => (
                <option key={t} value={t}>
                  {DOC_TYPE_LABELS[t]}
                </option>
              ))}
            </Picker>
          </Field>

          {/* Signer: read-only card when bound to an applicant, editable otherwise. */}
          {manualSigner ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={isWriteup ? "Employee name" : "Recipient name"}>
                <Input value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Jordan Lee" />
              </Field>
              <Field label={isWriteup ? "Employee email" : "Recipient email"}>
                <Input value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)} placeholder="jordan@email.com" />
              </Field>
            </div>
          ) : (
            <div className="rounded-lg border border-border-gold bg-white/[0.03] px-3 py-2.5 text-sm">
              <div className="text-cream">{candidateName || "Recipient"}</div>
              <div className={missingEmail ? "text-red-300" : "text-white/55"}>{candidateEmail || "No email on file"}</div>
            </div>
          )}

          {missingEmail && (
            <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              A valid signer email is required so DocuSign can reach them.
            </p>
          )}

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
          ) : isWriteup ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Date of incident">
                  <Input value={wIncidentDate} onChange={(e) => setWIncidentDate(e.target.value)} placeholder="March 3, 2026" />
                </Field>
                <Field label="Policy violated">
                  <Input value={wPolicy} onChange={(e) => setWPolicy(e.target.value)} placeholder="Attendance policy §4.2" />
                </Field>
              </div>
              <Field label="Description of incident">
                <Area rows={3} value={wDescription} onChange={(e) => setWDescription(e.target.value)} placeholder="What happened…" />
              </Field>
              <Field label="Corrective action">
                <Area rows={2} value={wCorrective} onChange={(e) => setWCorrective(e.target.value)} placeholder="Expected change + timeline…" />
              </Field>
              <Field label="Additional notes" hint="Optional">
                <Area rows={2} value={wNotes} onChange={(e) => setWNotes(e.target.value)} />
              </Field>
            </>
          ) : docType === "nda" ? (
            <p className="rounded-lg border border-border-gold bg-white/[0.03] px-3 py-2.5 text-xs text-white/55">
              Your NDA template will be generated and sent for signature. Edit its wording on the Templates tab.
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
              <Field label="Additional terms" hint="Bonus, equity, benefits, conditions — appended to the document.">
                <Area rows={2} value={extraTerms} onChange={(e) => setExtraTerms(e.target.value)} placeholder="e.g. 15% annual bonus target, 20 days PTO." />
              </Field>
            </>
          )}

          <Field label="Personal message" hint="A short note included in the email + document.">
            <Area rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="We're thrilled to have you join the team!" />
          </Field>

          {/* Request documents back from the signer (optional) */}
          <Field
            label="Request documents from signer"
            hint="Optional — each becomes an upload slot on the signer's page. A free-form “Other documents” slot is always available to them too."
          >
            <div className="flex gap-2">
              <Input
                value={reqInput}
                onChange={(e) => setReqInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addRequest();
                  }
                }}
                placeholder="e.g. Photo ID, Signed W-4, Certification"
              />
              <Btn variant="ghost" onClick={() => addRequest()} disabled={!reqInput.trim()}>
                <Plus className="h-4 w-4" /> Add
              </Btn>
            </div>
            {requestedDocs.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {requestedDocs.map((r) => (
                  <span
                    key={r}
                    className="inline-flex items-center gap-1 rounded-md border border-border-gold bg-white/[0.04] px-2 py-1 text-xs text-cream"
                  >
                    {r}
                    <button type="button" onClick={() => removeRequest(r)} className="text-white/45 hover:text-red-300" aria-label={`Remove ${r}`}>
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
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
