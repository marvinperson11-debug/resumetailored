"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useFormat } from "@/lib/use-format";
import { CheckCircle2, FileSignature, Plus, X } from "lucide-react";
import { Modal, Field, Input, Area, Picker, Btn } from "./ui";
import { DOC_TYPES, type DocType, type Applicant } from "@/lib/employer-ai";
import { limitReachedMessage, type LimitReachedBody } from "./limit-message";

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
  document,
  onClose,
  onSent,
}: {
  applicantId?: number;
  shortlistMemberId?: number;
  candidateName?: string;
  candidateEmail?: string;
  defaultPosition?: string;
  defaultDocType?: DocType;
  /** When set, send a composed document (Document Creator) instead of picking a
   *  type / uploading a PDF. Rendered to PDF server-side via the HTML path. */
  document?: { id: number; title: string };
  onClose: () => void;
  onSent?: () => void;
}) {
  const t = useTranslations("employerSendDocument");
  const fmt = useFormat();
  const tUi = useTranslations("employerUi");
  const tE = useTranslations("employerEsign");
  const isDoc = !!document;
  const [docType, setDocType] = useState<DocType>(isDoc ? "custom" : defaultDocType);
  const [signerName, setSignerName] = useState(candidateName);
  const [signerEmail, setSignerEmail] = useState(candidateEmail);
  // Recipient picker (standalone, non-writeup sends): the employer's applicants,
  // same source as the Schedule-interview form. "manual" reveals free-text fields.
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [pickId, setPickId] = useState<number | "manual" | "">("");
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
  // Show the applicant picker for standalone, non-writeup sends (no bound
  // applicant). Write-ups + employee docs keep the manual free-text path.
  const showPicker = !applicantId && !isWriteup;
  const enterManually = pickId === "manual";
  const chosenApplicantId = typeof pickId === "number" ? pickId : applicantId;

  // Load the employer's applicants once for the picker (skip when bound).
  useEffect(() => {
    if (applicantId) return;
    let cancelled = false;
    fetch("/api/employer/candidates", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { applicants: [] }))
      .then((d: { applicants?: Applicant[] }) => {
        if (!cancelled) setApplicants(d.applicants || []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [applicantId]);

  function onPick(value: string) {
    if (value === "manual") {
      setPickId("manual");
      setSignerName("");
      setSignerEmail("");
      return;
    }
    if (!value) {
      setPickId("");
      setSignerName("");
      setSignerEmail("");
      return;
    }
    const id = Number(value);
    const a = applicants.find((x) => x.id === id);
    setPickId(id);
    setSignerName(a?.name || "");
    setSignerEmail(a?.email || "");
  }

  async function onPdf(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/employer/docusign/upload", { method: "POST", body: fd });
      const d = (await res.json().catch(() => ({}))) as { path?: string; name?: string; error?: string };
      if (!res.ok || !d.path) setError(d.error || t("errors.uploadFailed"));
      else {
        setDocumentPath(d.path);
        if (!documentName) setDocumentName(d.name || t("document"));
      }
    } catch {
      setError(t("errors.uploadFailedRetry"));
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
    if (showPicker && pickId === "") return setError(t("errors.chooseRecipient"));
    if (manualSigner && !signerName.trim()) return setError(isWriteup ? t("errors.enterEmployeeName") : t("errors.enterRecipientName"));
    if (showOfferFields && !position.trim()) return setError(t("errors.enterPosition"));
    if (isWriteup && !wDescription.trim()) return setError(t("errors.describeIncident"));
    if (docType === "custom" && !isDoc) {
      if (!documentName.trim()) return setError(t("errors.nameDocument"));
      if (!documentPath) return setError(t("errors.uploadPdf"));
    }
    setSending(true);
    try {
      const res = await fetch("/api/employer/docusign/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docType,
          documentName: isDoc ? document!.title : documentName.trim(),
          documentPath: documentPath || undefined,
          documentId: isDoc ? document!.id : undefined,
          applicantId: isWriteup ? undefined : chosenApplicantId,
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
      const data = (await res.json().catch(() => ({}))) as LimitReachedBody;
      if (!res.ok) {
        if (data.code === "not_connected") setNotConnected(true);
        setError(
          data.code === "not_connected"
            ? t("errors.notConnected")
            : limitReachedMessage(tUi, data) || data.error || t("errors.sendFailed")
        );
        return;
      }
      setSent(true);
      onSent?.();
    } catch {
      setError(t("errors.network"));
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal title={t("title")} onClose={onClose}>
      {sent ? (
        <div className="flex flex-col items-center py-6 text-center">
          <CheckCircle2 className="mb-3 h-12 w-12 text-teal" />
          <h3 className="font-serif text-lg text-cream">{t("sent.title")}</h3>
          <p className="mt-1.5 max-w-sm text-sm text-white/60">
            {t("sent.body", { name: signerName || candidateName || t("sent.recipientFallback") })}
            {requestedDocs.length > 0 ? ` ${t("sent.uploadLink")}` : ""} {t("sent.track")}
          </p>
          <div className="mt-5 flex gap-2">
            <Link
              href="/employer/docusign"
              className="inline-flex items-center gap-2 rounded-lg border border-border-gold bg-white/[0.03] px-4 py-2 text-sm font-semibold text-cream hover:bg-white/[0.08]"
            >
              <FileSignature className="h-4 w-4 text-violet" /> {t("viewDocuments")}
            </Link>
            <Btn onClick={onClose}>{t("done")}</Btn>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {isDoc ? (
            <div className="rounded-lg border border-border-gold bg-white/[0.03] px-3 py-2.5 text-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-cream">{t("document")}</div>
              <div className="text-cream">{document!.title}</div>
            </div>
          ) : (
            <Field label={t("documentType")}>
              <Picker value={docType} onChange={(e) => setDocType(e.target.value as DocType)}>
                {DOC_TYPES.map((dt) => (
                  <option key={dt} value={dt}>
                    {tE(`docTypes.${dt}`)}
                  </option>
                ))}
              </Picker>
            </Field>
          )}

          {/* Signer: bound-applicant card, employee free-text (write-ups), or the
              applicant picker (standalone sends) with a manual escape hatch. */}
          {applicantId && !isWriteup ? (
            <div className="rounded-lg border border-border-gold bg-white/[0.03] px-3 py-2.5 text-sm">
              <div className="text-cream">{candidateName || t("recipientFallback")}</div>
              <div className={missingEmail ? "text-red-300" : "text-white/55"}>{candidateEmail || t("noEmail")}</div>
            </div>
          ) : isWriteup ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={t("employeeName")}>
                <Input value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder={t("namePlaceholder")} />
              </Field>
              <Field label={t("employeeEmail")}>
                <Input value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)} placeholder={t("emailPlaceholder")} />
              </Field>
            </div>
          ) : (
            <>
              <Field label={t("recipient")} hint={t("recipientHint")}>
                <Picker value={pickId === "" ? "" : String(pickId)} onChange={(e) => onPick(e.target.value)}>
                  <option value="">{t("pickCandidate")}</option>
                  {applicants.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.jobTitle ? ` — ${a.jobTitle}` : ""}
                    </option>
                  ))}
                  <option value="manual">{t("someoneElse")}</option>
                </Picker>
              </Field>
              {enterManually ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label={t("recipientName")}>
                    <Input value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder={t("namePlaceholder")} />
                  </Field>
                  <Field label={t("recipientEmail")}>
                    <Input value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)} placeholder={t("emailPlaceholder")} />
                  </Field>
                </div>
              ) : (
                typeof pickId === "number" && (
                  <div className="rounded-lg border border-border-gold bg-white/[0.03] px-3 py-2.5 text-sm">
                    <div className="text-cream">{signerName || t("recipientFallback")}</div>
                    <div className={missingEmail ? "text-red-300" : "text-white/55"}>{signerEmail || t("noEmail")}</div>
                  </div>
                )
              )}
            </>
          )}

          {missingEmail && (pickId !== "" || applicantId || isWriteup) && (
            <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {t("validEmailRequired")}
            </p>
          )}

          {isDoc ? null : docType === "custom" ? (
            <>
              <Field label={t("documentName")}>
                <Input value={documentName} onChange={(e) => setDocumentName(e.target.value)} placeholder={t("documentNamePlaceholder")} />
              </Field>
              <Field label={t("pdfToSign")} hint={t("pdfHint")}>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  disabled={uploading}
                  onChange={(e) => onPdf(e.target.files?.[0])}
                  className="block w-full text-xs text-muted-cream file:mr-3 file:rounded-md file:border-0 file:bg-violet/20 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-violet hover:file:bg-violet/30"
                />
                <p className="mt-1 text-[11px] text-white/40">
                  {uploading ? t("uploading") : documentPath ? t("pdfReady") : t("noFile")}
                </p>
              </Field>
            </>
          ) : isWriteup ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={t("incidentDate")}>
                  <Input value={wIncidentDate} onChange={(e) => setWIncidentDate(e.target.value)} placeholder={t("dateExample")} />
                </Field>
                <Field label={t("policyViolated")}>
                  <Input value={wPolicy} onChange={(e) => setWPolicy(e.target.value)} placeholder={t("policyPlaceholder")} />
                </Field>
              </div>
              <Field label={t("incidentDescription")}>
                <Area rows={3} value={wDescription} onChange={(e) => setWDescription(e.target.value)} placeholder={t("incidentPlaceholder")} />
              </Field>
              <Field label={t("correctiveAction")}>
                <Area rows={2} value={wCorrective} onChange={(e) => setWCorrective(e.target.value)} placeholder={t("correctivePlaceholder")} />
              </Field>
              <Field label={t("additionalNotes")} hint={t("optional")}>
                <Area rows={2} value={wNotes} onChange={(e) => setWNotes(e.target.value)} />
              </Field>
            </>
          ) : docType === "nda" ? (
            <p className="rounded-lg border border-border-gold bg-white/[0.03] px-3 py-2.5 text-xs text-white/55">
              {t("ndaNote")}
            </p>
          ) : (
            <>
              <Field label={t("position")}>
                <Input value={position} onChange={(e) => setPosition(e.target.value)} placeholder={t("positionPlaceholder")} />
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={t("annualSalary")}>
                  <Input value={salary} onChange={(e) => setSalary(e.target.value)} placeholder={fmt.money(140000)} />
                </Field>
                <Field label={t("startDate")}>
                  <Input value={startDate} onChange={(e) => setStartDate(e.target.value)} placeholder={t("dateExample")} />
                </Field>
              </div>
              <Field label={t("additionalTerms")} hint={t("additionalTermsHint")}>
                <Area rows={2} value={extraTerms} onChange={(e) => setExtraTerms(e.target.value)} placeholder={t("additionalTermsPlaceholder")} />
              </Field>
            </>
          )}

          <Field label={t("personalMessage")} hint={t("personalMessageHint")}>
            <Area rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t("personalMessagePlaceholder")} />
          </Field>

          {/* Request documents back from the signer (optional) */}
          <Field
            label={t("requestDocs")}
            hint={t("requestDocsHint")}
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
                placeholder={t("requestDocsPlaceholder")}
              />
              <Btn variant="ghost" onClick={() => addRequest()} disabled={!reqInput.trim()}>
                <Plus className="h-4 w-4" /> {t("add")}
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
                    <button type="button" onClick={() => removeRequest(r)} className="text-white/45 hover:text-red-300" aria-label={t("removeItem", { name: r })}>
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
                    {t("connectDocusign")}
                  </Link>
                </>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-border-gold pt-4">
            <Btn variant="ghost" onClick={onClose}>
              {t("cancel")}
            </Btn>
            <Btn onClick={submit} loading={sending} disabled={missingEmail || uploading}>
              <FileSignature className="h-4 w-4" /> {t("send")}
            </Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}
