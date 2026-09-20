"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

// ── Received & signed: aggregated signed PDFs + uploaded/attached files ────────
function ReceivedDocuments() {
  const [envelopes, setEnvelopes] = useState<DocusignEnvelope[]>([]);
  const [loading, setLoading] = useState(true);

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

  type Row = {
    key: string;
    name: string;
    label: string;
    signer: string;
    date: string;
    downloadHref: string;
    viewHref?: string;
    envId?: number;
    kind: "signed" | "signer" | "employer";
    status: DocusignStatus | null;
  };
  const rows: Row[] = [];
  for (const e of envelopes) {
    const label = e.documentName || e.offer.position || DOC_TYPE_LABELS[e.docType];
    const signer = e.candidateName || e.candidateEmail || "—";
    if (e.status === "completed" || e.status === "signed") {
      rows.push({
        key: `env-${e.id}`,
        name: "Signed documents (PDF + certificate)",
        label,
        signer,
        date: e.sentAt,
        viewHref: `/api/employer/docusign/envelopes/${e.id}/documents`,
        downloadHref: `/api/employer/docusign/envelopes/${e.id}/documents?download=1`,
        envId: e.id,
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
        downloadHref: `/api/employer/docusign/envelopes/${e.id}/attachment?path=${encodeURIComponent(a.url)}&download=1`,
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
        icon={FileText}
        title="Nothing received yet"
        body="Completed signed PDFs and any files uploaded by signers or attached by your team will appear here, ready to view or download."
      />
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-border-gold">
      {/* Horizontal scroll + progressive column collapse so View/Download/Send
          copy stay reachable on a 375px phone (Document, Status and Actions are
          always visible). */}
      <table className="w-full min-w-[480px] text-sm">
        <thead>
          <tr className="border-b border-border-gold bg-white/[0.03] text-left text-xs uppercase tracking-wide text-muted-cream">
            <th className="px-4 py-3 font-semibold">Document</th>
            <th className="hidden px-4 py-3 font-semibold md:table-cell">Envelope</th>
            <th className="hidden px-4 py-3 font-semibold sm:table-cell">Date</th>
            <th className="px-4 py-3 font-semibold">Status</th>
            <th className="px-4 py-3 font-semibold text-right">Actions</th>
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
              <td className="hidden px-4 py-3 md:table-cell">
                <div className="text-cream">{r.label}</div>
                <div className="text-xs text-white/45">{r.signer}</div>
              </td>
              <td className="hidden px-4 py-3 text-white/55 sm:table-cell">{fmtDate(r.date)}</td>
              <td className="px-4 py-3">
                {r.status ? (
                  <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
                ) : (
                  <Badge tone={r.kind === "employer" ? "neutral" : "teal"}>{r.kind === "employer" ? "attached" : "received"}</Badge>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                <div className="inline-flex flex-wrap items-center justify-end gap-3">
                  {r.viewHref && (
                    <a href={r.viewHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet hover:underline">
                      <Eye className="h-3.5 w-3.5" /> View
                    </a>
                  )}
                  <a href={r.downloadHref} className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet hover:underline">
                    <Download className="h-3.5 w-3.5" /> Download
                  </a>
                  {r.envId !== undefined && <SendCopyControl envelopeId={r.envId} onSent={load} />}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
