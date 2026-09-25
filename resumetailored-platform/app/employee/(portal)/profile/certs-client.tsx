"use client";

import { useCallback, useEffect, useState } from "react";
import { Award, Plus, Trash2, Loader2 } from "lucide-react";
import { certStatus, CERT_STATUS_LABELS, type EmployeeCert } from "@/lib/cert-hub";

const STATUS_STYLE: Record<string, string> = {
  ok: "bg-teal/20 text-teal",
  expiring: "bg-red-500/20 text-red-300",
  expired: "bg-red-500/20 text-red-300",
  no_expiry: "bg-white/10 text-white/60",
};

/** Employee self-service certifications: add your own (with an optional
 *  file), see status, and remove one you added by mistake. Certifications
 *  your employer added stay theirs to manage. */
export function MyCertifications() {
  const [certs, setCerts] = useState<EmployeeCert[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/employee/certs").then((r) => r.json()).catch(() => ({}));
    setCerts(res.certs || []);
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function remove(id: number) {
    if (!confirm("Remove this certification?")) return;
    await fetch(`/api/employee/certs/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="rounded-2xl border border-border-gold bg-white/[0.03] p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-cream">
          <Award className="h-4 w-4 text-violet" /> My certifications
        </h2>
        {!adding && (
          <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1.5 text-xs font-medium text-violet hover:underline">
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : certs.length === 0 && !adding ? (
        <p className="text-sm text-white/50">No certifications on file yet.</p>
      ) : (
        <ul className="mb-3 space-y-1.5">
          {certs.map((c) => {
            const status = certStatus(c);
            return (
              <li key={c.id} className="flex items-center justify-between gap-2 rounded-lg border border-border-gold bg-white/[0.02] px-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate text-cream">{c.name}</div>
                  <div className="text-xs text-white/45">{c.expiryDate ? `Expires ${c.expiryDate}` : "No expiry set"}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[status]}`}>
                    {CERT_STATUS_LABELS[status]}
                  </span>
                  {c.addedBy === "employee" && (
                    <button onClick={() => remove(c.id)} title="Remove" className="rounded-md p-1 text-red-300/80 hover:bg-red-500/10">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {adding && <AddForm onDone={() => { setAdding(false); load(); }} onCancel={() => setAdding(false)} />}
    </div>
  );
}

function AddForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [issuedDate, setIssuedDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!name.trim()) {
      setErr("A name is required.");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      const res = await fetch("/api/employee/certs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, issuedDate: issuedDate || undefined, expiryDate: expiryDate || undefined }),
      });
      const d = (await res.json().catch(() => ({}))) as { cert?: { id: number }; error?: string };
      if (!res.ok || !d.cert) {
        setErr(d.error || "Could not add the certification.");
        return;
      }
      if (file) {
        const form = new FormData();
        form.append("file", file);
        await fetch(`/api/employee/certs/${d.cert.id}/file`, { method: "POST", body: form });
      }
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-border-gold bg-white/[0.02] p-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Forklift certification"
        className="w-full rounded-lg border border-border-gold bg-white/5 px-3 py-2 text-sm text-cream placeholder:text-white/35 focus:border-violet focus:outline-none"
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          type="date"
          value={issuedDate}
          onChange={(e) => setIssuedDate(e.target.value)}
          className="w-full rounded-lg border border-border-gold bg-white/5 px-3 py-2 text-sm text-cream focus:border-violet focus:outline-none"
        />
        <input
          type="date"
          value={expiryDate}
          onChange={(e) => setExpiryDate(e.target.value)}
          className="w-full rounded-lg border border-border-gold bg-white/5 px-3 py-2 text-sm text-cream focus:border-violet focus:outline-none"
        />
      </div>
      <input
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
        onChange={(e) => setFile(e.target.files?.[0] || null)}
        className="block w-full text-xs text-white/60 file:mr-2 file:rounded file:border-0 file:bg-violet/20 file:px-2 file:py-1 file:text-violet"
      />
      {err && <p className="text-xs text-red-300">{err}</p>}
      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-violet px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet/90 disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Add
        </button>
        <button onClick={onCancel} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/70 transition hover:bg-white/5">
          Cancel
        </button>
      </div>
    </div>
  );
}
