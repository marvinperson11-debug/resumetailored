"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  FileSignature,
  RefreshCw,
  CheckCircle2,
  Link2,
  Download,
  AlertTriangle,
  UploadCloud,
  Paperclip,
  ChevronDown,
  Plus,
  Copy,
  Check,
  Circle,
  FolderOpen,
  ArrowLeft,
} from "lucide-react";
import { Panel, PageHeader, Btn, Badge, EmptyState, Input } from "../components/ui";
import type { DocusignConnection, DocusignEnvelope, DocusignStatus } from "@/lib/employer-ai";
import { DOC_TYPE_LABELS } from "@/lib/employer-ai";
import { SendDocumentModal } from "../components/send-document-modal";

interface Usage {
  used: number;
  tier: string;
  limit: number | null; // null = unlimited
  remaining: number | null;
}
interface StatusResponse {
  configured: boolean;
  connection: DocusignConnection;
  usage: Usage;
}

const STATUS_TONE: Record<DocusignStatus, "neutral" | "sky" | "violet" | "gold" | "teal" | "red"> = {
  sent: "sky",
  delivered: "sky",
  viewed: "violet",
  signed: "gold",
  completed: "teal",
  declined: "red",
  voided: "red",
};

/**
 * The type badge (Offer / NDA / Agreement / Custom) is tinted by envelope status,
 * mirroring the status pill's meaning: amber while waiting (sent/delivered/
 * viewed), green once signed/completed, red when declined/voided.
 */
function typeBadgeTone(status: DocusignStatus): "gold" | "teal" | "red" {
  if (status === "completed" || status === "signed") return "teal";
  if (status === "declined" || status === "voided") return "red";
  return "gold";
}

const ERROR_COPY: Record<string, string> = {
  not_configured: "DocuSign isn't configured on this deployment yet. Add the DocuSign credentials to connect.",
  consent_denied: "DocuSign consent was cancelled. You can try connecting again.",
  state_mismatch: "The connection request expired or didn't match. Please try connecting again.",
  auth_failed: "DocuSign didn't return the tokens we need. Please try again.",
  account_failed: "We couldn't read your DocuSign account details. Please try again.",
  save_failed: "We couldn't save the connection. Please try again.",
};

