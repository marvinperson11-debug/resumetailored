"use client";

import { useState } from "react";
import { Link2, Loader2 } from "lucide-react";
import { TextInput, SecondaryButton } from "../components/ui";

/**
 * Compact "import a job posting from a URL" row, reused by the tools that accept
 * a JD or a URL (Interview Coach, Decoder Key, Career Hub). Posts to the shared
 * /api/fetch-job-url scraper and hands the extracted text back via onImport.
 */
export function JdImport({ onImport, label = "Import job posting from URL" }: { onImport: (text: string) => void; label?: string }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/fetch-job-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok || !data.text) throw new Error(data.error || "Could not import that URL.");
      onImport(data.text);
      setUrl("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not import that URL.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-cream">{label}</span>
      <div className="flex gap-2">
        <TextInput value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} placeholder="https://…  (LinkedIn, Indeed, Greenhouse, …)" />
        <SecondaryButton onClick={go} disabled={loading || !url.trim()} className="shrink-0">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />} Import
        </SecondaryButton>
      </div>
      {error && <p className="mt-1.5 text-xs text-red-300">{error}</p>}
    </div>
  );
}
