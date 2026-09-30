"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { GraduationCap, PlayCircle, FileText, ExternalLink, Loader2, CheckCircle2, XCircle, ChevronLeft } from "lucide-react";
import { complianceState, COMPLIANCE_TONE, type Acknowledgment, type TrainingLibraryItem } from "@/lib/employee-hub";
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
  const t = useTranslations("employeeTraining");
  const tc = useTranslations("employeeCommon");
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
        <h1 className="font-serif text-3xl font-medium text-cream">{t("title")}</h1>
        <p className="mt-1 text-sm text-white/60">{t("subtitle")}</p>
      </header>

      {loading ? (
        <div className="glass flex items-center gap-2 px-5 py-8 text-sm text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}
        </div>
      ) : items.length === 0 ? (
        <div className="glass flex flex-col items-center gap-2 px-5 py-12 text-center text-sm text-white/50">
          <GraduationCap className="h-7 w-7 text-white/25" />
          {t("empty")}
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
                      {["sop", "safety", "policy", "training"].includes(doc.docKind) ? t(`docKinds.${doc.docKind}`) : doc.docKind}
                      {hasQuiz ? ` · ${t("quizTag")}` : ""}
                      {typeof ack.score === "number" ? ` · ${t("best", { score: ack.score })}` : ""}
                    </div>
                  </div>
                  <span className={`inline-flex shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${TONE_STYLE[COMPLIANCE_TONE[state]]}`}>{t(`states.${state}`)}</span>
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
  const t = useTranslations("employeeTraining");
  const tc = useTranslations("employeeCommon");
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
        <ChevronLeft className="h-4 w-4" /> {t("back")}
      </button>

      {loading ? (
        <div className="glass flex items-center gap-2 px-5 py-8 text-sm text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" /> {tc("loading")}
        </div>
      ) : !detail ? (
        <div className="glass px-5 py-8 text-sm text-white/50">{t("notFound")}</div>
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
                <ExternalLink className="h-3 w-3" /> {t("source", { provider: detail.libraryItem.provider })}
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
              <FileText className="h-4 w-4" /> {t("openPdf")}
            </a>
          )}

          {detail.ack.status === "signed" ? (
            <div className="glass flex items-center gap-2 px-5 py-4 text-sm text-teal">
              <CheckCircle2 className="h-5 w-5" /> {typeof detail.ack.score === "number" ? t("completedWithScore", { score: detail.ack.score }) : t("completed")}
            </div>
          ) : detail.quiz ? (
            <Quiz docId={docId} quiz={detail.quiz} onPassed={load} />
          ) : (
            <button
              onClick={markComplete}
              disabled={taking}
              className="inline-flex items-center gap-2 rounded-lg bg-violet px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-violet/90 disabled:opacity-50"
            >
              {taking && <Loader2 className="h-4 w-4 animate-spin" />} {t("markComplete")}
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
  const t = useTranslations("employeeTraining");
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
        <PlayCircle className="h-4 w-4" /> {t("takeQuiz", { count: quiz.questions.length, threshold: quiz.passThreshold })}
      </button>
    );
  }

  if (result) {
    return (
      <div className="glass space-y-3 px-5 py-5">
        <div className={`flex items-center gap-2 text-sm font-semibold ${result.passed ? "text-teal" : "text-red-300"}`}>
          {result.passed ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
          {result.passed ? t("passed", { score: result.score }) : t("notYet", { score: result.score, threshold: quiz.passThreshold })}
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
            {t("retake")}
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
        {submitting && <Loader2 className="h-4 w-4 animate-spin" />} {t("submit")}
      </button>
    </div>
  );
}
