"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, PlayCircle, FileText, ExternalLink, Loader2, Plus } from "lucide-react";
import type { TrainingLibraryItem } from "@/lib/employee-hub";

/** Employee self-serve Training Library: browse the same built-in content the
 *  employer sees and "Take this training" yourself — no employer action
 *  needed. Lands you in My training to watch/read + complete it. */
export function LibraryClient() {
  const router = useRouter();
  const [items, setItems] = useState<TrainingLibraryItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState("all");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [takingId, setTakingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (category !== "all") params.set("category", category);
    if (q.trim()) params.set("q", q.trim());
    const res = await fetch(`/api/employee/library?${params}`).then((r) => r.json()).catch(() => ({}));
    setItems(res.items || []);
    if (res.categories) setCategories(res.categories);
    setLoading(false);
  }, [category, q]);
  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  async function take(item: TrainingLibraryItem) {
    setTakingId(item.id);
    try {
      const res = await fetch("/api/employee/library/take", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ libraryItemId: item.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.docId) router.push(`/employee/training?open=${d.docId}`);
    } finally {
      setTakingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header>
        <h1 className="font-serif text-3xl font-medium text-cream">Library</h1>
        <p className="mt-1 text-sm text-white/60">
          Free workplace training from official US-government sources. Take anything here yourself — no need to wait to be assigned.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setCategory("all")}
          className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${category === "all" ? "bg-violet text-white" : "border border-white/15 text-white/60 hover:bg-white/5"}`}
        >
          All
        </button>
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${category === c ? "bg-violet text-white" : "border border-white/15 text-white/60 hover:bg-white/5"}`}
          >
            {c}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search library…"
          className="ml-auto w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-cream placeholder:text-white/35 focus:border-violet focus:outline-none sm:w-56"
        />
      </div>

      {loading ? (
        <div className="glass flex items-center gap-2 px-5 py-8 text-sm text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <div className="glass flex flex-col items-center gap-2 px-5 py-12 text-center text-sm text-white/50">
          <BookOpen className="h-7 w-7 text-white/25" />
          Nothing matches — try another category or clear the search.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {items.map((item) => (
            <div key={item.id} className="glass flex flex-col gap-3 px-5 py-5">
              <div className="flex items-center gap-2">
                {item.kind === "video" ? <PlayCircle className="h-4 w-4 text-violet" /> : <FileText className="h-4 w-4 text-violet" />}
                <span className="inline-flex rounded-full bg-sky-500/20 px-2.5 py-0.5 text-[11px] font-semibold text-sky-300">{item.provider}</span>
                <span className="text-xs text-white/40">{item.category}</span>
              </div>
              <h3 className="font-medium text-cream">{item.title}</h3>
              <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-white/40 hover:text-cream">
                  <ExternalLink className="h-3 w-3" /> Source
                </a>
                <button
                  onClick={() => take(item)}
                  disabled={takingId === item.id}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-violet px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet/90 disabled:opacity-50"
                >
                  {takingId === item.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Take this training
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