export function DocusignClient({ connected, error, isAdmin = false }: { connected: boolean; error?: string; isAdmin?: boolean }) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [envelopes, setEnvelopes] = useState<DocusignEnvelope[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [view, setView] = useState<"list" | "documents">("list");
  const [banner, setBanner] = useState<{ tone: "ok" | "err"; text: string } | null>(
    connected
      ? { tone: "ok", text: "DocuSign connected. You can now send offer letters for signature." }
      : error
        ? { tone: "err", text: ERROR_COPY[error] || "Something went wrong connecting DocuSign." }
        : null
  );

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/employer/docusign/status", { cache: "no-store" });
      if (res.ok) setStatus((await res.json()) as StatusResponse);
    } catch {
      /* ignore */
    }
  }, []);

  const loadEnvelopes = useCallback(async (refresh: boolean) => {
    try {
      const res = await fetch(`/api/employer/docusign/envelopes${refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
      if (res.ok) {
        const d = (await res.json()) as { envelopes?: DocusignEnvelope[] };
        setEnvelopes(d.envelopes || []);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadStatus(), loadEnvelopes(true)]);
      setLoading(false);
    })();
  }, [loadStatus, loadEnvelopes]);

  async function refresh() {
    setRefreshing(true);
    await Promise.all([loadStatus(), loadEnvelopes(true)]);
    setRefreshing(false);
  }

  async function disconnect() {
    if (!confirm("Disconnect DocuSign? You'll need to reconnect to send more offers.")) return;
    setDisconnecting(true);
    try {
      await fetch("/api/employer/docusign/disconnect", { method: "POST" });
      await loadStatus();
      setBanner({ tone: "ok", text: "DocuSign disconnected." });
    } finally {
      setDisconnecting(false);
    }
  }

  const conn = status?.connection;
  const usage = status?.usage;

  return (
    <div>
      <PageHeader
        title="E-Signatures"
        subtitle="Send offer letters, agreements, NDAs, or any document for e-signature with DocuSign and track their status."
        action={
          <div className="flex items-center gap-2">
            {view === "documents" ? (
              <Btn variant="ghost" onClick={() => setView("list")}>
                <ArrowLeft className="h-4 w-4" /> Back to sent list
              </Btn>
            ) : (
              <>
                <Btn onClick={() => setShowSend(true)}>
                  <UploadCloud className="h-4 w-4" /> Upload &amp; send for signature
                </Btn>
                <Btn variant="ghost" onClick={() => setView("documents")}>
                  <FolderOpen className="h-4 w-4" /> View documents
                </Btn>
                <Btn variant="ghost" onClick={refresh} loading={refreshing}>
                  <RefreshCw className="h-4 w-4" /> Refresh
                </Btn>
              </>
            )}
          </div>
        }
      />

      {banner && (
        <div
          className={`mb-5 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${
            banner.tone === "ok"
              ? "border-teal/40 bg-teal/10 text-teal"
              : "border-red-500/40 bg-red-500/10 text-red-300"
          }`}
        >
          {banner.tone === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>{banner.text}</span>
        </div>
      )}

      {/* Connection status — platform admin only. Regular employers send through
          the platform's DocuSign account and never connect/disconnect their own;
          exposing Disconnect here would break signing for everyone. */}
      {isAdmin && view === "list" && (
      <Panel className="mb-6">
        {loading ? (
          <div className="h-16 animate-pulse rounded-lg bg-white/5" />
        ) : status && !status.configured ? (
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
            <div>
              <h2 className="text-sm font-semibold text-cream">DocuSign not configured</h2>
              <p className="mt-1 text-sm text-white/55">
                This deployment is missing its DocuSign credentials. Once they&apos;re set, you&apos;ll be able to
                connect your account here.
              </p>
            </div>
          </div>
        ) : conn?.connected ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal/15">
                <CheckCircle2 className="h-5 w-5 text-teal" />
              </div>
              <div>
                <div className="text-sm font-semibold text-cream">DocuSign connected</div>
                <div className="text-xs text-white/55">
                  {conn.accountEmail || conn.accountName || "Account connected"}
                  {usage && (
                    <>
                      {" · "}
                      {usage.limit === null
                        ? `${usage.used} sent this month · unlimited`
                        : `${usage.used} of ${usage.limit} monthly sends used`}
                    </>
                  )}
                </div>
              </div>
            </div>
            <Btn variant="ghost" onClick={disconnect} loading={disconnecting}>
              Disconnect
            </Btn>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet/15">
                <Link2 className="h-5 w-5 text-violet" />
              </div>
              <div>
                <div className="text-sm font-semibold text-cream">Connect DocuSign</div>
                <div className="text-xs text-white/55">
                  Authorize your DocuSign account to send offer letters for signature.
                </div>
              </div>
            </div>
            <a
              href="/api/employer/docusign/connect"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet/90"
            >
              <Link2 className="h-4 w-4" /> Connect DocuSign
            </a>
          </div>
        )}
      </Panel>
      )}

      {/* Envelopes / Documents */}
      {view === "documents" ? (
        <DocumentsView envelopes={envelopes} loading={loading} />
      ) : loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-white/5" />
          ))}
        </div>
      ) : envelopes.length === 0 ? (
        <EmptyState
          icon={FileSignature}
          title="No documents sent yet"
          body="Upload any PDF — a tax form, an agreement, an IRS letter — and send it for signature in one step. Or send an offer letter, agreement, or NDA from a candidate's profile. It'll appear here with its live signing status."
          action={
            <Btn onClick={() => setShowSend(true)}>
              <UploadCloud className="h-4 w-4" /> Upload &amp; send for signature
            </Btn>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border-gold">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-gold bg-white/[0.03] text-left text-xs uppercase tracking-wide text-muted-cream">
                <th className="px-4 py-3 font-semibold">Recipient</th>
                <th className="px-4 py-3 font-semibold">Type</th>
                <th className="px-4 py-3 font-semibold">Document</th>
                <th className="px-4 py-3 font-semibold">Sent</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Files</th>
                <th className="px-4 py-3 font-semibold text-right">Certificate</th>
              </tr>
            </thead>
            <tbody>
              {envelopes.map((e) => {
                const isOpen = expanded === e.id;
                const pendingReq = e.requestedDocs.filter((d) => !d.uploaded).length;
                return (
                  <Fragment key={e.id}>
                    <tr
                      onClick={() => setExpanded(isOpen ? null : e.id)}
                      title={isOpen ? "Hide details" : "Show details"}
                      aria-expanded={isOpen}
                      className={`group cursor-pointer border-b border-border-gold/60 last:border-0 transition-colors hover:bg-white/[0.06] ${isOpen ? "bg-white/[0.04]" : ""}`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? "rotate-180 text-violet" : "text-white/40 group-hover:text-violet"}`} />
                          <div>
                            <div className="font-medium text-cream">{e.candidateName || "—"}</div>
                            <div className="text-xs text-white/45">{e.candidateEmail}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={typeBadgeTone(e.status)}>{DOC_TYPE_LABELS[e.docType]}</Badge>
                      </td>
                      <td className="px-4 py-3 text-white/75">{e.documentName || e.offer.position || DOC_TYPE_LABELS[e.docType]}</td>
                      <td className="px-4 py-3 text-white/55">{fmtDate(e.sentAt)}</td>
                      <td className="px-4 py-3">
                        <Badge tone={STATUS_TONE[e.status]}>{e.status}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        {e.attachments.length > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-teal/15 px-2 py-0.5 text-xs font-semibold text-teal">
                            <Paperclip className="h-3 w-3" /> {e.attachments.length}
                          </span>
                        ) : pendingReq > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-gold/15 px-2 py-0.5 text-xs font-semibold text-gold">
                            {pendingReq} requested
                          </span>
                        ) : (
                          <span className="text-xs text-white/30">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {e.status === "completed" || e.status === "signed" ? (
                          <a
                            href={`/api/employer/docusign/envelopes/${e.id}/certificate`}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(ev) => ev.stopPropagation()}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet hover:underline"
                          >
                            <Download className="h-3.5 w-3.5" /> Download
                          </a>
                        ) : (
                          <span className="text-xs text-white/30">—</span>
                        )}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-border-gold/60 last:border-0 bg-white/[0.015]">
                        <td colSpan={7} className="px-4 py-4">
                          <EnvelopeDetail envelope={e} onChanged={() => void loadEnvelopes(false)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showSend && (
        <SendDocumentModal
          defaultDocType="custom"
          onClose={() => setShowSend(false)}
          onSent={() => {
            setShowSend(false);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

// ── Envelope detail (expanded row): requested-docs checklist, attachments,
//    employer upload, and "request more documents" ─────────────────────────────
function EnvelopeDetail({ envelope, onChanged }: { envelope: DocusignEnvelope; onChanged: () => void }) {
  const [reqInput, setReqInput] = useState("");
  const [addingReq, setAddingReq] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pickByReq, setPickByReq] = useState<Record<string, string>>({});
  const [markingReq, setMarkingReq] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const employerFiles = envelope.attachments.filter((a) => a.by === "employer");
  const isDone = envelope.status === "completed" || envelope.status === "signed";

  const signLink =
    envelope.signToken && typeof window !== "undefined"
      ? `${window.location.origin}/sign/${encodeURIComponent(envelope.envelopeId)}?key=${encodeURIComponent(envelope.signToken)}`
      : "";

  async function addRequest() {
    const name = reqInput.trim();
    if (!name) return;
    setAddingReq(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/employer/docusign/envelopes/${envelope.id}/request-docs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names: [name], notify: true }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setMsg({ tone: "err", text: d.error || "Couldn't add the request." });
        return;
      }
      setReqInput("");
      setMsg({ tone: "ok", text: "Request added — the signer was emailed an upload link." });
      onChanged();
    } finally {
      setAddingReq(false);
    }
  }

  async function uploadOwn(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/employer/docusign/envelopes/${envelope.id}/attachments`, { method: "POST", body: fd });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setMsg({ tone: "err", text: d.error || "Upload failed." });
        return;
      }
      setMsg({ tone: "ok", text: "File attached to this envelope." });
      onChanged();
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function markSatisfied(name: string) {
    setMarkingReq(name);
    setMsg(null);
    try {
      const res = await fetch(`/api/employer/docusign/envelopes/${envelope.id}/mark-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, attachmentUrl: pickByReq[name] || undefined }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setMsg({ tone: "err", text: d.error || "Couldn't update the request." });
        return;
      }
      setMsg({ tone: "ok", text: `Marked “${name}” as received.` });
      onChanged();
    } finally {
      setMarkingReq(null);
    }
  }

  function copyLink() {
    if (!signLink) return;
    void navigator.clipboard?.writeText(signLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }

  const dl = (path: string, download = true) =>
    `/api/employer/docusign/envelopes/${envelope.id}/attachment?path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`;

  return (
    <div className="space-y-5">
      {/* Prominent signed-document download for completed/signed envelopes */}
      {isDone && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-teal/30 bg-teal/[0.06] px-4 py-3">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-teal" />
          <span className="mr-auto text-sm text-cream">This document is complete.</span>
          <a
            href={`/api/employer/docusign/envelopes/${envelope.id}/documents`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet/90"
          >
            <Download className="h-4 w-4" /> Download signed documents
          </a>
          <a
            href={`/api/employer/docusign/envelopes/${envelope.id}/certificate`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-border-gold bg-white/[0.03] px-4 py-2 text-sm font-semibold text-cream transition-colors hover:bg-white/[0.08]"
          >
            <Download className="h-4 w-4" /> Certificate
          </a>
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2">
      {/* Requested documents checklist */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-cream">Requested documents</h3>
        {envelope.requestedDocs.length === 0 ? (
          <p className="text-xs text-white/40">No documents requested from the signer.</p>
        ) : (
          <ul className="space-y-2">
            {envelope.requestedDocs.map((d) => (
              <li key={d.name} className="text-sm">
                <div className="flex items-center gap-2">
                  {d.uploaded ? (
                    <CheckCircle2 className="h-4 w-4 text-teal" />
                  ) : (
                    <Circle className="h-4 w-4 text-white/30" />
                  )}
                  <span className={d.uploaded ? "text-cream" : "text-white/60"}>{d.name}</span>
                  {d.uploaded && <span className="text-[11px] font-semibold text-teal">received</span>}
                </div>
                {/* Manually satisfy a pending slot with an existing attachment. */}
                {!d.uploaded && envelope.attachments.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-6">
                    <select
                      value={pickByReq[d.name] || ""}
                      onChange={(e) => setPickByReq((m) => ({ ...m, [d.name]: e.target.value }))}
                      className="min-w-0 flex-1 rounded-lg border border-border-gold bg-white/5 px-2 py-1.5 text-xs text-cream outline-none focus:border-violet [&>option]:bg-navy [&>option]:text-cream"
                    >
                      <option value="">Mark received with an uploaded file…</option>
                      {envelope.attachments.map((a, i) => (
                        <option key={`${a.url}-${i}`} value={a.url}>
                          {a.name} ({a.by === "employer" ? "you" : "signer"})
                        </option>
                      ))}
                    </select>
                    <Btn variant="ghost" onClick={() => void markSatisfied(d.name)} loading={markingReq === d.name} disabled={!pickByReq[d.name]}>
                      <Check className="h-4 w-4" /> Mark received
                    </Btn>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Request more documents (after send) */}
        <div className="mt-3 flex gap-2">
          <Input
            value={reqInput}
            onChange={(e) => setReqInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void addRequest();
              }
            }}
            placeholder="Request another document…"
          />
          <Btn variant="ghost" onClick={() => void addRequest()} loading={addingReq} disabled={!reqInput.trim()}>
            <Plus className="h-4 w-4" /> Request
          </Btn>
        </div>
      </div>

      {/* Attachments + employer upload */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-cream">All attachments</h3>
        {envelope.attachments.length === 0 ? (
          <p className="text-xs text-white/40">No files uploaded yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {envelope.attachments.map((a, i) => (
              <li key={`${a.url}-${i}`} className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-3 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <Paperclip className="h-3.5 w-3.5 shrink-0 text-white/40" />
                  <span className="truncate text-cream">{a.name}</span>
                  <span className="shrink-0 text-[11px] text-white/40">{a.by === "employer" ? "you" : "signer"}</span>
                </span>
                <a href={dl(a.url)} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-violet hover:underline">
                  <Download className="h-3.5 w-3.5" /> Download
                </a>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,application/pdf,image/jpeg,image/png"
            className="hidden"
            onChange={(e) => void uploadOwn(e.target.files?.[0])}
          />
          <Btn variant="ghost" onClick={() => fileRef.current?.click()} loading={uploading}>
            <UploadCloud className="h-4 w-4" /> Attach a file
          </Btn>
        </div>
        {employerFiles.length > 0 && (
          <p className="mt-1 text-[11px] text-white/35">Files you attach are private to your team — the signer never sees them.</p>
        )}

        {/* Signer upload link */}
        {signLink && (
          <div className="mt-4">
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-cream">Signer upload link</h3>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg border border-border-gold bg-white/[0.04] px-2 py-1.5 text-[11px] text-white/70">
                {signLink}
              </code>
              <Btn variant="ghost" onClick={copyLink}>
                {copied ? <Check className="h-4 w-4 text-teal" /> : <Copy className="h-4 w-4" />}
                {copied ? "Copied" : "Copy"}
              </Btn>
            </div>
          </div>
        )}
      </div>

      {msg && (
        <p className={`md:col-span-2 text-xs ${msg.tone === "ok" ? "text-teal" : "text-red-300"}`}>{msg.text}</p>
      )}
      </div>
    </div>
  );
}

// ── Documents view: one flat, downloadable list of everything received/done ────
//    across all envelopes — completed signed PDFs + every uploaded/attached file.
//    Aggregated client-side from the already-loaded envelopes (no new endpoint).
function DocumentsView({ envelopes, loading }: { envelopes: DocusignEnvelope[]; loading: boolean }) {
  type Row = {
    key: string;
    name: string;
    label: string;
    signer: string;
    date: string;
    href: string;
    kind: "signed" | "signer" | "employer";
    status: DocusignStatus | null; // null → a "received"/"attached" tag
  };
  const rows: Row[] = [];
  for (const e of envelopes) {
    const label = e.documentName || e.offer.position || DOC_TYPE_LABELS[e.docType];
    const signer = e.candidateName || e.candidateEmail || "—";
    if (e.status === "completed" || e.status === "signed") {
      rows.push({
        key: `env-${e.id}`,
        name: "Signed documents (PDF)",
        label,
        signer,
        date: e.sentAt,
        href: `/api/employer/docusign/envelopes/${e.id}/documents`,
        kind: "signed",
        status: e.status,
      });
    }
    for (const a of e.attachments) {
      rows.push({
        key: `att-${e.id}-${a.url}`,
        name: a.name,
        label,
        signer,
        date: a.uploadedAt || e.sentAt,
        href: `/api/employer/docusign/envelopes/${e.id}/attachment?path=${encodeURIComponent(a.url)}&download=1`,
        kind: a.by === "employer" ? "employer" : "signer",
        status: null,
      });
    }
  }
  rows.sort((a, b) => (a.date < b.date ? 1 : -1));

  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-xl bg-white/5" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={FolderOpen}
        title="No documents yet"
        body="Completed signed PDFs and any files uploaded by signers or attached by your team will appear here, ready to download."
      />
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-border-gold">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-gold bg-white/[0.03] text-left text-xs uppercase tracking-wide text-muted-cream">
            <th className="px-4 py-3 font-semibold">Document</th>
            <th className="px-4 py-3 font-semibold">Envelope</th>
            <th className="px-4 py-3 font-semibold">Date</th>
            <th className="px-4 py-3 font-semibold">Status</th>
            <th className="px-4 py-3 font-semibold text-right">Download</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-border-gold/60 last:border-0 hover:bg-white/[0.02]">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  {r.kind === "signed" ? (
                    <FileSignature className="h-4 w-4 shrink-0 text-teal" />
                  ) : (
                    <Paperclip className="h-4 w-4 shrink-0 text-white/40" />
                  )}
                  <span className="truncate text-cream">{r.name}</span>
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="text-cream">{r.label}</div>
                <div className="text-xs text-white/45">{r.signer}</div>
              </td>
              <td className="px-4 py-3 text-white/55">{fmtDate(r.date)}</td>
              <td className="px-4 py-3">
                {r.status ? (
                  <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                ) : (
                  <Badge tone={r.kind === "employer" ? "neutral" : "teal"}>{r.kind === "employer" ? "attached" : "received"}</Badge>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                <a
                  href={r.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet hover:underline"
                >
                  <Download className="h-3.5 w-3.5" /> Download
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
