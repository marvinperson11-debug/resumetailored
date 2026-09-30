"use client";

import { useLocale, useTranslations } from "next-intl";
import { formatDate } from "@/lib/format";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import {
  FileText,
  Plus,
  Trash2,
  Save,
  ArrowLeft,
  Download,
  Eye,
  FileSignature,
  Paperclip,
  ChevronDown,
  CheckCircle2,
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  Link2,
  Heading1,
  Heading2,
  BarChart3,
  Table,
  FileBarChart,
  FileDown,
  Presentation,
} from "lucide-react";
import { Panel, PageHeader, Btn, Badge, EmptyState, Input, QuotaBar, UpgradeCard } from "../components/ui";
import { SendDocumentModal } from "../components/send-document-modal";
import { SendCopyControl } from "../components/send-copy-control";
import { type DocusignEnvelope, type DocusignStatus, type EmployerDocument, type EmployerDocumentKind } from "@/lib/employer-ai";
import { DOCUMENT_TEMPLATES } from "@/lib/document-templates";
import { limitReachedMessage, type LimitReachedBody } from "../components/limit-message";
import { downloadDocumentPdf } from "@/lib/pdf";

const KIND_ICON: Record<EmployerDocumentKind, typeof FileText> = {
  html: FileText,
  chart: BarChart3,
  spreadsheet: Table,
  report: FileBarChart,
  presentation: Presentation,
};
/** Kinds that get a type badge next to the title (plain HTML docs don't);
 *  labels live under `employerDocuments.kinds.*`. */
