"use client";

import { useLocale, useTranslations } from "next-intl";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  FileSignature,
  RefreshCw,
  CheckCircle2,
  Link2,
  Download,
  Eye,
  AlertTriangle,
  UploadCloud,
  Paperclip,
  ChevronDown,
  Plus,
  Check,
  Circle,
} from "lucide-react";
import { Panel, PageHeader, Btn, Badge, EmptyState, Input, QuotaBar, UpgradeCard } from "../components/ui";
import type { DocusignConnection, DocusignEnvelope, DocusignStatus } from "@/lib/employer-ai";
import { SendDocumentModal } from "../components/send-document-modal";
import { SendCopyControl } from "../components/send-copy-control";

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

/** Where "Upgrade to ___" points, one tier up from the caller's current one. */
function nextSendTierLabel(tier: string): string | undefined {
  if (tier === "free") return "Employer Portal";
  if (tier === "portal") return "Scale";
  if (tier === "scale") return "Corporate";
  return undefined;
}

/** OAuth-callback error codes with a message under `employerEsign.errors.*`. */
const KNOWN_ERRORS = ["not_configured", "consent_denied", "state_mismatch", "auth_failed", "account_failed", "save_failed"];

export function DocusignClient({ connected, error, isAdmin = false }: { connected: boolean; error?: string; isAdmin?: boolean }) {
  const t = useTranslations("employerEsign");
  const locale = useLocale();
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [envelopes, setEnvelopes] = useState<DocusignEnvelope[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [banner, setBanner] = useState<{ tone: "ok" | "err"; text: string } | null>(
    connected
      ? { tone: "ok", text: t("connectedBanner") }
      : error
        ? { tone: "err", text: t(KNOWN_ERRORS.includes(error) ? `errors.${error}` : "errors.generic") }
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
    if (!confirm(t("confirmDisconnect"))) return;
    setDisconnecting(true);
    try {
      await fetch("/api/employer/docusign/disconnect", { method: "POST" });
      await loadStatus();
      setBanner({ tone: "ok", text: t("disconnected") });
    } finally {
      setDisconnecting(false);
    }
  }

  const conn = status?.connection;
  const usage = status?.usage;

  return (
    <div>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <div className="flex items-center gap-2">
            <Btn onClick={() => setShowSend(true)}>
              <UploadCloud className="h-4 w-4" /> {t("uploadAndSend")}
            </Btn>
            <Btn variant="ghost" onClick={refresh} loading={refreshing}>
              <RefreshCw className="h-4 w-4" /> {t("refresh")}
            </Btn>
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

      {/* Live from first visit for EVERY employer, not just the admin who
          manages the DocuSign connection below — a non-admin never had any
          way to see this count before hitting the cap. */}
      {usage && (
        <QuotaBar
          kind="esign"
          used={usage.used}
          limit={usage.limit}
          nextTierLabel={nextSendTierLabel(usage.tier)}
        />
      )}

      {/* Connection status — platform admin only. Regular employers send through
          the platform's DocuSign account and never connect/disconnect their own;
          exposing Disconnect here would break signing for everyone. */}
      {isAdmin && (
      <Panel className="mb-6">
        {loading ? (
          <div className="h-16 animate-pulse rounded-lg bg-white/5" />
        ) : status && !status.configured ? (
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
            <div>
              <h2 className="text-sm font-semibold text-cream">{t("notConfigured.title")}</h2>
              <p className="mt-1 text-sm text-white/55">
                {t("notConfigured.body")}
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
                <div className="text-sm font-semibold text-cream">{t("connection.connected")}</div>
                <div className="text-xs text-white/55">
                  {conn.accountEmail || conn.accountName || t("connection.accountFallback")}
                  {usage && (
                    <>
                      {" · "}
                      {usage.limit === null
                        ? t("connection.usageUnlimited", { used: usage.used })
                        : t("connection.usageLimited", { used: usage.used, limit: usage.limit })}
                    </>
                  )}
                </div>
              </div>
            </div>
            <Btn variant="ghost" onClick={disconnect} loading={disconnecting}>
              {t("connection.disconnect")}
            </Btn>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet/15">
                <Link2 className="h-5 w-5 text-violet" />
              </div>
              <div>
                <div className="text-sm font-semibold text-cream">{t("connect.title")}</div>
                <div className="text-xs text-white/55">
                  {t("connect.body")}
                </div>
              </div>
            </div>
            <a
              href="/api/employer/docusign/connect"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet/90"
            >
              <Link2 className="h-4 w-4" /> {t("connect.title")}
            </a>
          </div>
        )}
      </Panel>
      )}

      {/* Envelopes */}
      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-white/5" />
          ))}
        </div>
      ) : envelopes.length === 0 ? (
        <EmptyState
          icon={FileSignature}
          title={t("empty.title")}
          body={t("empty.body")}
          action={
            <Btn onClick={() => setShowSend(true)}>
              <UploadCloud className="h-4 w-4" /> {t("uploadAndSend")}
            </Btn>
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border-gold">
          {/* Horizontal scroll on small screens so the rightmost columns
              (Files / Certificate / Download) stay reachable on a 375px phone;
              lower-priority columns also collapse progressively (Recipient,
              Status and Certificate are always visible). colSpan on the detail
              row is clamped by the browser to the number of visible columns. */}
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b border-border-gold bg-white/[0.03] text-left text-xs uppercase tracking-wide text-muted-cream">
                <th className="px-4 py-3 font-semibold">{t("cols.recipient")}</th>
                <th className="hidden px-4 py-3 font-semibold sm:table-cell">{t("cols.type")}</th>
                <th className="hidden px-4 py-3 font-semibold lg:table-cell">{t("cols.document")}</th>
                <th className="hidden px-4 py-3 font-semibold md:table-cell">{t("cols.sent")}</th>
                <th className="px-4 py-3 font-semibold">{t("cols.status")}</th>
                <th className="hidden px-4 py-3 font-semibold sm:table-cell">{t("cols.files")}</th>
                <th className="px-4 py-3 font-semibold text-right">{t("cols.certificate")}</th>
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
                      title={isOpen ? t("hideDetails") : t("showDetails")}
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
                      <td className="hidden px-4 py-3 sm:table-cell">
                        <Badge tone={typeBadgeTone(e.status)}>{t(`docTypes.${e.docType}`)}</Badge>
                      </td>
                      <td className="hidden px-4 py-3 text-white/75 lg:table-cell">{e.documentName || e.offer.position || t(`docTypes.${e.docType}`)}</td>
                      <td className="hidden px-4 py-3 text-white/55 md:table-cell">{fmtDate(e.sentAt, locale)}</td>
                      <td className="px-4 py-3">
                        <Badge tone={STATUS_TONE[e.status]}>{t(`status.${e.status}`)}</Badge>
                      </td>
                      <td className="hidden px-4 py-3 sm:table-cell">
                        {e.attachments.length > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-teal/15 px-2 py-0.5 text-xs font-semibold text-teal">
                            <Paperclip className="h-3 w-3" /> {e.attachments.length}
                          </span>
                        ) : pendingReq > 0 ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-gold/15 px-2 py-0.5 text-xs font-semibold text-gold">
                            {t("requestedCount", { count: pendingReq })}
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
                            <Download className="h-3.5 w-3.5" /> {t("download")}
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

      <UpgradeCard />
    </div>
  );
}

