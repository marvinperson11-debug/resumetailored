"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { GraduationCap, PlayCircle, FileText, ExternalLink, Loader2, CheckCircle2, XCircle, ChevronLeft } from "lucide-react";
import { complianceState, COMPLIANCE_TONE, DOC_KIND_LABELS, type Acknowledgment, type TrainingLibraryItem } from "@/lib/employee-hub";
import type { QuizQuestionPublic } from "@/lib/quiz-hub";

const TONE_STYLE: Record<string, string> = {
  teal: "bg-teal/20 text-teal",
  gold: "bg-gold/20 text-gold",
  red: "bg-red-500/20 text-red-300",
  neutral: "bg-white/10 text-white/60",
};

interface ListItem {
  doc: { id: number; title: string; docKind: string; libraryItemId: number | null };
  ack: Acknowledgment;
  hasQuiz: boolean;
}
interface DocDetail {
  doc: { id: number; title: string; docKind: string; bodyHtml: string; pdfUrl: string | null };
  ack: Acknowledgment;
  libraryItem: TrainingLibraryItem | null;
  quiz: { questions: QuizQuestionPublic[]; passThreshold: number } | null;
}

/** Employee "My training": watch/read assigned content, then mark it
 *  complete or take its quiz — entirely in-house, no DocuSign. */
