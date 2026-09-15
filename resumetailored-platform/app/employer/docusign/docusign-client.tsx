"use client";

import { useCallback, useEffect, useState } from "react";
import { FileSignature, RefreshCw, CheckCircle2, Link2, Download, AlertTriangle } from "lucide-react";
import { Panel, PageHeader, Btn, Badge, EmptyState } from "../components/ui";
import type { DocusignConnection, DocusignEnvelope, DocusignStatus, DocType } from "@/lib/employer-ai";
import { DOC_TYPE_LABELS } from "@/lib/employer-ai";

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

const DOC_TYPE_TONE: Record<DocType, "neutral" | "sky" | "violet" | "gold" | "teal" | "red"> = {
  offer: "teal",
  agreement: "violet",
  nda: "gold",
  custom: "sky",
};

const STATUS_TONE: Record<DocusignStatus, "neutral" | "sky" | "violet" | "gold" | "teal" | "red"> = {
  sent: "sky",
  delivered: "sky",
  viewed: "violet",
  signed: "gold",
  completed: "teal",
  declined: "red",
  voided: "red",
};

const ERROR_COPY: Record<string, string> = {
  not_configured: "DocuSign isn't configured on this deployment yet. Add the DocuSign credentials to connect.",
  consent_denied: "DocuSign consent was cancelled. You can try connecting again.",
  state_mismatch: "The connection request expired or didn't match. Please try connecting again.",
  auth_failed: "DocuSign didn't return the tokens we need. Please try again.",
  account_failed: "We couldn't read your DocuSign account details. Please try again.",
  save_failed: "We couldn't save the connection. Please try again.",
};

export function DocusignClient({ connected, error }: { connected: boolean; error?: string }) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [envelopes, setEnvelopes] = useState<DocusignEnvelope[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
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
          <Btn variant="ghost" onClick={refresh} loading={refreshing}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Btn>
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

      {/* Connection status */}
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
          title="No documents sent yet"
          body="Send an offer letter, agreement, NDA, or custom document from a candidate's profile or a shortlist. It'll appear here with its live signing status."
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
                <th className="px-4 py-3 font-semibold text-right">Certificate</th>
              </tr>
            </thead>
            <tbody>
              {envelopes.map((e) => (
                <tr key={e.id} className="border-b border-border-gold/60 last:border-0 hover:bg-white/[0.02]">
                  <td className="px-4 py-3">
                    <div className="font-medium text-cream">{e.candidateName || "—"}</div>
                    <div className="text-xs text-white/45">{e.candidateEmail}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={DOC_TYPE_TONE[e.docType]}>{DOC_TYPE_LABELS[e.docType]}</Badge>
                  </td>
                  <td className="px-4 py-3 text-white/75">{e.docType === "custom" ? e.documentName || "Document" : e.offer.position || "—"}</td>
                  <td className="px-4 py-3 text-white/55">{fmtDate(e.sentAt)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[e.status]}>{e.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {e.status === "completed" || e.status === "signed" ? (
                      <a
                        href={`/api/employer/docusign/envelopes/${e.id}/certificate`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet hover:underline"
                      >
                        <Download className="h-3.5 w-3.5" /> Download
                      </a>
                    ) : (
                      <span className="text-xs text-white/30">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