// ── Envelope detail (expanded row): requested-docs checklist, attachments,
//    employer upload, and "request more documents" ─────────────────────────────
function EnvelopeDetail({ envelope, onChanged }: { envelope: DocusignEnvelope; onChanged: () => void }) {
  const t = useTranslations("employerEsign");
  const locale = useLocale();
  const [reqInput, setReqInput] = useState("");
  const [addingReq, setAddingReq] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [pickByReq, setPickByReq] = useState<Record<string, string>>({});
  const [markingReq, setMarkingReq] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const employerFiles = envelope.attachments.filter((a) => a.by === "employer");
  const isDone = envelope.status === "completed" || envelope.status === "signed";

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
        setMsg({ tone: "err", text: d.error || t("msg.couldntAddRequest") });
        return;
      }
      setReqInput("");
      setMsg({ tone: "ok", text: t("msg.requestAdded") });
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
        setMsg({ tone: "err", text: d.error || t("msg.uploadFailed") });
        return;
      }
      setMsg({ tone: "ok", text: t("msg.fileAttached") });
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
        setMsg({ tone: "err", text: d.error || t("msg.couldntUpdateRequest") });
        return;
      }
      setMsg({ tone: "ok", text: t("msg.markedReceived", { name }) });
      onChanged();
    } finally {
      setMarkingReq(null);
    }
  }

  const dl = (path: string, download = true) =>
    `/api/employer/docusign/envelopes/${envelope.id}/attachment?path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`;

  return (
    <div className="space-y-5">
      {/* Prominent signed-document download for completed/signed envelopes */}
      {isDone && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-teal/30 bg-teal/[0.06] px-4 py-3">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-teal" />
          <span className="mr-auto text-sm text-cream">{t("detail.complete")}</span>
          {/* View: the combined signed PDF + certificate, inline in the browser. */}
          <a
            href={`/api/employer/docusign/envelopes/${envelope.id}/documents`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet/90"
          >
            <Eye className="h-4 w-4" /> {t("detail.viewDocuments")}
          </a>
          <a
            href={`/api/employer/docusign/envelopes/${envelope.id}/documents?download=1`}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-border-gold bg-white/[0.03] px-4 py-2 text-sm font-semibold text-cream transition-colors hover:bg-white/[0.08]"
          >
            <Download className="h-4 w-4" /> {t("download")}
          </a>
          <a
            href={`/api/employer/docusign/envelopes/${envelope.id}/certificate`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-border-gold bg-white/[0.03] px-4 py-2 text-sm font-semibold text-cream transition-colors hover:bg-white/[0.08]"
          >
            <Download className="h-4 w-4" /> {t("detail.certificate")}
          </a>
        </div>
      )}

      {/* Send a copy (forward) of the completed document + a record of who got one */}
      {isDone && (
        <div className="rounded-xl border border-border-gold bg-white/[0.02] px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto text-xs font-semibold uppercase tracking-wide text-muted-cream">{t("detail.sendCopy")}</span>
            <SendCopyControl envelopeId={envelope.id} onSent={onChanged} />
          </div>
          <p className="mt-1 text-[11px] text-white/40">
            {t("detail.sendCopyHint")}
          </p>
          {envelope.copiesSent.length > 0 && (
            <p className="mt-2 text-[11px] text-white/45">
              {t("detail.copiesSent", { list: envelope.copiesSent.map((c) => `${c.email} (${fmtDate(c.sentAt, locale)})`).join(", ") })}
            </p>
          )}
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-2">
      {/* Requested documents checklist */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-cream">{t("detail.requestedDocs")}</h3>
        {envelope.requestedDocs.length === 0 ? (
          <p className="text-xs text-white/40">{t("detail.noneRequested")}</p>
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
                  {d.uploaded && <span className="text-[11px] font-semibold text-teal">{t("detail.received")}</span>}
                </div>
                {/* Manually satisfy a pending slot with an existing attachment. */}
                {!d.uploaded && envelope.attachments.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-6">
                    <select
                      value={pickByReq[d.name] || ""}
                      onChange={(e) => setPickByReq((m) => ({ ...m, [d.name]: e.target.value }))}
                      className="min-w-0 flex-1 rounded-lg border border-border-gold bg-white/5 px-2 py-1.5 text-xs text-cream outline-none focus:border-violet [&>option]:bg-navy [&>option]:text-cream"
                    >
                      <option value="">{t("detail.markPlaceholder")}</option>
                      {envelope.attachments.map((a, i) => (
                        <option key={`${a.url}-${i}`} value={a.url}>
                          {a.name} ({a.by === "employer" ? t("you") : t("signer")})
                        </option>
                      ))}
                    </select>
                    <Btn variant="ghost" onClick={() => void markSatisfied(d.name)} loading={markingReq === d.name} disabled={!pickByReq[d.name]}>
                      <Check className="h-4 w-4" /> {t("detail.markReceived")}
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
            placeholder={t("detail.requestPlaceholder")}
          />
          <Btn variant="ghost" onClick={() => void addRequest()} loading={addingReq} disabled={!reqInput.trim()}>
            <Plus className="h-4 w-4" /> {t("detail.request")}
          </Btn>
        </div>
      </div>

      {/* Attachments + employer upload */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-cream">{t("detail.allAttachments")}</h3>
        {envelope.attachments.length === 0 ? (
          <p className="text-xs text-white/40">{t("detail.noFiles")}</p>
        ) : (
          <ul className="space-y-1.5">
            {envelope.attachments.map((a, i) => (
              <li key={`${a.url}-${i}`} className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-3 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <Paperclip className="h-3.5 w-3.5 shrink-0 text-white/40" />
                  <span className="truncate text-cream">{a.name}</span>
                  <span className="shrink-0 text-[11px] text-white/40">{a.by === "employer" ? t("you") : t("signer")}</span>
                </span>
                <a href={dl(a.url)} className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-violet hover:underline">
                  <Download className="h-3.5 w-3.5" /> {t("download")}
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
            <UploadCloud className="h-4 w-4" /> {t("detail.attachFile")}
          </Btn>
        </div>
        {employerFiles.length > 0 && (
          <p className="mt-1 text-[11px] text-white/35">{t("detail.privateFiles")}</p>
        )}
      </div>

      {msg && (
        <p className={`md:col-span-2 text-xs ${msg.tone === "ok" ? "text-teal" : "text-red-300"}`}>{msg.text}</p>
      )}
      </div>
    </div>
  );
}

function fmtDate(iso: string, locale: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" });
}