export function TrainingClient() {
  const searchParams = useSearchParams();
  const [items, setItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/employee/training").then((r) => r.json()).catch(() => ({}));
    setItems(res.items || []);
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const open = searchParams.get("open");
    if (open) setOpenId(Number(open));
  }, [searchParams]);

  if (openId !== null) return <TrainingDetail docId={openId} onBack={() => { setOpenId(null); load(); }} />;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="font-serif text-3xl font-medium text-cream">My training</h1>
        <p className="mt-1 text-sm text-white/60">Watch, read, and complete what&apos;s assigned to you.</p>
      </header>

      {loading ? (
        <div className="glass flex items-center gap-2 px-5 py-8 text-sm text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : items.length === 0 ? (
        <div className="glass flex flex-col items-center gap-2 px-5 py-12 text-center text-sm text-white/50">
          <GraduationCap className="h-7 w-7 text-white/25" />
          Nothing assigned yet. Check the Library tab to take something yourself.
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map(({ doc, ack, hasQuiz }) => {
            const state = complianceState(ack);
            return (
              <li key={doc.id}>
                <button onClick={() => setOpenId(doc.id)} className="glass flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:-translate-y-0.5">
                  <div className="min-w-0">
                    <div className="font-medium text-cream">{doc.title}</div>
                    <div className="text-xs text-white/40">
                      {DOC_KIND_LABELS[doc.docKind as keyof typeof DOC_KIND_LABELS] || doc.docKind}
                      {hasQuiz ? " · quiz" : ""}
                      {typeof ack.score === "number" ? ` · best ${ack.score}%` : ""}
                    </div>
                  </div>
                  <span className={`inline-flex shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${TONE_STYLE[COMPLIANCE_TONE[state]]}`}>{state}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function TrainingDetail({ docId, onBack }: { docId: number; onBack: () => void }) {
  const [detail, setDetail] = useState<DocDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [taking, setTaking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/employee/training/${docId}`).then((r) => r.json()).catch(() => ({}));
    setDetail(res.doc ? res : null);
    setLoading(false);
  }, [docId]);
  useEffect(() => {
    load();
  }, [load]);

  async function markComplete() {
    setTaking(true);
    try {
      await fetch(`/api/employee/training/${docId}/complete`, { method: "POST" });
      await load();
    } finally {
      setTaking(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-white/60 hover:text-cream">
        <ChevronLeft className="h-4 w-4" /> My training
      </button>

      {loading ? (
        <div className="glass flex items-center gap-2 px-5 py-8 text-sm text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : !detail ? (
        <div className="glass px-5 py-8 text-sm text-white/50">Not found.</div>
      ) : (
        <div className="space-y-5">
          <h1 className="font-serif text-2xl font-medium text-cream">{detail.doc.title}</h1>

          {detail.libraryItem?.kind === "video" && detail.libraryItem.embedUrl ? (
            <div>
              <div className="aspect-video overflow-hidden rounded-xl border border-border-gold bg-black">
                <iframe
                  src={detail.libraryItem.embedUrl}
                  title={detail.doc.title}
                  className="h-full w-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
              <a href={detail.libraryItem.sourceUrl} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-xs text-white/40 hover:text-cream">
                <ExternalLink className="h-3 w-3" /> Source: {detail.libraryItem.provider}
              </a>
            </div>
          ) : (
            <div
              className="prose-training glass max-h-96 overflow-y-auto px-5 py-4 text-sm text-white/80 [&_h2]:mb-1 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-cream [&_li]:ml-4 [&_li]:list-disc [&_p]:mb-2 [&_ul]:mb-2"
              dangerouslySetInnerHTML={{ __html: detail.doc.bodyHtml || "" }}
            />
          )}

          {detail.doc.pdfUrl && (
            <a href={detail.doc.pdfUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-violet hover:underline">
              <FileText className="h-4 w-4" /> Open PDF
            </a>
          )}

          {detail.ack.status === "signed" ? (
            <div className="glass flex items-center gap-2 px-5 py-4 text-sm text-teal">
              <CheckCircle2 className="h-5 w-5" /> Completed{typeof detail.ack.score === "number" ? ` — quiz score ${detail.ack.score}%` : ""}.
            </div>
          ) : detail.quiz ? (
            <Quiz docId={docId} quiz={detail.quiz} onPassed={load} />
          ) : (
            <button
              onClick={markComplete}
              disabled={taking}
              className="inline-flex items-center gap-2 rounded-lg bg-violet px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-violet/90 disabled:opacity-50"
            >
              {taking && <Loader2 className="h-4 w-4 animate-spin" />} Mark complete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Quiz({
  docId,
  quiz,
  onPassed,
}: {
  docId: number;
  quiz: { questions: QuizQuestionPublic[]; passThreshold: number };
  onPassed: () => void;
}) {
  const [started, setStarted] = useState(false);
  const [answers, setAnswers] = useState<number[]>(() => quiz.questions.map(() => -1));
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ score: number; passed: boolean; correct: boolean[] } | null>(null);

  async function submit() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/employee/training/${docId}/quiz`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const d = await res.json().catch(() => ({}));
      setResult({ score: d.score ?? 0, passed: !!d.passed, correct: d.correct || [] });
      if (d.passed) onPassed();
    } finally {
      setSubmitting(false);
    }
  }

  function retake() {
    setResult(null);
    setAnswers(quiz.questions.map(() => -1));
  }

  if (!started) {
    return (
      <button
        onClick={() => setStarted(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-violet px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-violet/90"
      >
        <PlayCircle className="h-4 w-4" /> Take the quiz ({quiz.questions.length} question{quiz.questions.length === 1 ? "" : "s"}, {quiz.passThreshold}% to pass)
      </button>
    );
  }

  if (result) {
    return (
      <div className="glass space-y-3 px-5 py-5">
        <div className={`flex items-center gap-2 text-sm font-semibold ${result.passed ? "text-teal" : "text-red-300"}`}>
          {result.passed ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
          {result.passed ? `Passed — ${result.score}%` : `Not yet — ${result.score}% (need ${quiz.passThreshold}%)`}
        </div>
        <ul className="space-y-1.5 text-sm">
          {quiz.questions.map((q, i) => (
            <li key={i} className="flex items-start gap-2">
              {result.correct[i] ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-teal" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />}
              <span className="text-white/75">{q.q}</span>
            </li>
          ))}
        </ul>
        {!result.passed && (
          <button onClick={retake} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/70 transition hover:bg-white/5">
            Retake
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="glass space-y-4 px-5 py-5">
      {quiz.questions.map((q, qi) => (
        <div key={qi}>
          <p className="mb-1.5 text-sm font-medium text-cream">{qi + 1}. {q.q}</p>
          <div className="space-y-1">
            {q.choices.map((c, ci) => (
              <label key={ci} className="flex items-center gap-2 text-sm text-white/75">
                <input
                  type="radio"
                  name={`q${qi}`}
                  checked={answers[qi] === ci}
                  onChange={() => setAnswers((a) => a.map((v, i) => (i === qi ? ci : v)))}
                  className="accent-violet"
                />
                {c}
              </label>
            ))}
          </div>
        </div>
      ))}
      <button
        onClick={submit}
        disabled={submitting || answers.some((a) => a < 0)}
        className="inline-flex items-center gap-2 rounded-lg bg-violet px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-violet/90 disabled:opacity-50"
      >
        {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Submit
      </button>
    </div>
  );
}