const KIND_BADGE: Partial<Record<EmployerDocumentKind, "chart" | "spreadsheet" | "report" | "presentation">> = {
  chart: "chart",
  spreadsheet: "spreadsheet",
  report: "report",
  presentation: "presentation",
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

function fmtDate(iso: string, locale: string): string {
  return formatDate(iso, locale, "medium", "—");
}

export function DocumentsClient({
  canManage,
  documentLimit = null,
  documentNextTierLabel = "Employer Portal",
}: {
  canManage: boolean;
  documentLimit?: number | null;
  documentNextTierLabel?: string;
}) {
  const t = useTranslations("employerDocuments");
  const [tab, setTab] = useState<"mine" | "received">("mine");
  return (
    <div>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="mb-5 flex gap-1 border-b border-border-gold">
        {(["mine", "received"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
              tab === key ? "border-violet text-violet" : "border-transparent text-muted-cream hover:text-cream"
            }`}
          >
            {t(`tabs.${key}`)}
          </button>
        ))}
      </div>
      {tab === "mine" ? (
        <MyDocuments canManage={canManage} documentLimit={documentLimit} documentNextTierLabel={documentNextTierLabel} />
      ) : (
        <ReceivedDocuments />
      )}

      <UpgradeCard />
    </div>
  );
}

// ── My documents: list + Document Creator ─────────────────────────────────────
function MyDocuments({
  canManage,
  documentLimit,
  documentNextTierLabel,
}: {
  canManage: boolean;
  documentLimit: number | null;
  documentNextTierLabel: string;
}) {
  const t = useTranslations("employerDocuments");
  const locale = useLocale();
  const [docs, setDocs] = useState<EmployerDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ id?: number; title: string; bodyHtml: string } | null>(null);
  const [viewing, setViewing] = useState<EmployerDocument | null>(null);
  const [picking, setPicking] = useState(false);
  const [sendDoc, setSendDoc] = useState<{ id: number; title: string } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  /** Translated template name; a template added later without a message key
   *  falls back to its English name rather than showing a raw key. */
  const templateName = (key: string, fallback: string) => (t.has(`templates.${key}`) ? t(`templates.${key}`) : fallback);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/employer/documents", { cache: "no-store" });
      const d = (await res.json().catch(() => ({}))) as { documents?: EmployerDocument[] };
      setDocs(d.documents || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(id: number) {
    if (!confirm(t("confirmDelete"))) return;
    setBusyId(id);
    try {
      await fetch(`/api/employer/documents/${id}`, { method: "DELETE" });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (editing) {
    return (
      <DocumentEditor
        initial={editing}
        onCancel={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void load();
        }}
      />
    );
  }

  if (viewing) {
    return <DocumentViewer document={viewing} onClose={() => setViewing(null)} />;
  }

  return (
    <div>
      {!loading && <QuotaBar kind="documents" used={docs.length} limit={documentLimit} nextTierLabel={documentNextTierLabel} />}

      {canManage && (
        <div className="mb-4 flex items-center gap-2">
          <Btn onClick={() => setPicking((v) => !v)}>
            <Plus className="h-4 w-4" /> {t("newDocument")}
          </Btn>
        </div>
      )}

      {picking && (
        <Panel className="mb-4">
          <h3 className="mb-3 text-sm font-semibold text-cream">{t("startFromTemplate")}</h3>
          <div className="flex flex-wrap gap-2">
            <Btn
              variant="ghost"
              onClick={() => {
                setPicking(false);
                setEditing({ title: t("untitled"), bodyHtml: "" });
              }}
            >
              <FileText className="h-4 w-4" /> {t("blankDocument")}
            </Btn>
            {DOCUMENT_TEMPLATES.map((tpl) => (
              <Btn
                key={tpl.key}
                variant="ghost"
                onClick={() => {
                  setPicking(false);
                  setEditing({ title: templateName(tpl.key, tpl.name), bodyHtml: tpl.body });
                }}
              >
                <FileText className="h-4 w-4" /> {templateName(tpl.key, tpl.name)}
              </Btn>
            ))}
          </div>
        </Panel>
      )}

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-white/5" />
          ))}
        </div>
      ) : docs.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={t("empty.title")}
          body={t("empty.body")}
          action={canManage ? <Btn onClick={() => setPicking(true)}><Plus className="h-4 w-4" /> {t("newDocument")}</Btn> : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border-gold">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b border-border-gold bg-white/[0.03] text-left text-xs uppercase tracking-wide text-muted-cream">
                <th className="px-4 py-3 font-semibold">{t("cols.title")}</th>
                <th className="hidden px-4 py-3 font-semibold sm:table-cell">{t("cols.updated")}</th>
                <th className="px-4 py-3 font-semibold text-right">{t("cols.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => {
                const Icon = KIND_ICON[d.kind];
                const badgeKind = KIND_BADGE[d.kind];
                return (
                <tr key={d.id} className="border-b border-border-gold/60 last:border-0 hover:bg-white/[0.02]">
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2">
                      <Icon className={`h-4 w-4 shrink-0 ${d.kind === "html" ? "text-violet" : "text-teal"}`} />
                      <span className="text-cream">{d.title}</span>
                      {badgeKind && <Badge tone="teal">{t(`kinds.${badgeKind}`)}</Badge>}
                    </span>
                  </td>
                  <td className="hidden px-4 py-3 text-white/55 sm:table-cell">{fmtDate(d.updatedAt, locale)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex flex-wrap items-center justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => setViewing(d)}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet hover:underline"
                      >
                        <Eye className="h-3.5 w-3.5" /> {t("view")}
                      </button>
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => setEditing({ id: d.id, title: d.title, bodyHtml: d.bodyHtml })}
                          className="text-xs font-semibold text-violet hover:underline"
                        >
                          {t("edit")}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setSendDoc({ id: d.id, title: d.title })}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet hover:underline"
                      >
                        <FileSignature className="h-3.5 w-3.5" /> {t("sendForSignature")}
                      </button>
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => void remove(d.id)}
                          disabled={busyId === d.id}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-300 hover:underline disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> {t("delete")}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {sendDoc && (
        <SendDocumentModal
          document={sendDoc}
          onClose={() => setSendDoc(null)}
          onSent={() => setSendDoc(null)}
        />
      )}
    </div>
  );
}

// ── Document editor: contenteditable + a small toolbar (no editor libs) ────────
function DocumentEditor({
  initial,
  onSaved,
  onCancel,
}: {
  initial: { id?: number; title: string; bodyHtml: string };
  onSaved: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("employerDocuments");
  const tUi = useTranslations("employerUi");
  const [title, setTitle] = useState(initial.title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.innerHTML = initial.bodyHtml || "<p><br></p>";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cmd(command: string, value?: string) {
    bodyRef.current?.focus();
    try {
      document.execCommand(command, false, value);
    } catch {
      /* execCommand is deprecated but universally supported for this use */
    }
  }

  function addLink() {
    const url = prompt(t("linkPrompt"));
    if (url && /^https?:\/\//i.test(url)) cmd("createLink", url);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const bodyHtml = bodyRef.current?.innerHTML || "";
    try {
      const res = initial.id
        ? await fetch(`/api/employer/documents/${initial.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: title.trim() || t("untitled"), bodyHtml }),
          })
        : await fetch("/api/employer/documents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: title.trim() || t("untitled"), bodyHtml }),
          });
      const d = (await res.json().catch(() => ({}))) as LimitReachedBody;
      if (!res.ok) {
        setError(limitReachedMessage(tUi, d) || d.error || t("couldNotSave"));
        return;
      }
      onSaved();
    } catch {
      setError(t("network"));
    } finally {
      setSaving(false);
    }
  }

  const ToolBtn = ({ onClick, title: tt, children }: { onClick: () => void; title: string; children: React.ReactNode }) => (
    <button
      type="button"
      title={tt}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-cream transition-colors hover:bg-white/10 hover:text-cream"
    >
      {children}
    </button>
  );

  return (
    <div className="max-w-3xl">
      <div className="mb-4 flex items-center gap-2">
        <Btn variant="ghost" onClick={onCancel}>
          <ArrowLeft className="h-4 w-4" /> {t("back")}
        </Btn>
        <Btn onClick={() => void save()} loading={saving} className="ml-auto">
          <Save className="h-4 w-4" /> {t("save")}
        </Btn>
      </div>

      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("titlePlaceholder")} className="mb-3 text-base font-semibold" />

      <div className="overflow-hidden rounded-xl border border-border-gold">
        <div className="flex flex-wrap items-center gap-0.5 border-b border-border-gold bg-white/[0.03] p-1.5">
          <ToolBtn onClick={() => cmd("formatBlock", "H1")} title={t("toolbar.h1")}><Heading1 className="h-4 w-4" /></ToolBtn>
          <ToolBtn onClick={() => cmd("formatBlock", "H2")} title={t("toolbar.h2")}><Heading2 className="h-4 w-4" /></ToolBtn>
          <ToolBtn onClick={() => cmd("formatBlock", "P")} title={t("toolbar.paragraph")}><FileText className="h-4 w-4" /></ToolBtn>
          <span className="mx-1 h-5 w-px bg-border-gold" />
          <ToolBtn onClick={() => cmd("bold")} title={t("toolbar.bold")}><Bold className="h-4 w-4" /></ToolBtn>
          <ToolBtn onClick={() => cmd("italic")} title={t("toolbar.italic")}><Italic className="h-4 w-4" /></ToolBtn>
          <ToolBtn onClick={() => cmd("underline")} title={t("toolbar.underline")}><Underline className="h-4 w-4" /></ToolBtn>
          <span className="mx-1 h-5 w-px bg-border-gold" />
          <ToolBtn onClick={() => cmd("insertUnorderedList")} title={t("toolbar.bullets")}><List className="h-4 w-4" /></ToolBtn>
          <ToolBtn onClick={() => cmd("insertOrderedList")} title={t("toolbar.numbered")}><ListOrdered className="h-4 w-4" /></ToolBtn>
          <span className="mx-1 h-5 w-px bg-border-gold" />
          <ToolBtn onClick={() => cmd("justifyLeft")} title={t("toolbar.alignLeft")}><AlignLeft className="h-4 w-4" /></ToolBtn>
          <ToolBtn onClick={() => cmd("justifyCenter")} title={t("toolbar.alignCenter")}><AlignCenter className="h-4 w-4" /></ToolBtn>
          <span className="mx-1 h-5 w-px bg-border-gold" />
          <ToolBtn onClick={addLink} title={t("toolbar.link")}><Link2 className="h-4 w-4" /></ToolBtn>
        </div>
        <div
          ref={bodyRef}
          contentEditable
          suppressContentEditableWarning
          className="doc-editor min-h-[420px] w-full overflow-y-auto bg-white px-6 py-5 text-sm leading-relaxed text-[#1a1a2e] outline-none"
        />
      </div>
      {error && <p className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
      <p className="mt-2 text-[11px] text-white/40">{t("tip")}</p>

      <DocBodyStyles />
    </div>
  );
}

