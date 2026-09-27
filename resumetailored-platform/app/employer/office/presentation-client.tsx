"use client";

import { useState } from "react";
import { Sparkles, Database, Play, Download, FileText, CheckCircle2 } from "lucide-react";
import { Panel, Field, Input, Area, Picker, Btn, TierUpgradeNote } from "../components/ui";
import {
  REPORT_SOURCES,
  REPORT_SOURCE_LABELS,
  PRESENTATION_SLIDE_COUNTS,
  type ReportSource,
  type PresentationSlideCount,
  type PresentationDeck,
} from "@/lib/office-hub";
import { downloadPresentationPdf } from "@/lib/pdf";
import { PresentModeViewer } from "./presentation-viewer";

type Mode = "topic" | "data";

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
const TODAY = isoDaysAgo(0);
const THIRTY_DAYS_AGO = isoDaysAgo(30);

export function PresentationTab({ canPresentation, canManage }: { canPresentation: boolean; canManage: boolean }) {
  const [mode, setMode] = useState<Mode>("topic");
  const [topic, setTopic] = useState("");
  const [source, setSource] = useState<ReportSource>("hiring");
  const [start, setStart] = useState(THIRTY_DAYS_AGO);
  const [end, setEnd] = useState(TODAY);
  const [slideCount, setSlideCount] = useState<PresentationSlideCount>(10);
  const [deck, setDeck] = useState<PresentationDeck | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canPresentation) return <TierUpgradeNote feature="Presentation Builder" />;

  async function generate() {
    setGenerating(true);
    setError(null);
    setSaved(false);
    try {
      const body = mode === "topic" ? { topic, slideCount } : { source, start, end, slideCount };
      const res = await fetch("/api/employer/office/presentation-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await res.json().catch(() => ({}))) as { deck?: PresentationDeck; error?: string };
      if (!res.ok || !d.deck) {
        setError(d.error || "Could not generate the presentation.");
        return;
      }
      setDeck(d.deck);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setGenerating(false);
    }
  }

  async function saveToDocuments() {
    if (!deck) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/employer/office/presentation-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(deck),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(d.error || "Could not save to Documents.");
        return;
      }
      setSaved(true);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
      <div className="space-y-5">
        <Panel>
          <h3 className="mb-3 text-sm font-semibold text-cream">Build a presentation</h3>
          <div className="mb-3 flex gap-1.5">
            {([
              { m: "topic", label: "Topic", icon: Sparkles },
              { m: "data", label: "Data source", icon: Database },
            ] as const).map(({ m, label, icon: Icon }) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  mode === m ? "border-violet bg-violet/15 text-violet" : "border-border-gold text-muted-cream hover:bg-white/5"
                }`}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>

          {mode === "topic" ? (
            <Field label="What's the presentation about?">
              <Area value={topic} onChange={(e) => setTopic(e.target.value)} rows={5} maxLength={500} placeholder="Q3 hiring plan for the leadership team…" />
            </Field>
          ) : (
            <>
              <Field label="Source">
                <Picker value={source} onChange={(e) => setSource(e.target.value as ReportSource)}>
                  {REPORT_SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {REPORT_SOURCE_LABELS[s]}
                    </option>
                  ))}
                </Picker>
              </Field>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Field label="From">
                  <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} max={end} />
                </Field>
                <Field label="To">
                  <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} min={start} max={TODAY} />
                </Field>
              </div>
            </>
          )}

          <div className="mt-3">
            <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-cream">Slides</span>
            <div className="flex gap-1.5">
              {PRESENTATION_SLIDE_COUNTS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setSlideCount(n)}
                  className={`flex-1 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                    slideCount === n ? "border-violet bg-violet/15 text-violet" : "border-border-gold text-muted-cream hover:bg-white/5"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <Btn className="mt-4 w-full" onClick={generate} loading={generating} disabled={mode === "topic" && !topic.trim()}>
            <Sparkles className="h-4 w-4" /> Generate
          </Btn>
          {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
        </Panel>
      </div>

      <div>
        <Panel>
          {!deck ? (
            <div className="flex h-[300px] items-center justify-center text-center text-sm text-white/45">
              Describe a topic or pick a data source, then generate a deck to preview here.
            </div>
          ) : (
            <div>
              <h3 className="font-serif text-lg font-medium text-cream">{deck.title}</h3>
              <p className="mt-1 text-xs text-white/45">{deck.slides.length} slides</p>

              <div className="mt-4 space-y-2">
                {deck.slides.map((s, i) => (
                  <div key={i} className="rounded-lg border border-border-gold bg-white/[0.03] px-3 py-2.5">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-semibold text-white/35">{i + 1}</span>
                      <span className="text-sm font-semibold text-cream">{s.title}</span>
                    </div>
                    <ul className="mt-1.5 space-y-0.5 pl-5 text-xs text-white/60">
                      {s.bullets.map((b, j) => (
                        <li key={j} className="list-disc">
                          {b}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border-gold/50 pt-4">
                <Btn onClick={() => setPresenting(true)}>
                  <Play className="h-4 w-4" /> Present
                </Btn>
                <Btn variant="ghost" onClick={() => downloadPresentationPdf(deck)}>
                  <Download className="h-4 w-4" /> Export PDF
                </Btn>
                {canManage && (
                  <Btn variant="ghost" onClick={saveToDocuments} loading={saving}>
                    <FileText className="h-4 w-4" /> Save to Documents
                  </Btn>
                )}
                {saved && (
                  <span className="inline-flex items-center gap-1.5 text-sm text-teal">
                    <CheckCircle2 className="h-4 w-4" /> Saved to Documents
                  </span>
                )}
              </div>
            </div>
          )}
        </Panel>
      </div>

      {presenting && deck && <PresentModeViewer deck={deck} onClose={() => setPresenting(false)} />}
    </div>
  );
}
