"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Video, Sparkles, Play, Square, Download, Film, Copy, Check, Loader2, Upload, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToolModal } from "../components/tool-modal";
import { Label, TextArea, TextInput, Select, PrimaryButton } from "../components/ui";
import {
  VIDEO_TEMPLATES,
  VIDEO_VOICES,
  GREETING_OPTIONS,
  CLOSING_OPTIONS,
  DEFAULT_GREETING,
  DEFAULT_CLOSING,
  voiceSampleUrl,
} from "@/lib/video-ai";
import type { ResumeDraft } from "@/lib/draft-types";
import { DEFAULT_VIDEO_SETTINGS, MAX_OPENER_CHARS, MAX_CLOSER_CHARS, rememberPhrase, type VideoSettings } from "@/lib/video-settings";
import { VideoSettingsPanel } from "./resume-video-settings";

/**
 * Voice dropdown with a play button beside every voice. The samples are short clips committed under
 * /voice-samples, rendered with the same ElevenLabs voice + settings as "Generate voiceover", so what you
 * audition is what the video gets. A voice whose sample file is missing simply has no play button.
 */
function VoicePicker({ value, onChange }: { value: string; onChange: (key: string) => void }) {
  const t = useTranslations("candidateTools.resumeVideo");
  const [open, setOpen] = useState(false);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [missing, setMissing] = useState<Record<string, true>>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const clipRef = useRef<HTMLAudioElement | null>(null);

  const stopClip = () => {
    clipRef.current?.pause();
    clipRef.current = null;
    setPlayingKey(null);
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => () => { clipRef.current?.pause(); }, []);

  function playSample(key: string) {
    if (playingKey === key) return stopClip();
    stopClip();
    const el = new Audio(voiceSampleUrl(key));
    clipRef.current = el;
    setPlayingKey(key);
    el.onended = () => { if (clipRef.current === el) stopClip(); };
    el.onerror = () => {
      setMissing((m) => ({ ...m, [key]: true }));
      if (clipRef.current === el) stopClip();
    };
    el.play().catch(() => {
      setMissing((m) => ({ ...m, [key]: true }));
      if (clipRef.current === el) stopClip();
    });
  }

  const current = VIDEO_VOICES.find((v) => v.key === value) || VIDEO_VOICES[0];
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-border-gold bg-white/5 px-3.5 py-2.5 text-left text-sm text-cream outline-none transition-colors focus:border-violet focus:ring-1 focus:ring-violet"
      >
        <span className="truncate">{current.label}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-white/50" />
      </button>
      {open && (
        <ul role="listbox" aria-label={t("voice")} className="absolute left-0 right-0 z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-border-gold bg-navy p-1 shadow-2xl">
          {VIDEO_VOICES.map((v) => (
            <li key={v.key} role="option" aria-selected={v.key === value} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => { onChange(v.key); stopClip(); setOpen(false); }}
                className={cn("min-w-0 flex-1 truncate rounded-lg px-3 py-2 text-left text-sm hover:bg-white/8", v.key === value ? "bg-violet/15 text-cream" : "text-white/80")}
              >
                {v.label}
              </button>
              <button
                type="button"
                onClick={() => playSample(v.key)}
                disabled={!!missing[v.key]}
                aria-label={missing[v.key] ? t("sampleUnavailable") : playingKey === v.key ? t("stopSample", { name: v.label.split("—")[0].trim() }) : t("playSample", { name: v.label.split("—")[0].trim() })}
                title={missing[v.key] ? t("sampleUnavailable") : undefined}
                className="shrink-0 rounded-lg border border-border-gold p-2 text-cream transition-colors hover:bg-white/10 disabled:opacity-30"
              >
                {playingKey === v.key ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ResumeVideoTool({ onClose, isPro }: { onClose: () => void; isPro: boolean }) {
  const t = useTranslations("candidateTools.resumeVideo");
  const router = useRouter();
  const [resumes, setResumes] = useState<ResumeDraft[]>([]);
  const [resumeText, setResumeText] = useState("");
  const [template, setTemplate] = useState("professional");
  // Video settings (voice, background colour, headshot + placement): chosen before generating, saved per user.
  const [settings, setSettings] = useState<VideoSettings>({ ...DEFAULT_VIDEO_SETTINGS });
  const voice = settings.voice;
  const [settingsReady, setSettingsReady] = useState(false);
  const [settingsSaveFailed, setSettingsSaveFailed] = useState(false);
  const savedJson = useRef<string>("");
  // Personalization (Pro): who the video is for + greeting/closing style.
  const [toWhom, setToWhom] = useState("");
  const [greeting, setGreeting] = useState(DEFAULT_GREETING);
  const [closing, setClosing] = useState(DEFAULT_CLOSING);
  const [generating, setGenerating] = useState(false);
  const [step, setStep] = useState<"script" | "voice" | "render" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // The finished video. `synced`: true = slides follow the narration's timestamps, false = fixed timing, null = no narration.
  const [mp4Url, setMp4Url] = useState<string | null>(null);
  const [synced, setSynced] = useState<boolean | null>(null);
  const runId = useRef(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [copied, setCopied] = useState(false);
  // Upload a resume file (PDF/DOCX/TXT) → extracted text fills the field.
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);

  // Resume Video is Pro-only. openTool already blocks free users, but if one
  // somehow lands here (direct state, stale bundle) send them to the upgrade flow.
  useEffect(() => {
    if (!isPro) {
      router.push("/candidate?upgrade=pro");
      onClose();
    }
  }, [isPro, router, onClose]);

  useEffect(() => {
    if (!isPro) return;
    fetch("/api/resumes", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { drafts?: ResumeDraft[] }) => setResumes(d.drafts || []))
      .catch(() => {});
  }, [isPro]);

  // Load the saved settings once, then save changes (debounced). A failed save never blocks the tool.
  useEffect(() => {
    if (!isPro) return;
    let alive = true;
    fetch("/api/resume-video/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { settings?: VideoSettings }) => {
        if (!alive) return;
        if (d.settings) { setSettings(d.settings); savedJson.current = JSON.stringify(d.settings); }
      })
      .catch(() => {})
      .finally(() => { if (alive) setSettingsReady(true); });
    return () => { alive = false; };
  }, [isPro]);

  useEffect(() => {
    if (!settingsReady) return;
    const json = JSON.stringify(settings);
    if (json === savedJson.current) return;
    const id = setTimeout(() => {
      fetch("/api/resume-video/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings }) })
        .then((r) => r.json())
        .then((d: { saved?: boolean }) => { savedJson.current = json; setSettingsSaveFailed(d.saved === false); })
        .catch(() => setSettingsSaveFailed(true));
    }, 800);
    return () => clearTimeout(id);
  }, [settings, settingsReady]);

  const tpl = VIDEO_TEMPLATES.find((t) => t.id === template) || VIDEO_TEMPLATES[0];

  // Read an uploaded PDF/DOCX/TXT into the resume field via the shared extractor.
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setUploadNote(t("errorFileTooLarge"));
      return;
    }
    setUploading(true);
    setUploadNote(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/extract-text", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok || !data.text) throw new Error(data.error || t("errorCouldNotReadFile"));
      setResumeText(data.text);
      setMp4Url(null);
      setUploadNote(t("importedFile", { file: file.name }));
    } catch (err) {
      setUploadNote(err instanceof Error ? err.message : t("errorCouldNotReadFile"));
    } finally {
      setUploading(false);
    }
  }

  // A different voice means any finished video used the old one — drop it so it can't be mistaken for current.
  function chooseVoice(key: string) {
    if (key === voice) return;
    setSettings((st) => ({ ...st, voice: key }));
    setMp4Url(null);
    setSynced(null);
  }

  async function postJson<T>(url: string, payload: unknown): Promise<{ res: Response; data: T }> {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = (await res.json().catch(() => ({}))) as T;
    return { res, data };
  }

  // One tap: script → voiceover (the voice chosen in Video settings) → rendered MP4, with no further clicks.
  // Each step feeds the next through local variables (state would still be stale), and a new run first clears
  // any previous render so an old video can never sit next to new settings.
  async function generateVideo() {
    if (!isPro) {
      router.push("/candidate?upgrade=pro");
      return;
    }
    if (resumeText.trim().length < 40) {
      setError(t("errorPasteResumeFirst"));
      return;
    }
    const run = ++runId.current;
    const live = () => alive.current && runId.current === run;
    setGenerating(true);
    setError(null);
    setNote(null);
    setMp4Url(null);
    setSynced(null);
    setStep("script");
    // Remember a typed (non-preset) opener/closer for the dropdowns next time.
    setSettings((st) => ({
      ...st,
      customOpeners: rememberPhrase(st.customOpeners, greeting, GREETING_OPTIONS, MAX_OPENER_CHARS),
      customClosers: rememberPhrase(st.customClosers, closing, CLOSING_OPTIONS, MAX_CLOSER_CHARS),
    }));
    try {
      // 1) Script
      const sc = await postJson<{ script?: string; error?: string; message?: string }>("/api/resume-video/script", {
        resume: resumeText,
        template,
        to: toWhom.trim(),
        greeting: greeting.trim() || DEFAULT_GREETING,
        closing: closing.trim() || DEFAULT_CLOSING,
      });
      if (!live()) return;
      if (sc.res.status === 402) return void router.push("/candidate?upgrade=pro");
      if (!sc.res.ok || !sc.data.script) throw new Error(sc.data.message || sc.data.error || t("errorCouldNotGenerateScript"));
      const script = sc.data.script;

      // 2) Voiceover with the chosen voice. If narration is unavailable the video is still rendered, without it.
      setStep("voice");
      let audio: string | undefined;
      let starts: number[] | null = null;
      const vo = await postJson<{ audio?: string; sceneStarts?: number[] | null; aligned?: boolean; error?: string; message?: string }>("/api/resume-video/voiceover", {
        script, voice, template, title: "Resume video",
      });
      if (!live()) return;
      if (vo.res.status === 402) return void router.push("/candidate?upgrade=pro");
      if (vo.res.ok && vo.data.audio) {
        audio = vo.data.audio;
        starts = vo.data.aligned && Array.isArray(vo.data.sceneStarts) ? vo.data.sceneStarts : null;
      } else {
        setNote(t("voiceoverSkipped"));
      }

      // 3) Render the MP4 (slides flip at the spoken times when the voiceover came back with timestamps).
      setStep("render");
      const mp = await postJson<{ success?: boolean; videoUrl?: string; error?: string; message?: string }>("/api/resume-video/mp4", {
        script,
        resume: resumeText,
        style: tpl.accent,
        audioUrl: audio,
        sceneStarts: audio && starts ? starts : undefined,
        settings,
        title: "Resume video",
      });
      if (!live()) return;
      if (mp.res.status === 402 || mp.data.error === "pro_required") return void router.push("/candidate?upgrade=pro");
      if (!mp.res.ok || !mp.data.success || !mp.data.videoUrl) throw new Error(mp.data.message || mp.data.error || t("errorVideoRenderFailed"));
      setMp4Url(mp.data.videoUrl);
      setSynced(audio ? !!starts : null);
    } catch (e) {
      if (live()) setError(e instanceof Error ? e.message : t("errorGeneric"));
    } finally {
      if (live()) { setGenerating(false); setStep(null); }
    }
  }

  async function copyMp4Link() {
    if (!mp4Url) return;
    try {
      await navigator.clipboard.writeText(mp4Url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — the link is still visible in the button */
    }
  }

  // Pro-only tool. The effect above redirects free users; render nothing for the
  // frame before that navigation lands so the form never flashes.
  if (!isPro) return null;

  const footer = (
    <>
      <span className="mr-auto hidden text-xs text-white/45 sm:block">{t("proFullGeneration")}</span>
      <PrimaryButton onClick={generateVideo} loading={generating}>
        <Sparkles className="h-4 w-4" /> {mp4Url ? t("regenerateVideo") : t("generateVideo")}
      </PrimaryButton>
    </>
  );

  return (
    <ToolModal title={t("title")} icon={Video} onClose={onClose} footer={footer}>
      <div className="grid h-full grid-cols-1 lg:grid-cols-2">
        {/* Left: inputs */}
        <div className="min-h-0 space-y-4 overflow-y-auto border-b border-border-gold p-4 lg:border-b-0 lg:border-r">
          {resumes.length > 0 && (
            <div>
              <Label>{t("useSavedResume")}</Label>
              <Select
                value=""
                onChange={(e) => {
                  const d = resumes.find((r) => r.id === e.target.value);
                  if (d) setResumeText(d.content.result || d.content.resumeText || "");
                }}
              >
                <option value="">{t("pickOnePlaceholder")}</option>
                {resumes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
              </Select>
            </div>
          )}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <Label>{t("resumeText")}</Label>
              <input ref={fileRef} type="file" accept=".txt,.pdf,.docx,.doc,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden onChange={onFile} />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border-gold px-2.5 py-1.5 text-xs font-medium text-cream transition-colors hover:bg-white/8 disabled:opacity-50"
              >
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} {t("uploadResume")}
              </button>
            </div>
            <TextArea rows={7} value={resumeText} onChange={(e) => setResumeText(e.target.value)} placeholder={t("resumeTextPlaceholder")} />
            {uploadNote && <p className="mt-1.5 text-xs text-white/55">{uploadNote}</p>}
          </div>
          <div>
            <Label>{t("style")}</Label>
            <Select value={template} onChange={(e) => setTemplate(e.target.value)}>
              {VIDEO_TEMPLATES.map((vt) => <option key={vt.id} value={vt.id}>{t(`templates.${vt.id}` as "templates.professional")}</option>)}
            </Select>
          </div>

          {/* Video settings — chosen before generating; they apply to the script, voiceover and the MP4. */}
          <VideoSettingsPanel
            settings={settings}
            onChange={(patch) => {
              if (patch.voice !== undefined && patch.voice !== settings.voice) return chooseVoice(patch.voice);
              setSettings((st) => ({ ...st, ...patch }));
            }}
            voicePicker={<VoicePicker value={voice} onChange={chooseVoice} />}
            saveFailed={settingsSaveFailed}
          />

          {/* Personalize — who the video is for + greeting/closing style. */}
          <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-violet" />
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-cream">{t("personalize")}</h4>
            </div>
            <div>
              <Label>{t("whoIsThisFor")}</Label>
              <TextInput
                value={toWhom}
                onChange={(e) => setToWhom(e.target.value)}
                placeholder={t("whoIsThisForPlaceholder")}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label>{t("howStart")}</Label>
                <TextInput list="rv-greetings" value={greeting} onChange={(e) => setGreeting(e.target.value)} placeholder={DEFAULT_GREETING} maxLength={MAX_OPENER_CHARS} />
                {/* The user's own saved openers come first, tagged "yours"; then the built-in presets. */}
                <datalist id="rv-greetings">
                  {settings.customOpeners.map((o) => <option key={`mine-${o}`} value={o} label={`${o} · ${t("yours")}`} />)}
                  {GREETING_OPTIONS.map((o) => <option key={o} value={o} />)}
                </datalist>
              </div>
              <div>
                <Label>{t("howClose")}</Label>
                <TextInput list="rv-closings" value={closing} onChange={(e) => setClosing(e.target.value)} placeholder={DEFAULT_CLOSING} maxLength={MAX_CLOSER_CHARS} />
                <datalist id="rv-closings">
                  {settings.customClosers.map((o) => <option key={`mine-${o}`} value={o} label={`${o} · ${t("yours")}`} />)}
                  {CLOSING_OPTIONS.map((o) => <option key={o} value={o} />)}
                </datalist>
              </div>
            </div>
            <p className="text-[11px] text-white/45">
              {t("personalizeNote")}
            </p>
          </div>

          {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
        </div>

        {/* Right: the one video player — progress while generating, then the finished video with Download / Share. */}
        <div className="min-h-0 space-y-4 overflow-y-auto bg-navy/40 p-4">
          <div className="rounded-xl border border-white/10 bg-navy/60 p-4">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet to-indigo-500">
                <Film className="h-4 w-4 text-white" />
              </span>
              <h4 className="text-sm font-semibold text-white">{t("fullVideoMp4")}</h4>
            </div>

            <div className="mt-3 overflow-hidden rounded-lg border border-white/10 bg-black">
              {mp4Url ? (
                <video key={mp4Url} src={mp4Url} controls className="aspect-video w-full" />
              ) : (
                <div className="flex aspect-video flex-col items-center justify-center gap-2 p-6 text-center text-sm text-white/55" aria-live="polite">
                  {generating ? (
                    <>
                      <Loader2 className="h-6 w-6 animate-spin text-violet" />
                      <span className="font-medium text-white/80">{t("generatingVideo")}</span>
                      <span className="text-xs text-white/45">{step === "voice" ? t("stepVoice") : step === "render" ? t("stepRender") : t("stepScript")}</span>
                    </>
                  ) : (
                    <>{t("playerEmpty")}</>
                  )}
                </div>
              )}
            </div>

            {mp4Url && synced !== null && <p className="mt-2 text-[11px] text-white/45">{synced ? t("slidesSynced") : t("slidesFixedTiming")}</p>}
            {note && <p className="mt-2 text-[11px] text-amber-300/80">{note}</p>}

            {mp4Url && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <a
                  href={mp4Url}
                  download="resume-video.mp4"
                  className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-white/15"
                >
                  <Download className="h-4 w-4" /> {t("downloadMp4")}
                </a>
                <button
                  type="button"
                  onClick={copyMp4Link}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-white/5"
                >
                  {copied ? <><Check className="h-4 w-4 text-teal" /> {t("copied")}</> : <><Copy className="h-4 w-4" /> {t("copyLink")}</>}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </ToolModal>
  );
}
