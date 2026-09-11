"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MessageSquare, Sparkles, Loader2, Check, X, Mic, Lock, Play, Award, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ToolModal } from "../components/tool-modal";
import { Label, TextArea, Select, PrimaryButton, SecondaryButton, UpgradeNote } from "../components/ui";
import { JdImport } from "./jd-import";
import {
  INTERVIEW_TYPES, DIFFICULTIES,
  type InterviewType, type Difficulty, type InterviewQuestion, type InterviewCoaching,
  type InterviewFeedback, type MockReport, type QA,
} from "@/lib/interview-ai";
import type { ResumeDraft } from "@/lib/draft-types";

const scoreColor = (n: number) => (n >= 75 ? "#14B8A6" : n >= 50 ? "#F59E0B" : "#f87171");

export function InterviewCoachTool({ onClose, isPro }: { onClose: () => void; isPro: boolean }) {
  const router = useRouter();
  const [resumes, setResumes] = useState<ResumeDraft[]>([]);
  const [jobText, setJobText] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [type, setType] = useState<InterviewType>("behavioral");
  const [difficulty, setDifficulty] = useState<Difficulty>("mid");

  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [coaching, setCoaching] = useState<InterviewCoaching | null>(null);
  const [total, setTotal] = useState(0);
  const [lockedCount, setLockedCount] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [feedbackByQ, setFeedbackByQ] = useState<Record<string, InterviewFeedback>>({});
  const [scoringId, setScoringId] = useState<string | null>(null);
  const [activeFeedbackId, setActiveFeedbackId] = useState<string | null>(null);
  const [bodyTipOpen, setBodyTipOpen] = useState(false);

  // Mock interview (Pro).
  const [mockActive, setMockActive] = useState(false);
  const [mockQ, setMockQ] = useState("");
  const [mockAnswer, setMockAnswer] = useState("");
  const [mockQAs, setMockQAs] = useState<QA[]>([]);
  const [mockIndex, setMockIndex] = useState(0);
  const [mockMax, setMockMax] = useState(6);
  const [mockReport, setMockReport] = useState<MockReport | null>(null);
  const [mockBusy, setMockBusy] = useState(false);

  // Speech-to-text (best-effort; appends to a setter).
  const [recording, setRecording] = useState(false);
  const recRef = useRef<{ stop: () => void } | null>(null);
  const speechSupported = typeof window !== "undefined" && ("webkitSpeechRecognition" in window || "SpeechRecognition" in window);

  useEffect(() => {
    fetch("/api/resumes", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { drafts?: ResumeDraft[] }) => setResumes(d.drafts || []))
      .catch(() => {});
  }, []);

  function toggleRecord(onText: (t: string) => void) {
    if (recording) { recRef.current?.stop(); return; }
    try {
      const Ctor = (window as unknown as { webkitSpeechRecognition?: new () => unknown; SpeechRecognition?: new () => unknown }).webkitSpeechRecognition
        || (window as unknown as { SpeechRecognition?: new () => unknown }).SpeechRecognition;
      if (!Ctor) return;
      const rec = new (Ctor as new () => {
        lang: string; continuous: boolean; interimResults: boolean;
        onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> & { [i: number]: { isFinal: boolean } } }) => void;
        onend: () => void; start: () => void; stop: () => void;
      })();
      rec.lang = "en-US"; rec.continuous = true; rec.interimResults = false;
      rec.onresult = (e) => {
        let t = "";
        for (let i = 0; i < e.results.length; i++) if (e.results[i].isFinal) t += (e.results[i] as ArrayLike<{ transcript: string }>)[0].transcript + " ";
        if (t) onText(t);
      };
      rec.onend = () => { setRecording(false); recRef.current = null; };
      rec.start();
      recRef.current = { stop: () => rec.stop() };
      setRecording(true);
    } catch { setRecording(false); }
  }

  async function generate() {
    if (jobText.trim().length < 40) { setError("Paste the job description first (a few sentences at least)."); return; }
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/interview/questions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume: resumeText, jobDescription: jobText, type, difficulty }),
      });
      const d = (await res.json().catch(() => ({}))) as { questions?: InterviewQuestion[]; coaching?: InterviewCoaching; total?: number; lockedCount?: number; error?: string; message?: string };
      if (!res.ok || !d.questions) throw new Error(d.message || d.error || "Could not generate questions.");
      setQuestions(d.questions);
      setCoaching(d.coaching || null);
      setTotal(d.total || d.questions.length);
      setLockedCount(d.lockedCount || 0);
      setAnswers({}); setFeedbackByQ({}); setActiveFeedbackId(null); setExpandedId(d.questions[0]?.id || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setGenerating(false);
    }
  }

  async function getFeedback(q: InterviewQuestion) {
    const answer = (answers[q.id] || "").trim();
    if (answer.length < 5) { setError("Type an answer first."); return; }
    setScoringId(q.id);
    setError(null);
    try {
      const res = await fetch("/api/interview/feedback", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q.text, answer, type, jobDescription: jobText, resume: resumeText }),
      });
      const d = (await res.json().catch(() => ({}))) as { feedback?: InterviewFeedback; error?: string; message?: string };
      if (!res.ok || !d.feedback) throw new Error(d.message || d.error || "Could not score that answer.");
      setFeedbackByQ((cur) => ({ ...cur, [q.id]: d.feedback! }));
      setActiveFeedbackId(q.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setScoringId(null);
    }
  }

  // ── Mock interview (Pro) ──
  async function mockStep(nextQAs: QA[]) {
    setMockBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/interview/mock", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume: resumeText, jobDescription: jobText, type, difficulty, previousQAs: nextQAs }),
      });
      if (res.status === 402) { router.push("/candidate?upgrade=pro"); return; }
      const d = (await res.json().catch(() => ({}))) as { nextQuestion?: string; isFinal?: boolean; report?: MockReport; max?: number; error?: string; message?: string };
      if (!res.ok) throw new Error(d.message || d.error || "The mock interview hit a snag.");
      setMockMax(d.max || 6);
      if (d.isFinal && d.report) { setMockReport(d.report); setMockQ(""); }
      else { setMockQ(d.nextQuestion || ""); setMockIndex(nextQAs.length); }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setMockBusy(false);
    }
  }
  function startMock() {
    if (!isPro) { router.push("/candidate?upgrade=pro"); return; }
    if (jobText.trim().length < 40) { setError("Paste a job description first."); return; }
    setMockActive(true); setMockQAs([]); setMockIndex(0); setMockReport(null); setMockAnswer("");
    mockStep([]);
  }
  function submitMock() {
    if (mockAnswer.trim().length < 5) return;
    const updated = [...mockQAs, { question: mockQ, answer: mockAnswer.trim() }];
    setMockQAs(updated); setMockAnswer("");
    mockStep(updated);
  }

  const answeredCount = Object.keys(feedbackByQ).length;
  const readiness = useMemo(() => {
    const scores = Object.values(feedbackByQ).map((f) => f.score);
    if (!scores.length || !total) return 0;
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    return Math.round(avg * Math.min(1, answeredCount / Math.min(total, 5 + (isPro ? 10 : 0)) || 1) * 0.6 + avg * 0.4);
  }, [feedbackByQ, total, answeredCount, isPro]);

  const activeFeedback = activeFeedbackId ? feedbackByQ[activeFeedbackId] : null;
  const starRelevant = type === "behavioral" || type === "situational";

  const footer = (
    <>
      <span className="mr-auto hidden text-xs text-white/45 sm:block">{isPro ? "Pro · full set + mock" : "Free · 5 questions"}</span>
      <PrimaryButton onClick={generate} loading={generating}>
        <Sparkles className="h-4 w-4" /> {questions.length ? "Regenerate" : "Generate questions"}
      </PrimaryButton>
    </>
  );

  // ── Mock overlay ──
  if (mockActive) {
    return (
      <ToolModal title="Mock Interview" icon={MessageSquare} onClose={onClose}>
        <div className="mx-auto flex h-full min-h-0 w-full max-w-2xl flex-col overflow-y-auto p-5">
          {mockReport ? (
            <div className="space-y-5">
              <div className="flex items-center gap-4">
                <Ring score={mockReport.overallScore} />
                <div><div className="text-xs uppercase tracking-wide text-muted-cream">Mock interview complete</div><div className="font-serif text-xl text-cream">Final report</div></div>
              </div>
              <div className="rounded-xl border border-teal/40 bg-teal/10 p-3"><div className="text-[11px] font-bold uppercase tracking-wide text-teal">Strongest</div><p className="mt-1 text-sm text-white/85">{mockReport.strongest}</p></div>
              <div className="rounded-xl border border-gold/40 bg-gold/10 p-3"><div className="text-[11px] font-bold uppercase tracking-wide text-gold">Weakest</div><p className="mt-1 text-sm text-white/85">{mockReport.weakest}</p></div>
              <div><div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-cream">Practice these</div><ul className="space-y-1.5">{mockReport.practice.map((p, i) => <li key={i} className="flex gap-2 text-sm text-white/85"><Award className="mt-0.5 h-4 w-4 shrink-0 text-violet" /> {p}</li>)}</ul></div>
              <p className="text-xs text-white/45">Saved to your interview history.</p>
              <div className="flex gap-2">
                <SecondaryButton onClick={() => { setMockActive(false); setMockReport(null); }}>Back to practice</SecondaryButton>
                <PrimaryButton onClick={startMock}>Run another</PrimaryButton>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-cream">Question {Math.min(mockIndex + 1, mockMax)} of {mockMax}</span>
                <button type="button" onClick={() => setMockActive(false)} className="text-xs text-white/50 hover:text-cream">Exit</button>
              </div>
              <div className="rounded-xl border border-violet/40 bg-violet/10 p-4">
                {mockBusy && !mockQ ? <span className="inline-flex items-center gap-2 text-sm text-white/70"><Loader2 className="h-4 w-4 animate-spin" /> The interviewer is thinking…</span> : <p className="text-base text-white/90">{mockQ}</p>}
              </div>
              <div className="mt-3 flex-1">
                <div className="mb-1.5 flex items-center justify-between"><Label>Your answer</Label>{speechSupported && <button type="button" onClick={() => toggleRecord((t) => setMockAnswer((a) => (a ? a + " " : "") + t))} className={cn("inline-flex items-center gap-1 text-xs", recording ? "text-red-400" : "text-white/55 hover:text-cream")}><Mic className="h-3.5 w-3.5" /> {recording ? "Stop" : "Record"}</button>}</div>
                <TextArea rows={7} value={mockAnswer} onChange={(e) => setMockAnswer(e.target.value)} placeholder="Answer out loud or type it…" disabled={mockBusy || !mockQ} />
                <div className="mt-1 text-right text-[11px] text-white/40">{mockAnswer.length} chars</div>
              </div>
              {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
              <PrimaryButton onClick={submitMock} loading={mockBusy} disabled={mockAnswer.trim().length < 5 || !mockQ} className="mt-3 w-full">
                Submit &amp; continue
              </PrimaryButton>
            </div>
          )}
        </div>
      </ToolModal>
    );
  }

  return (
    <ToolModal title="Interview Coach" icon={MessageSquare} onClose={onClose} footer={footer}>
      <div className="grid h-full grid-cols-1 lg:grid-cols-[45%_55%]">
        {/* LEFT: setup + questions + answers */}
        <div className="min-h-0 space-y-4 overflow-y-auto border-b border-border-gold p-4 lg:border-b-0 lg:border-r">
          {/* Setup card */}
          <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
            <JdImport onImport={setJobText} />
            <div>
              <Label>Job description</Label>
              <TextArea rows={4} value={jobText} onChange={(e) => setJobText(e.target.value)} placeholder="Paste the job posting, or import from a URL above…" />
            </div>
            <div>
              <Label>My resume (optional)</Label>
              <TextArea rows={3} value={resumeText} onChange={(e) => setResumeText(e.target.value)} placeholder="Paste your resume for tailored questions…" />
              {resumes.length > 0 && (
                <Select className="mt-2" value="" onChange={(e) => { const d = resumes.find((r) => r.id === e.target.value); if (d) setResumeText(d.content.result || d.content.resumeText || ""); }}>
                  <option value="">…or use a saved resume</option>
                  {resumes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
                </Select>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Interview type</Label><Select value={type} onChange={(e) => setType(e.target.value as InterviewType)}>{INTERVIEW_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select></div>
              <div><Label>Difficulty</Label><Select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>{DIFFICULTIES.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</Select></div>
            </div>
          </div>

          {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

          {/* Question list */}
          {questions.length > 0 && (
            <div className="space-y-2.5">
              {questions.map((q, i) => {
                const open = expandedId === q.id;
                const fb = feedbackByQ[q.id];
                return (
                  <div key={q.id} className={cn("rounded-xl border bg-white/5 p-3.5", fb ? "border-teal/40" : "border-border-gold")}>
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 text-xs font-bold text-white/40">{i + 1}</span>
                      <div className="flex-1">
                        <div className="mb-1 flex items-center gap-2">
                          <span className="rounded-full bg-violet/20 px-2 py-0.5 text-[10px] font-bold uppercase text-violet">{q.category}</span>
                          <Dots n={q.difficulty} />
                          {fb && <span className="ml-auto text-[11px] font-semibold" style={{ color: scoreColor(fb.score) }}>{fb.score}</span>}
                        </div>
                        <p className="text-sm text-white/90">{q.text}</p>
                        <button type="button" onClick={() => setExpandedId(open ? null : q.id)} className="mt-1.5 text-xs font-semibold text-violet hover:underline">{open ? "Hide" : "Answer"}</button>
                      </div>
                    </div>
                    {open && (
                      <div className="mt-2">
                        <div className="mb-1 flex items-center justify-between">
                          <span className="text-[11px] text-white/45">{(answers[q.id] || "").length} chars</span>
                          {speechSupported && <button type="button" onClick={() => toggleRecord((t) => setAnswers((a) => ({ ...a, [q.id]: (a[q.id] ? a[q.id] + " " : "") + t })))} className={cn("inline-flex items-center gap-1 text-[11px]", recording ? "text-red-400" : "text-white/55 hover:text-cream")}><Mic className="h-3 w-3" /> {recording ? "Stop" : "Record"}</button>}
                        </div>
                        <TextArea rows={4} value={answers[q.id] || ""} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))} placeholder="Type your answer as you'd say it…" className="text-sm" />
                        <button type="button" onClick={() => getFeedback(q)} disabled={scoringId === q.id} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-violet px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
                          {scoringId === q.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquare className="h-3.5 w-3.5" />} {isPro ? "Get feedback" : "Basic feedback"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Free blur gate */}
              {lockedCount > 0 && (
                <button type="button" onClick={() => router.push("/candidate?upgrade=pro")} className="relative block w-full overflow-hidden rounded-xl border border-border-gold p-3.5 text-left">
                  <div className="space-y-2 blur-sm" aria-hidden>
                    {Array.from({ length: Math.min(3, lockedCount) }).map((_, i) => <div key={i} className="h-3 rounded bg-white/15" style={{ width: `${80 - i * 12}%` }} />)}
                  </div>
                  <div className="absolute inset-0 flex items-center justify-center gap-2 bg-navy/50 text-sm font-semibold text-white">
                    <Lock className="h-4 w-4 text-gold" /> Upgrade to see all {total} questions
                  </div>
                </button>
              )}
            </div>
          )}
        </div>

        {/* RIGHT: progress + feedback + coaching + mock */}
        <div className="min-h-0 space-y-4 overflow-y-auto bg-navy/40 p-4">
          {/* Progress tracker */}
          <div className="flex items-center gap-4 rounded-xl border border-border-gold bg-white/5 p-3.5">
            <Ring score={readiness} label={`${answeredCount}/${total || "–"}`} />
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-cream">Readiness score</div>
              <div className="font-serif text-2xl text-cream">{readiness}<span className="text-sm text-white/40">/100</span></div>
              <div className="text-xs text-white/50">{answeredCount} of {total || "–"} answered</div>
            </div>
          </div>

          {/* Feedback panel */}
          {activeFeedback ? (
            <div className="space-y-3 rounded-xl border border-border-gold bg-white/5 p-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl font-bold" style={{ color: scoreColor(activeFeedback.score) }}>{activeFeedback.score}</span>
                <span className="text-xs uppercase tracking-wide text-white/50">answer score</span>
              </div>
              {starRelevant && (
                <div className="flex flex-wrap gap-2">
                  {(["situation", "task", "action", "result"] as const).map((k) => (
                    <span key={k} className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs capitalize", activeFeedback.starCheck[k] ? "bg-teal/15 text-teal" : "bg-white/8 text-white/45")}>
                      {activeFeedback.starCheck[k] ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />} {k}
                    </span>
                  ))}
                </div>
              )}
              <FbList title="Strengths" tone="good" items={activeFeedback.strengths} />
              <FbList title="Improve" tone="bad" items={activeFeedback.improvements} />
              {activeFeedback.modelAnswer ? (
                <div><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-cream">Model answer</div><p className="rounded-lg border border-border-gold bg-navy/40 p-3 text-sm text-white/80">{activeFeedback.modelAnswer}</p></div>
              ) : !isPro ? (
                <UpgradeNote>Pro adds a model answer, STAR coaching, and detailed feedback on every answer.</UpgradeNote>
              ) : null}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border-gold p-6 text-center text-sm text-white/45">Answer a question to see scored feedback here.</div>
          )}

          {/* Coaching tips */}
          {coaching && (coaching.commonMistakes.length > 0 || coaching.topMentions.length > 0) && (
            <div className="space-y-3 rounded-xl border border-border-gold bg-white/5 p-3.5">
              {coaching.commonMistakes.length > 0 && <TipList title="Common mistakes for this role" items={coaching.commonMistakes} tone="bad" />}
              {coaching.topMentions.length > 0 && <TipList title="Top things to mention" items={coaching.topMentions} tone="good" />}
              <div>
                <button type="button" onClick={() => setBodyTipOpen((o) => !o)} className="flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wide text-muted-cream">
                  Body-language reminder <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", bodyTipOpen && "rotate-180")} />
                </button>
                {bodyTipOpen && <p className="mt-1.5 text-xs text-white/65">Sit tall, keep steady eye contact with the camera (not the screen), smile on the greeting, and pause a beat before answering — silence reads as considered, not unsure.</p>}
              </div>
            </div>
          )}

          {/* Mock interview */}
          <button type="button" onClick={startMock} className={cn("flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white transition-all", isPro ? "bg-gradient-to-r from-violet to-indigo-500 hover:shadow-[0_0_22px_rgba(139,92,246,0.4)]" : "border border-gold/50 bg-gold/10 text-gold")}>
            {isPro ? <Play className="h-4 w-4" /> : <Lock className="h-4 w-4" />} Start full mock interview
          </button>
        </div>
      </div>
    </ToolModal>
  );
}

function Ring({ score, label }: { score: number; label?: string }) {
  const deg = Math.max(0, Math.min(100, score)) * 3.6;
  const color = scoreColor(score);
  return (
    <div className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full" style={{ background: `conic-gradient(${color} ${deg}deg, rgba(255,255,255,0.1) 0deg)` }}>
      <div className="flex h-[50px] w-[50px] flex-col items-center justify-center rounded-full bg-navy">
        <span className="text-sm font-bold text-white">{label ?? score}</span>
      </div>
    </div>
  );
}

function Dots({ n }: { n: number }) {
  return (
    <span className="flex items-center gap-0.5" title={`Difficulty ${n}/3`}>
      {[1, 2, 3].map((i) => <span key={i} className={cn("h-1.5 w-1.5 rounded-full", i <= n ? "bg-gold" : "bg-white/20")} />)}
    </span>
  );
}

function FbList({ title, tone, items }: { title: string; tone: "good" | "bad"; items?: string[] }) {
  if (!items?.length) return null;
  const good = tone === "good";
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-cream">{title}</h4>
      <ul className="space-y-1.5">
        {items.map((s, i) => (
          <li key={i} className="flex gap-2 text-sm text-white/80">
            {good ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-teal" /> : <X className="mt-0.5 h-4 w-4 shrink-0 text-gold" />} {s}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TipList({ title, items, tone }: { title: string; items: string[]; tone: "good" | "bad" }) {
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-cream">{title}</h4>
      <ul className="space-y-1">
        {items.map((t, i) => <li key={i} className="text-xs text-white/70">{tone === "good" ? "✅ " : "⚠️ "}{t}</li>)}
      </ul>
    </div>
  );
}
