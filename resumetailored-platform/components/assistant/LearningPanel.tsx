"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

interface LearningItem {
  id: string;
  category: string;
  signalKey: string;
  signalValue: string;
  sampleCount: number;
  corrected: boolean;
  suggestable: boolean;
  description: string;
  updatedAt: string;
}

/**
 * "What Taylor has learned about you" (Taylor Combined Build v5, Section D)
 * — the employer-visible view over lib/assistant-employer-learning.ts's
 * deterministic, observation-only signals. Purely a viewer + per-item
 * delete/correct: nothing rendered here ever gets sent or applied anywhere
 * by itself — a learned item only ever backs a SUGGESTION Taylor may offer
 * in chat (lib/assistant-chat.ts SYSTEM_PROMPT), never an automatic action.
 *
 * Shown for every employer who can use the Assistant at all (not gated to
 * canVoice/Scale) — Portal-tier employers simply see an empty list, since
 * only approved mutating actions (Scale tier and up) ever produce a row.
 */
export function LearningPanel() {
  const t = useTranslations("employerAssistant");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<LearningItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/employer/assistant/learning");
      if (!res.ok) return;
      const data = (await res.json()) as { learnings?: LearningItem[] };
      setItems(data.learnings || []);
    } catch {
      // best-effort — the panel just stays as it was
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (open && !loaded) void load();
  }, [open, loaded, load]);

  async function deleteItem(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/employer/assistant/learning/${id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((i) => i.id !== id));
    } finally {
      setBusyId(null);
    }
  }

  function startCorrect(item: LearningItem) {
    setEditingId(item.id);
    setEditValue(item.signalValue);
  }

  async function saveCorrect(id: string) {
    const value = editValue.trim();
    if (!value) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/employer/assistant/learning/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (res.ok) {
        setItems((prev) => prev.map((i) => (i.id === id ? { ...i, signalValue: value, corrected: true, suggestable: true } : i)));
        setEditingId(null);
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mb-4">
      <button type="button" onClick={() => setOpen((o) => !o)} className="text-xs font-semibold uppercase tracking-wide text-white/55 underline-offset-2 hover:underline">
        {t("learningToggleLabel")}
      </button>
      {open && (
        <div className="mt-2 rounded-xl border border-border-gold/60 bg-white/[0.03] p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-cream">{t("learningPanelTitle")}</h3>
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-white/50 hover:text-white/80">
              {t("close")}
            </button>
          </div>
          {!items.length && <p className="text-xs text-white/50">{t("learningEmpty")}</p>}
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.id} className="rounded-lg border border-border-gold/40 bg-white/[0.02] p-2.5 text-sm">
                {editingId === item.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      placeholder={t("learningCorrectPlaceholder")}
                      className="flex-1 rounded-md border border-border-gold/60 bg-transparent px-2 py-1 text-xs text-cream"
                    />
                    <button type="button" disabled={busyId === item.id} onClick={() => saveCorrect(item.id)} className="text-xs font-semibold text-violet disabled:opacity-40">
                      {t("learningSave")}
                    </button>
                    <button type="button" onClick={() => setEditingId(null)} className="text-xs text-white/50">
                      {t("learningCancel")}
                    </button>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-cream">{item.description}</p>
                      <p className="mt-0.5 text-[11px] text-white/40">
                        {item.corrected ? t("learningCorrectedBadge") : t("learningObservedCount", { count: item.sampleCount })}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button type="button" disabled={busyId === item.id} onClick={() => startCorrect(item)} className="text-xs font-semibold text-violet disabled:opacity-40">
                        {t("learningCorrect")}
                      </button>
                      <button type="button" disabled={busyId === item.id} onClick={() => deleteItem(item.id)} className="text-xs font-semibold text-red-400 disabled:opacity-40">
                        {t("learningDelete")}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
