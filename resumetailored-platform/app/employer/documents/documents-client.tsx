"use client";

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
} from "lucide-react";
import { Panel, PageHeader, Btn, Badge, EmptyState, Input } from "../components/ui";
import { SendDocumentModal } from "../components/send-document-modal";
import { SendCopyControl } from "../components/send-copy-control";
import { DOC_TYPE_LABELS, type DocusignEnvelope, type DocusignStatus, type EmployerDocument } from "@/lib/employer-ai";
import { DOCUMENT_TEMPLATES } from "@/lib/document-templates";

const STATUS_TONE: Record<DocusignStatus, "neutral" | "sky" | "violet" | "gold" | "teal" | "red"> = {
  sent: "sky",
  delivered: "sky",
  viewed: "violet",
  signed: "gold",
  completed: "teal",
  declined: "red",
  voided: "red",
};

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function DocumentsClient({ canManage }: { canManage: boolean }) {
  const [tab, setTab] = useState<"mine" | "received">("mine");
  return (
    <div>
      <PageHeader title="Documents" subtitle="Compose documents to send for signature, and view everything received and signed." />
      <div className="mb-5 flex gap-1 border-b border-border-gold">
        {(["mine", "received"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
              tab === t ? "border-violet text-violet" : "border-transparent text-muted-cream hover:text-cream"
            }`}
          >
            {t === "mine" ? "My documents" : "Received & signed"}
          </button>
        ))}
      </div>
      {tab === "mine" ? <MyDocuments canManage={canManage} /> : <ReceivedDocuments />}
    </div>
  );
}

// ── My documents: list + Document Creator ─────────────────────────────────────
function MyDocuments({ canManage }: { canManage: boolean }) {
  const [docs, setDocs] = useState<EmployerDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ id?: number; title: string; bodyHtml: string } | null>(null);
  const [picking, setPicking] = useState(false);
  const [sendDoc, setSendDoc] = useState<{ id: number; title: string } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

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
    if (!confirm("Delete this document? This cannot be undone.")) return;
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

  return (
    <div>
      {canManage && (
        <div className="mb-4 flex items-center gap-2">
          <Btn onClick={() => setPicking((v) => !v)}>
            <Plus className="h-4 w-4" /> New document
          </Btn>
        </div>
      )}

      {picking && (
        <Panel className="mb-4">
          <h3 className="mb-3 text-sm font-semibold text-cream">Start from a template</h3>
          <div className="flex flex-wrap gap-2">
            <Btn
              variant="ghost"
              onClick={() => {
                setPicking(false);
                setEditing({ title: "Untitled document", bodyHtml: "" });
              }}
            >
              <FileText className="h-4 w-4" /> Blank document
            </Btn>
            {DOCUMENT_TEMPLATES.map((t) => (
              <Btn
                key={t.key}
                variant="ghost"
                onClick={() => {
                  setPicking(false);
                  setEditing({ title: t.name, bodyHtml: t.body });
                }}
              >
                <FileText className="h-4 w-4" /> {t.name}
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
          title="No documents yet"
          body="Create a document from a template (offer letter, agreement, NDA, write-up) or a blank page, edit the text, then send it for signature."
          action={canManage ? <Btn onClick={() => setPicking(true)}><Plus className="h-4 w-4" /> New document</Btn> : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border-gold">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="border-b border-border-gold bg-white/[0.03] text-left text-xs uppercase tracking-wide text-muted-cream">
                <th className="px-4 py-3 font-semibold">Title</th>
                <th className="hidden px-4 py-3 font-semibold sm:table-cell">Updated</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className="border-b border-border-gold/60 last:border-0 hover:bg-white/[0.02]">
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 text-violet" />
                      <span className="text-cream">{d.title}</span>
                    </span>
                  </td>
                  <td className="hidden px-4 py-3 text-white/55 sm:table-cell">{fmtDate(d.updatedAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex flex-wrap items-center justify-end gap-3">
                      <button
                        type="button"
                        onClick={() => setEditing({ id: d.id, title: d.title, bodyHtml: d.bodyHtml })}
                        className="text-xs font-semibold text-violet hover:underline"
                      >
                        {canManage ? "Edit" : "View"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setSendDoc({ id: d.id, title: d.title })}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet hover:underline"
                      >
                        <FileSignature className="h-3.5 w-3.5" /> Send for signature
                      </button>
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => void remove(d.id)}
                          disabled={busyId === d.id}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-300 hover:underline disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
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
    const url = prompt("Link URL (https://…)");
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
            body: JSON.stringify({ title: title.trim() || "Untitled document", bodyHtml }),
          })
        : await fetch("/api/employer/documents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: title.trim() || "Untitled document", bodyHtml }),
          });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(d.error || "Could not save the document.");
        return;
      }
      onSaved();
    } catch {
      setError("Network error — please try again.");
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
          <ArrowLeft className="h-4 w-4" /> Back
        </Btn>
        <Btn onClick={() => void save()} loading={saving} className="ml-auto">
          <Save className="h-4 w-4" /> Save
        </Btn>
      </div>

      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Document title" className="mb-3 text-base font-semibold" />

      <div className="overflow-hidden rounded-xl border border-border-gold">
        <div className="flex flex-wrap items-center gap-0.5 border-b border-border-gold bg-white/[0.03] p-1.5">
          <ToolBtn onClick={() => cmd("formatBlock", "H1")} title="Heading 1"><Heading1 className="h-4 w-4" /></ToolBtn>
          <ToolBtn onClick={() => cmd("formatBlock", "H2")} title="Heading 2"><Heading2 className="h-4 w-4" /></ToolBtn>
          <ToolBtn onClick={() => cmd("formatBlock", "P")} title="Paragraph"><FileText className="h-4 w-4" /></ToolBtn>
          <span className="mx-1 h-5 w-px bg-border-gold" />
          <ToolBtn onClick={() => cmd("bold")} title="Bold"><Bold className="h-4 w-4" /></ToolBtn>
          <ToolBtn onClick={() => cmd("italic")} title="Italic"><Italic className="h-4 w-4" /></ToolBtn>
          <ToolBtn onClick={() => cmd("underline")} title="Underline"><Underline className="h-4 w-4" /></ToolBtn>
          <span className="mx-1 h-5 w-px bg-border-gold" />
          <ToolBtn onClick={() => cmd("insertUnorderedList")} title="Bullet list"><List className="h-4 w-4" /></ToolBtn>
          <ToolBtn onClick={() => cmd("insertOrderedList")} title="Numbered list"><ListOrdered className="h-4 w-4" /></ToolBtn>
          <span className="mx-1 h-5 w-px bg-border-gold" />
          <ToolBtn onClick={() => cmd("justifyLeft")} title="Align left"><AlignLeft className="h-4 w-4" /></ToolBtn>
          <ToolBtn onClick={() => cmd("justifyCenter")} title="Align center"><AlignCenter className="h-4 w-4" /></ToolBtn>
          <span className="mx-1 h-5 w-px bg-border-gold" />
          <ToolBtn onClick={addLink} title="Insert link"><Link2 className="h-4 w-4" /></ToolBtn>
        </div>
        <div
          ref={bodyRef}
          contentEditable
          suppressContentEditableWarning
          className="doc-editor min-h-[420px] w-full overflow-y-auto bg-white px-6 py-5 text-sm leading-relaxed text-[#1a1a2e] outline-none"
        />
      </div>
      {error && <p className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
      <p className="mt-2 text-[11px] text-white/40">Tip: use the toolbar for headings, bold/italic, lists, alignment, and links. A signature line is added automatically when you send.</p>

      <style jsx global>{`
        .doc-editor h1 { font-size: 1.5rem; font-weight: 800; margin: 0 0 0.5rem; }
        .doc-editor h2 { font-size: 1.2rem; font-weight: 700; margin: 1rem 0 0.4rem; }
        .doc-editor p { margin: 0 0 0.6rem; }
        .doc-editor ul { list-style: disc; padding-left: 1.4rem; margin: 0 0 0.6rem; }
        .doc-editor ol { list-style: decimal; padding-left: 1.4rem; margin: 0 0 0.6rem; }
        .doc-editor a { color: #4f46e5; text-decoration: underline; }
      `}</style>
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
        title="Nothing received yet"
        body="Completed signed PDFs and any files uploaded by signers or attached by your team will appear here, ready to view or download."
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
            <th className="px-4 py-3 font-semibold">Recipient</th>
            <th className="hidden px-4 py-3 font-semibold sm:table-cell">Document</th>
            <th className="hidden px-4 py-3 font-semibold md:table-cell">Date</th>
            <th className="hidden px-4 py-3 font-semibold sm:table-cell">Files</th>
            <th className="px-4 py-3 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((e) => {
            const isOpen = expanded === e.id;
            const label = e.documentName || e.offer.position || DOC_TYPE_LABELS[e.docType];
            const signer = e.candidateName || e.candidateEmail || "—";
            const fileCount = e.attachments.length;
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
                      <div className="min-w-0">
                        <div className="truncate font-medium text-cream">{signer}</div>
                        {e.candidateEmail && e.candidateName && (
                          <div className="truncate text-xs text-white/45">{e.candidateEmail}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 text-white/75 sm:table-cell">{label}</td>
                  <td className="hidden px-4 py-3 text-white/55 md:table-cell">{fmtDate(envDate(e))}</td>
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
                    <Badge tone={STATUS_TONE[e.status]}>{e.status}</Badge>
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
            <span className="mr-auto text-sm font-medium text-cream">Signed documents (PDF + certificate)</span>
            <a
              href={`/api/employer/docusign/envelopes/${e.id}/documents`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet hover:underline"
            >
              <Eye className="h-3.5 w-3.5" /> View
            </a>
            <a
              href={`/api/employer/docusign/envelopes/${e.id}/documents?download=1`}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet hover:underline"
            >
              <Download className="h-3.5 w-3.5" /> Download
            </a>
            <SendCopyControl envelopeId={e.id} onSent={onChanged} />
          </div>
        </div>
      )}

      {/* 2) EVERY file for this envelope — signer uploads + employer-attached */}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-cream">
          All files{e.attachments.length > 0 ? ` (${e.attachments.length})` : ""}
        </h4>
        {e.attachments.length === 0 ? (
          <p className="text-xs text-white/40">No files uploaded for this envelope yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {e.attachments.map((a, i) => {
              const who = a.by === "employer" ? "you" : "signer";
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
                      <span className="shrink-0 rounded bg-gold/15 px-1.5 py-0.5 text-[10px] font-semibold text-gold">requested</span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <a href={att(a.url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-violet hover:underline">
                      <Eye className="h-3.5 w-3.5" /> View
                    </a>
                    <a href={att(a.url, true)} className="inline-flex items-center gap-1 text-xs font-semibold text-violet hover:underline">
                      <Download className="h-3.5 w-3.5" /> Download
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
          Awaiting from signer: {e.requestedDocs.filter((d) => !d.uploaded).map((d) => d.name).join(", ")}
        </p>
      )}
    </div>
  );
}
