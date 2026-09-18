"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, UploadCloud, FileText, AlertTriangle, Loader2, ShieldCheck } from "lucide-react";

interface RequestedDoc {
  name: string;
  uploaded: boolean;
}
interface UploadedItem {
  name: string;
  note: string;
  uploadedAt: string;
  kind: "requested" | "other";
}
interface SignData {
  ok: true;
  signerName: string;
  documentName: string;
  company: string;
  status: string;
  completed: boolean;
  requestedDocs: RequestedDoc[];
  uploaded: UploadedItem[];
  limits: { maxBytes: number; allowedExt: string[] };
}

const MAX_TOTAL = 10; // "up to 10 files"

export function SignClient({ envelopeId, token }: { envelopeId: string; token: string }) {
  const [data, setData] = useState<SignData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState<string | null>(null); // slot name or "__free"
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const freeInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/sign/${encodeURIComponent(envelopeId)}?key=${encodeURIComponent(token)}`, {
        cache: "no-store",
      });
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (res.ok) setData((await res.json()) as SignData);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [envelopeId, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalUploaded = data?.uploaded.length ?? 0;
  const atLimit = totalUploaded >= MAX_TOTAL;

  function validate(file: File): string | null {
    const maxBytes = data?.limits.maxBytes ?? 10 * 1024 * 1024;
    const allowed = data?.limits.allowedExt ?? ["pdf", "jpg", "jpeg", "png", "doc", "docx"];
    const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
    if (!allowed.includes(ext)) return "Please upload a PDF, image (JPG/PNG), or Word document.";
    if (file.size > maxBytes) return "That file is too large (max 10 MB).";
    return null;
  }

  async function upload(file: File, requestName: string | undefined, slotKey: string) {
    setError(null);
    setFlash(null);
    const bad = validate(file);
    if (bad) {
      setError(bad);
      return;
    }
    setBusy(slotKey);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (requestName) fd.append("requestName", requestName);
      if (!requestName && note.trim()) fd.append("note", note.trim());
      const res = await fetch(`/api/sign/${encodeURIComponent(envelopeId)}/upload?key=${encodeURIComponent(token)}`, {
        method: "POST",
        body: fd,
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !d.ok) {
        setError(d.error || "Upload failed. Please try again.");
        return;
      }
      setFlash(`Received “${file.name}”. A confirmation has been emailed to you.`);
      if (!requestName) setNote("");
      await load();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-muted-cream">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <Shell>
        <div className="flex flex-col items-center py-10 text-center">
          <AlertTriangle className="mb-3 h-10 w-10 text-gold" />
          <h1 className="font-serif text-xl text-cream">This link isn&apos;t valid</h1>
          <p className="mt-2 max-w-sm text-sm text-muted-cream">
            The upload link may have expired or been mistyped. Please use the most recent link from your email, or ask
            the sender to resend it.
          </p>
        </div>
      </Shell>
    );
  }

  const firstName = (data.signerName || "").split(" ")[0];
  const pending = data.requestedDocs.filter((d) => !d.uploaded);

  return (
    <Shell>
      <div className="mb-6 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-teal">
        <ShieldCheck className="h-4 w-4" /> Secure document upload
      </div>
      <h1 className="font-serif text-2xl text-cream">
        {firstName ? `Hi ${firstName},` : "Upload your documents"}
      </h1>
      <p className="mt-2 text-sm text-muted-cream">
        {data.company ? <strong className="text-cream">{data.company}</strong> : "The sender"} asked you to upload a few
        documents related to <span className="text-cream">{data.documentName}</span>. You can return to this page any
        time using the same link.
      </p>

      {flash && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-teal/40 bg-teal/10 px-4 py-3 text-sm text-teal">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> <span>{flash}</span>
        </div>
      )}
      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{error}</span>
        </div>
      )}

      {/* Requested document slots */}
      {data.requestedDocs.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-cream">Requested documents</h2>
          <div className="space-y-2">
            {data.requestedDocs.map((d) => (
              <div
                key={d.name}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-gold bg-white/[0.03] px-4 py-3"
              >
                <div className="flex items-center gap-2 text-sm">
                  <FileText className="h-4 w-4 text-violet" />
                  <span className="text-cream">{d.name}</span>
                </div>
                {d.uploaded ? (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-teal">
                    <CheckCircle2 className="h-4 w-4" /> Uploaded
                  </span>
                ) : (
                  <SlotUpload
                    label="Choose file"
                    disabled={busy !== null || atLimit}
                    busy={busy === d.name}
                    onPick={(f) => upload(f, d.name, d.name)}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Free-form upload area */}
      <div className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-cream">Other documents</h2>
        <div className="rounded-xl border border-dashed border-border-gold bg-white/[0.02] p-5 text-center">
          <UploadCloud className="mx-auto mb-2 h-8 w-8 text-muted-cream" />
          <p className="text-sm text-muted-cream">
            Add anything else the sender needs. PDF, JPG, PNG or Word · max 10&nbsp;MB each · up to {MAX_TOTAL} files.
          </p>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note (what is this?)"
            className="mx-auto mt-3 block w-full max-w-sm rounded-lg border border-border-gold bg-white/[0.04] px-3 py-2 text-sm text-cream placeholder:text-white/35 focus:border-violet focus:outline-none"
          />
          <div className="mt-3">
            <input
              ref={freeInputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,application/pdf,image/jpeg,image/png"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f, undefined, "__free");
                if (freeInputRef.current) freeInputRef.current.value = "";
              }}
            />
            <button
              type="button"
              disabled={busy !== null || atLimit}
              onClick={() => freeInputRef.current?.click()}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === "__free" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
              Upload a file
            </button>
          </div>
          {atLimit && <p className="mt-2 text-xs text-gold">You&apos;ve reached the {MAX_TOTAL}-file limit for this link.</p>}
        </div>
      </div>

      {/* What they've uploaded */}
      {data.uploaded.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-cream">Your uploads ({data.uploaded.length})</h2>
          <ul className="space-y-1.5">
            {data.uploaded.map((u, i) => (
              <li key={`${u.name}-${i}`} className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-2 text-sm">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-teal" />
                <span className="truncate text-cream">{u.name}</span>
                {u.note && <span className="truncate text-xs text-white/45">— {u.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {pending.length === 0 && data.requestedDocs.length > 0 && (
        <p className="mt-6 rounded-xl border border-teal/30 bg-teal/[0.06] px-4 py-3 text-sm text-teal">
          All requested documents received — thank you! You can still upload more above if needed.
        </p>
      )}

      <p className="mt-8 text-center text-xs text-white/35">
        Uploaded securely via ResumeTailored. Only the sender can access these files.
      </p>
    </Shell>
  );
}

function SlotUpload({
  label,
  disabled,
  busy,
  onPick,
}: {
  label: string;
  disabled: boolean;
  busy: boolean;
  onPick: (f: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,application/pdf,image/jpeg,image/png"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          if (ref.current) ref.current.value = "";
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => ref.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border-gold bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-cream transition-colors hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
        {label}
      </button>
    </>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl items-start justify-center px-4 py-10 sm:py-16">
      <div className="w-full rounded-2xl border border-border-gold bg-white/[0.04] p-6 shadow-xl backdrop-blur-sm sm:p-8">
        {children}
      </div>
    </div>
  );
}
