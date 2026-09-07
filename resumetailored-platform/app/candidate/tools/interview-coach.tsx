"use client";

import { useState } from "react";
import { MessageSquare, Sparkles, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToolModal } from "../components/tool-modal";
import { Label, TextArea, PrimaryButton, UpgradeNote } from "../components/ui";
import { JdImport } from "./jd-import";
import type { InterviewQuestion, InterviewFeedback } from "@/lib/tools-ai";

export function InterviewCoachTool({ onClose, isPro }: { onClose: () => void; isPro: boolean }) {
  const [jobText, setJobText] = useState("");
  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"questions" | "practice">("questions");

  const [selected, setSelected] = useState<InterviewQuestion | null>(null);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<InterviewFeedback | null>(null);
  const [scoring, setScoring] = useState(false);

  async function generate() {
    if (jobText.trim().length < 40) {
      setError("Paste the job description first (a few sentences at least).");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/interview-coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "questions", jobText }),
      });
      const data = (await res.json().catch(() => ({}))) as { questions?: InterviewQuestion[]; error?: string; message?: string };
      if (!res.ok || !data.questions) throw new Error(data.message || data.error || "Could not generate questions.");
      setQuestions(data.questions);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function getFeedback() {
    if (!selected || answer.trim().length < 5) return;
    setScoring(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/interview-coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "feedback", question: selected.question, answer }),
      });
      const data = (await res.json().catch(() => ({}))) as { feedback?: InterviewFeedback; error?: string; message?: string };
      if (!res.ok || !data.feedback) throw new Error(data.message || data.error || "Could not score that answer.");
      setFeedback(data.feedback);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setScoring(false);
    }
  }

  const footer =
    view === "questions" ? (
      <>
        <span className="mr-auto hidden text-xs text-white/45 sm:block">{isPro ? "Pro · full question set" : "Free · 5 questions"}</span>
        <PrimaryButton onClick={generate} loading={loading}>
          <Sparkles className="h-4 w-4" /> {questions.length ? "Regenerate" : "Generate questions"}
        </PrimaryButton>
      </>
    ) : (
      <>
        <span className="mr-auto hidden text-xs text-white/45 sm:block">Type your answer, get instant coaching</span>
        <PrimaryButton onClick={getFeedback} loading={scoring} disabled={!selected || answer.trim().length < 5}>
          <MessageSquare className="h-4 w-4" /> Get feedback
        </PrimaryButton>
      </>
    );

  return (
    <ToolModal title="Interview Coach" icon={MessageSquare} onClose={onClose} footer={footer}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex gap-1 border-b border-border-gold p-2">
          <Tab active={view === "questions"} onClick={() => setView("questions")} label="Questions" />
          <Tab active={view === "practice"} onClick={() => setView("practice")} label="Practice" disabled={!questions.length} />
        </div>

        {view === "questions" ? (
          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
            <div className="min-h-0 space-y-4 overflow-y-auto border-b border-border-gold p-4 lg:border-b-0 lg:border-r">
              <JdImport onImport={setJobText} />
              <div>
                <Label>Job description</Label>
                <TextArea rows={11} value={jobText} onChange={(e) => setJobText(e.target.value)} placeholder="Paste the job description, or import it from a URL above…" />
              </div>
              {!isPro && <UpgradeNote>Pro unlocks the full question set + mock-interview simulation.</UpgradeNote>}
              {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
            </div>
            <div className="min-h-0 overflow-y-auto bg-navy/40 p-4">
              {questions.length ? (
                <ul className="space-y-2.5">
                  {questions.map((q, i) => (
                    <li key={i} className="rounded-xl border border-border-gold bg-white/5 p-3.5">
                      <div className="mb-1.5 flex items-center gap-2">
                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase", q.type === "technical" ? "bg-teal/15 text-teal" : "bg-violet/20 text-violet")}>{q.type}</span>
                      </div>
                      <p className="text-sm text-white/90">{q.question}</p>
                      {q.framework && <p className="mt-1.5 text-xs text-white/50">{q.framework}</p>}
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(q);
                          setAnswer("");
                          setFeedback(null);
                          setView("practice");
                        }}
                        className="mt-2 text-xs font-semibold text-violet hover:underline"
                      >
                        Practice this →
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="flex h-full min-h-[300px] items-center justify-center rounded-xl border border-dashed border-border-gold p-8 text-center text-sm text-white/45">
                  Likely interview questions for this role — behavioral and technical — will appear here.
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2">
            <div className="min-h-0 space-y-4 overflow-y-auto border-b border-border-gold p-4 lg:border-b-0 lg:border-r">
              {/* Selected question shown prominently at the top. */}
              <div>
                <Label>Question</Label>
                {selected ? (
                  <div className="rounded-xl border border-violet/40 bg-violet/10 p-3.5">
                    <span className={cn("mb-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase", selected.type === "technical" ? "bg-teal/15 text-teal" : "bg-violet/20 text-violet")}>
                      {selected.type}
                    </span>
                    <p className="text-sm text-white/90">{selected.question}</p>
                  </div>
                ) : (
                  <p className="rounded-xl border border-dashed border-border-gold px-3 py-3 text-sm text-white/50">
                    Pick a question below (or tap “Practice this →” on the Questions tab).
                  </p>
                )}
                {questions.length > 1 && (
                  <select
                    className="mt-2 w-full rounded-xl border border-border-gold bg-white/5 px-3 py-2 text-xs text-cream outline-none focus:border-violet [&>option]:bg-navy"
                    value={selected ? questions.indexOf(selected) : -1}
                    onChange={(e) => {
                      setSelected(questions[Number(e.target.value)] || null);
                      setFeedback(null);
                    }}
                  >
                    <option value={-1} disabled>
                      Switch question…
                    </option>
                    {questions.map((q, i) => (
                      <option key={i} value={i}>
                        {q.question.slice(0, 70)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <Label>Your answer</Label>
                <TextArea rows={8} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Type your answer as you'd say it in the room…" />
              </div>
              {/* Inline action so the flow never depends on the footer. */}
              <PrimaryButton onClick={getFeedback} loading={scoring} disabled={!selected || answer.trim().length < 5} className="w-full">
                <MessageSquare className="h-4 w-4" /> Get feedback
              </PrimaryButton>
              {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
            </div>
            <div className="min-h-0 overflow-y-auto bg-navy/40 p-5">
              {feedback ? (
                <div className="space-y-5">
                  <div className="flex items-center gap-4">
                    <div className="flex h-16 w-16 flex-col items-center justify-center rounded-full bg-violet/20">
                      <span className="text-2xl font-bold text-white">{feedback.overall}</span>
                      <span className="text-[9px] uppercase text-white/50">/ 5</span>
                    </div>
                    <div className="flex gap-4 text-xs text-white/70">
                      <Score label="Structure" v={feedback.scores?.structure} />
                      <Score label="Relevance" v={feedback.scores?.relevance} />
                      <Score label="Keywords" v={feedback.scores?.keywords} />
                    </div>
                  </div>
                  {feedback.summary && <p className="rounded-lg border border-border-gold bg-white/5 px-3 py-2 text-sm text-white/85">{feedback.summary}</p>}
                  <FbList title="Strengths" tone="good" items={feedback.strengths} />
                  <FbList title="Improve" tone="bad" items={feedback.improvements} />
                </div>
              ) : (
                <div className="flex h-full min-h-[300px] items-center justify-center rounded-xl border border-dashed border-border-gold p-8 text-center text-sm text-white/45">
                  Pick a question, type your answer, and tap “Get feedback” for a scored review.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </ToolModal>
  );
}

function Score({ label, v }: { label: string; v?: number }) {
  return (
    <div className="text-center">
      <div className="text-base font-bold text-cream">{typeof v === "number" ? v : "–"}</div>
      <div className="uppercase tracking-wide text-white/45">{label}</div>
    </div>
  );
}

function FbList({ title, tone, items }: { title: string; tone: "good" | "bad"; items?: string[] }) {
  if (!items?.length) return null;
  const good = tone === "good";
  return (
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-cream">{title}</h4>
      <ul className="space-y-1.5">
        {items.map((s, i) => (
          <li key={i} className="flex gap-2 text-sm text-white/80">
            {good ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-teal" /> : <X className="mt-0.5 h-4 w-4 shrink-0 text-gold" />}
            {s}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Tab({ active, onClick, label, disabled }: { active: boolean; onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-40",
        active ? "bg-violet/20 text-white" : "text-muted-cream hover:bg-white/5"
      )}
    >
      {label}
    </button>
  );
}
