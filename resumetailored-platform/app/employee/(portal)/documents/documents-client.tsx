"use client";

import { useEffect, useState } from "react";
import { FileText, Download, Loader2 } from "lucide-react";

interface EmployeeDocAttachment {
  name: string;
  url: string;
  by: "signer" | "employer";
  uploadedAt: string;
}
interface EmployeeDoc {
  id: number;
  docType: string;
  documentName: string;
  subject: string;
  status: string;
  sentAt: string;
  completedAt: string | null;
  attachments: EmployeeDocAttachment[];
}

const DOC_TYPE_LABEL: Record<string, string> = {
  offer: "Offer letter",
  agreement: "Agreement",
  nda: "NDA",
  custom: "Document",
};

const STATUS_TONE: Record<string, string> = {
  completed: "bg-teal-500/15 text-teal-300",
  signed: "bg-teal-500/15 text-teal-300",
  sent: "bg-amber-500/15 text-amber-300",
  delivered: "bg-amber-500/15 text-amber-300",
  viewed: "bg-amber-500/15 text-amber-300",
  declined: "bg-red-500/15 text-red-300",
  voided: "bg-white/10 text-white/50",
};

export function EmployeeDocumentsClient() {
  const [docs, setDocs] = useState<EmployeeDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/employee/documents", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { documents?: EmployeeDoc[] }) => setDocs(d.documents || []))
      .catch(() => setDocs([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="font-serif text-3xl font-medium text-cream">My documents</h1>
        <p className="mt-1 text-sm text-white/60">Documents your employer has sent you to review or sign.</p>
      </header>

      {loading ? (
        <div className="flex items-center gap-2 px-1 py-10 text-sm text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : docs.length === 0 ? (
        <div className="glass px-6 py-12 text-center">
          <FileText className="mx-auto h-8 w-8 text-white/30" />
          <p className="mt-3 text-sm text-white/60">No documents yet. Anything your employer sends you to sign will appear here.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {docs.map((d) => (
            <li key={d.id} className="glass px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-violet" />
                    <span className="truncate font-medium text-cream">{d.documentName}</span>
                  </div>
                  <div className="mt-1 text-xs text-white/40">
                    {DOC_TYPE_LABEL[d.docType] || "Document"} · Sent {new Date(d.sentAt).toLocaleDateString()}
                    {d.completedAt ? ` · Completed ${new Date(d.completedAt).toLocaleDateString()}` : ""}
                  </div>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize ${STATUS_TONE[d.status] || "bg-white/10 text-white/60"}`}>
                  {d.status}
                </span>
              </div>

              {d.attachments.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-white/5 pt-3">
                  {d.attachments.map((a, i) => (
                    <a
                      key={i}
                      href={a.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-xs text-white/80 transition hover:bg-white/10"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span className="max-w-[180px] truncate">{a.name || "Download"}</span>
                    </a>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
