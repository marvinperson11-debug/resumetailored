"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Link2, Copy, Check, ExternalLink, Globe, Loader2 } from "lucide-react";
import { useTools } from "../components/tools-context";

/**
 * Shareable Links — the candidate's public, sendable link. In this app the
 * public-page feature is the Personal Website (a live page at /site/:slug), so
 * this surfaces the user's published site with copy/open actions, and a clear
 * empty state that opens the builder. Uses the existing /api/personal-website/mine.
 */
export function ShareableLinks() {
  const { isPro } = useTools();
  const router = useRouter();
  const openStudio = () => router.push(isPro ? "/candidate/studio" : "/candidate?upgrade=pro");
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/personal-website/mine", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { site: null }))
      .then((d: { site?: { url?: string } }) => setUrl(d?.site?.url || null))
      .catch(() => setUrl(null))
      .finally(() => setLoading(false));
  }, []);

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="font-serif text-2xl font-medium text-cream">Shareable Links</h1>
        <p className="mt-1 text-sm text-white/60">Send a live, public link to your resume — no attachment, opens instantly in any browser.</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 rounded-2xl border border-border-gold bg-white/[0.03] p-6 text-sm text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your links…
        </div>
      ) : url ? (
        <div className="rounded-2xl border border-border-gold bg-white/[0.03] p-6">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-cream">
            <Globe className="h-4 w-4 text-teal" /> Your published site
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full rounded-lg border border-border-gold bg-white/5 px-3 py-2 text-sm text-cream outline-none"
            />
            <div className="flex gap-2">
              <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded-lg border border-border-gold px-3 py-2 text-sm font-medium text-cream transition-colors hover:bg-white/8">
                {copied ? <Check className="h-4 w-4 text-teal" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy"}
              </button>
              <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-violet px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet/90">
                <ExternalLink className="h-4 w-4" /> Open
              </a>
            </div>
          </div>
          <button type="button" onClick={openStudio} className="mt-4 text-xs font-medium text-violet hover:text-violet/80">
            Edit or unpublish in the Personal Website builder →
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border-gold px-6 py-16 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-white/8">
            <Link2 className="h-6 w-6 text-violet" />
          </div>
          <h3 className="font-serif text-lg font-medium text-cream">No shareable link yet</h3>
          <p className="mt-1.5 max-w-sm text-sm text-white/55">
            Publish a Personal Website to get a live, public link you can drop into LinkedIn, an email, or your signature.
          </p>
          <button
            type="button"
            onClick={openStudio}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-violet px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet/90"
          >
            <Globe className="h-4 w-4" /> {isPro ? "Create your public site" : "Get a public site with Pro"}
          </button>
        </div>
      )}
    </div>
  );
}
