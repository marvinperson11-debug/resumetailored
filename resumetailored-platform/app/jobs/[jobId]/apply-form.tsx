"use client";

import { useRef, useState } from "react";
import { Upload, Loader2, CheckCircle2 } from "lucide-react";

const input =
  "w-full rounded-lg border border-border-gold bg-white/5 px-3 py-2 text-sm text-cream placeholder:text-white/35 outline-none focus:border-violet focus:ring-1 focus:ring-violet";
const label = "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-cream";

/** Public application form (Feature E) — posts multipart to the public apply
 *  route (no auth). Resume is a file; everything else is text. */
export function ApplyForm({ jobId }: { jobId: number }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    if (!String(fd.get("name") || "").trim() || !String(fd.get("email") || "").trim()) {
      setError("Name and email are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/jobs/${jobId}/apply`, { method: "POST", body: fd });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !d.ok) throw new Error(d.error || "Could not submit your application.");
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <CheckCircle2 className="h-10 w-10 text-teal" />
        <h3 className="mt-3 font-serif text-lg text-cream">Application submitted</h3>
        <p className="mt-1 max-w-sm text-sm text-white/60">Thanks — the hiring team has your application and will be in touch if it&apos;s a match.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={label}>Name *</label>
          <input name="name" className={input} placeholder="Jordan Lee" required />
        </div>
        <div>
          <label className={label}>Email *</label>
          <input name="email" type="email" className={input} placeholder="jordan@email.com" required />
        </div>
        <div>
          <label className={label}>Phone</label>
          <input name="phone" className={input} placeholder="(555) 012-3456" />
        </div>
        <div>
          <label className={label}>Portfolio link</label>
          <input name="portfolio" className={input} placeholder="https://…" />
        </div>
      </div>

      <div>
        <label className={label}>Resume (PDF or DOCX)</label>
        <input ref={fileRef} name="resume" type="file" accept=".pdf,.docx,.doc,.txt" hidden onChange={(e) => setFileName(e.target.files?.[0]?.name || "")} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border-gold px-4 py-3 text-sm text-cream transition-colors hover:bg-white/5"
        >
          <Upload className="h-4 w-4 text-violet" /> {fileName || "Upload your resume"}
        </button>
      </div>

      <div>
        <label className={label}>Cover letter (optional)</label>
        <textarea name="coverLetter" rows={4} className={input + " resize-y"} placeholder="A short note on why you're a fit…" />
      </div>

      {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

      <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-violet px-5 py-2.5 text-sm font-semibold text-white hover:bg-violet/90 disabled:opacity-60">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Submit application
      </button>
    </form>
  );
}