/** Shared typography for a document body — the editable `.doc-editor` div and
 *  the read-only viewer both render the same sanitized HTML and should look
 *  identical either way. Declared once (global, since it targets HTML the
 *  employer composed, not scoped React markup) and reused by both. */
function DocBodyStyles() {
  return (
    <style jsx global>{`
      .doc-editor h1 { font-size: 1.5rem; font-weight: 800; margin: 0 0 0.5rem; }
      .doc-editor h2 { font-size: 1.2rem; font-weight: 700; margin: 1rem 0 0.4rem; }
      .doc-editor p { margin: 0 0 0.6rem; }
      .doc-editor ul { list-style: disc; padding-left: 1.4rem; margin: 0 0 0.6rem; }
      .doc-editor ol { list-style: decimal; padding-left: 1.4rem; margin: 0 0 0.6rem; }
      .doc-editor a { color: #4f46e5; text-decoration: underline; }
    `}</style>
  );
}

// ── Document Viewer: read-only — HTML docs render the body, chart docs show
//    the image full-width. No contentEditable, no toolbar, no Save. ───────────
function DocumentViewer({ document: doc, onClose }: { document: EmployerDocument; onClose: () => void }) {
  const t = useTranslations("employerDocuments");
  const isChartImage = doc.kind === "chart" && !!doc.assetUrl;
  return (
    <div className="max-w-3xl">
      <div className="mb-4 flex items-center gap-2">
        <Btn variant="ghost" onClick={onClose}>
          <ArrowLeft className="h-4 w-4" /> {t("back")}
        </Btn>
        <h2 className="ml-2 truncate font-serif text-lg font-medium text-cream">{doc.title}</h2>
        {!isChartImage && (
          <Btn variant="ghost" className="ml-auto" onClick={() => downloadDocumentPdf(doc.title, doc.bodyHtml)}>
            <FileDown className="h-4 w-4" /> {t("exportPdf")}
          </Btn>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border-gold bg-white">
        {doc.kind === "chart" && doc.assetUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={doc.assetUrl} alt={doc.title} className="block w-full" />
        ) : (
          <div className="doc-editor min-h-[420px] w-full px-6 py-5 text-sm leading-relaxed text-[#1a1a2e]" dangerouslySetInnerHTML={{ __html: doc.bodyHtml || "" }} />
        )}
      </div>

      <DocBodyStyles />
    </div>
  );
}

// ── Received & signed: ONE ROW PER ENVELOPE, expandable to reveal the signed
//    documents (PDF + certificate) and EVERY file for that envelope (signer
//    requested-doc uploads, free uploads, and employer-attached files). No
//    orphan rows — every file lives under its envelope. Newest first. ──────────

/** The most relevant date for sorting/display: completion, else sent, else created. */
function envDate(e: DocusignEnvelope): string {
  return e.completedAt || e.sentAt || e.createdAt || "";
}

function ReceivedDocuments() {
  const t = useTranslations("employerDocuments");
  const tE = useTranslations("employerEsign");
  const locale = useLocale();
  const [envelopes, setEnvelopes] = useState<DocusignEnvelope[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/employer/docusign/envelopes", { cache: "no-store" });
      const d = (await res.json().catch(() => ({}))) as { envelopes?: DocusignEnvelope[] };
      setEnvelopes(d.envelopes || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Show an envelope once it has something to receive: a signed document, or at
  // least one attached file. Pending envelopes with nothing yet stay out.
  const shown = envelopes
    .filter((e) => e.status === "completed" || e.status === "signed" || e.attachments.length > 0)
    .sort((a, b) => (envDate(a) < envDate(b) ? 1 : -1)); // newest first

  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-xl bg-white/5" />
        ))}
      </div>
    );
  }
  if (shown.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title={t("received.emptyTitle")}
        body={t("received.emptyBody")}
      />
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-border-gold">
      {/* Horizontal scroll + progressive column collapse so Recipient and Status
          (and the expand chevron) stay reachable on a 375px phone; everything
          else lives in the expanded panel. colSpan on the detail row is clamped
          by the browser to the number of visible columns. */}
      <table className="w-full min-w-[440px] text-sm">
        <thead>
          <tr className="border-b border-border-gold bg-white/[0.03] text-left text-xs uppercase tracking-wide text-muted-cream">
            <th className="px-4 py-3 font-semibold">{t("received.recipient")}</th>
            <th className="hidden px-4 py-3 font-semibold sm:table-cell">{t("received.document")}</th>
            <th className="hidden px-4 py-3 font-semibold md:table-cell">{t("received.date")}</th>
            <th className="hidden px-4 py-3 font-semibold sm:table-cell">{t("received.files")}</th>
            <th className="px-4 py-3 font-semibold">{t("received.status")}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((e) => {
            const isOpen = expanded === e.id;
            const label = e.documentName || e.offer.position || tE(`docTypes.${e.docType}`);
            const signer = e.candidateName || e.candidateEmail || "—";
            const fileCount = e.attachments.length;
            return (
              <Fragment key={e.id}>
                <tr
                  onClick={() => setExpanded(isOpen ? null : e.id)}
                  title={isOpen ? t("received.hide") : t("received.show")}
                  aria-expanded={isOpen}
                  className={`group cursor-pointer border-b border-border-gold/60 last:border-0 transition-colors hover:bg-white/[0.06] ${isOpen ? "bg-white/[0.04]" : ""}`}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? "rotate-180 text-violet" : "text-white/40 group-hover:text-violet"}`} />
                      <div className="min-w-0">
                        <div className="truncate font-medium text-cream">{signer}</div>
                        {e.candidateEmail && e.candidateName && (
                          <div className="truncate text-xs text-white/45">{e.candidateEmail}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 text-white/75 sm:table-cell">{label}</td>
                  <td className="hidden px-4 py-3 text-white/55 md:table-cell">{fmtDate(envDate(e), locale)}</td>
                  <td className="hidden px-4 py-3 sm:table-cell">
                    {fileCount > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-teal/15 px-2 py-0.5 text-xs font-semibold text-teal">
                        <Paperclip className="h-3 w-3" /> {fileCount}
                      </span>
                    ) : (
                      <span className="text-xs text-white/30">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={STATUS_TONE[e.status]}>{tE(`status.${e.status}`)}</Badge>
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-border-gold/60 last:border-0 bg-white/[0.015]">
                    <td colSpan={5} className="px-4 py-4">
                      <EnvelopeFiles envelope={e} onChanged={load} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Expanded panel for one envelope: the signed document + every file ─────────
function EnvelopeFiles({ envelope: e, onChanged }: { envelope: DocusignEnvelope; onChanged: () => void }) {
  const t = useTranslations("employerDocuments");
  const isDone = e.status === "completed" || e.status === "signed";
  const att = (path: string, download = false) =>
    `/api/employer/docusign/envelopes/${e.id}/attachment?path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`;

  return (
    <div className="space-y-4">
      {/* 1) The signed documents (combined PDF + certificate) */}
      {isDone && (
        <div className="rounded-xl border border-teal/30 bg-teal/[0.06] px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <FileSignature className="h-4 w-4 shrink-0 text-teal" />
            <span className="mr-auto text-sm font-medium text-cream">{t("received.signedDocs")}</span>
            <a
              href={`/api/employer/docusign/envelopes/${e.id}/documents`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet hover:underline"
            >
              <Eye className="h-3.5 w-3.5" /> {t("view")}
            </a>
            <a
              href={`/api/employer/docusign/envelopes/${e.id}/documents?download=1`}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet hover:underline"
            >
              <Download className="h-3.5 w-3.5" /> {t("received.download")}
            </a>
            <SendCopyControl envelopeId={e.id} onSent={onChanged} />
          </div>
        </div>
      )}

      {/* 2) EVERY file for this envelope — signer uploads + employer-attached */}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-cream">
          {e.attachments.length > 0 ? t("received.allFilesCount", { count: e.attachments.length }) : t("received.allFiles")}
        </h4>
        {e.attachments.length === 0 ? (
          <p className="text-xs text-white/40">{t("received.noFiles")}</p>
        ) : (
          <ul className="space-y-1.5">
            {e.attachments.map((a, i) => {
              const who = a.by === "employer" ? t("received.you") : t("received.signer");
              return (
                <li
                  key={`${a.url}-${i}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-3 py-2 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Paperclip className="h-3.5 w-3.5 shrink-0 text-white/40" />
                    <span className="truncate text-cream">{a.name}</span>
                    <span className="shrink-0 text-[11px] text-white/40">{who}</span>
                    {a.kind === "requested" && (
                      <span className="shrink-0 rounded bg-gold/15 px-1.5 py-0.5 text-[10px] font-semibold text-gold">{t("received.requestedTag")}</span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <a href={att(a.url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-violet hover:underline">
                      <Eye className="h-3.5 w-3.5" /> {t("view")}
                    </a>
                    <a href={att(a.url, true)} className="inline-flex items-center gap-1 text-xs font-semibold text-violet hover:underline">
                      <Download className="h-3.5 w-3.5" /> {t("received.download")}
                    </a>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Requested docs still outstanding — surfaced so the row isn't misleading. */}
      {e.requestedDocs.some((d) => !d.uploaded) && (
        <p className="flex items-center gap-1.5 text-[11px] text-white/45">
          <CheckCircle2 className="h-3.5 w-3.5 text-white/30" />
          {t("received.awaiting", { names: e.requestedDocs.filter((d) => !d.uploaded).map((d) => d.name).join(", ") })}
        </p>
      )}
    </div>
  );
}
