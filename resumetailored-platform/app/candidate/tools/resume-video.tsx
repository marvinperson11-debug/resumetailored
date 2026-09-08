"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Video, Sparkles, Play, Pause, Download, Volume2, Lock, Film, Copy, Check, Loader2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToolModal } from "../components/tool-modal";
import { Label, TextArea, TextInput, Select, PrimaryButton, SecondaryButton } from "../components/ui";
import {
  VIDEO_TEMPLATES,
  VIDEO_VOICES,
  parseScriptScenes,
  GREETING_OPTIONS,
  CLOSING_OPTIONS,
  DEFAULT_GREETING,
  DEFAULT_CLOSING,
} from "@/lib/video-ai";
import type { ResumeDraft } from "@/lib/draft-types";

export function ResumeVideoTool({ onClose, isPro }: { onClose: () => void; isPro: boolean }) {
  const router = useRouter();
  const [resumes, setResumes] = useState<ResumeDraft[]>([]);
  const [resumeText, setResumeText] = useState("");
  const [template, setTemplate] = useState("professional");
  const [voice, setVoice] = useState("rachel");
  // Personalization (Pro): who the video is for + greeting/closing style.
  const [toWhom, setToWhom] = useState("");
  const [greeting, setGreeting] = useState(DEFAULT_GREETING);
  const [closing, setClosing] = useState(DEFAULT_CLOSING);
  const [script, setScript] = useState("");
  const [loading, setLoading] = useState(false);
  const [voicing, setVoicing] = useState(false);
  const [audio, setAudio] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  // Full-video (MP4) render — additional to the MP3 voiceover flow above.
  const [mp4Url, setMp4Url] = useState<string | null>(null);
  const [mp4Loading, setMp4Loading] = useState(false);
  const [mp4Error, setMp4Error] = useState<string | null>(null);
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

  const tpl = VIDEO_TEMPLATES.find((t) => t.id === template) || VIDEO_TEMPLATES[0];
  const scenes = parseScriptScenes(script);

  // Read an uploaded PDF/DOCX/TXT into the resume field via the shared extractor.
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setUploadNote("That file is too large (max 10MB).");
      return;
    }
    setUploading(true);
    setUploadNote(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/extract-text", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok || !data.text) throw new Error(data.error || "Could not read that file.");
      setResumeText(data.text);
      setScript("");
      setAudio(null);
      setMp4Url(null);
      setUploadNote(`Imported “${file.name}”. Review the text before generating.`);
    } catch (err) {
      setUploadNote(err instanceof Error ? err.message : "Could not read that file.");
    } finally {
      setUploading(false);
    }
  }

  async function genScript() {
    if (resumeText.trim().length < 40) {
      setError("Paste your resume or pick a saved one first.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/resume-video/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resume: resumeText,
          template,
          to: toWhom.trim(),
          greeting: greeting.trim() || DEFAULT_GREETING,
          closing: closing.trim() || DEFAULT_CLOSING,
        }),
      });
      if (res.status === 402) {
        router.push("/candidate?upgrade=pro");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { script?: string; error?: string; message?: string };
      if (!res.ok || !data.script) throw new Error(data.message || data.error || "Could not generate the script.");
      setScript(data.script);
      setAudio(null);
      setMp4Url(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function genVoiceover() {
    if (!isPro) {
      router.push("/candidate?upgrade=pro");
      return;
    }
    if (!script.trim()) {
      setError("Generate or write a script first.");
      return;
    }
    setVoicing(true);
    setError(null);
    try {
      const res = await fetch("/api/resume-video/voiceover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script, voice, template, title: "Resume video" }),
      });
      const data = (await res.json().catch(() => ({}))) as { audio?: string; error?: string; message?: string };
      if (res.status === 402) {
        router.push("/candidate?upgrade=pro");
        return;
      }
      if (!res.ok || !data.audio) throw new Error(data.message || data.error || "Voice generation failed.");
      setAudio(data.audio);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setVoicing(false);
    }
  }

  // Free "preview voice" via the browser's built-in speech synth.
  function browserPreview() {
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(scenes.map((s) => s.text).join(" ") || script);
      u.rate = 1;
      synth.speak(u);
    } catch {
      /* ignore */
    }
  }

  function togglePlay() {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      el.play();
      setPlaying(true);
    } else {
      el.pause();
      setPlaying(false);
    }
  }

  function downloadAudio() {
    if (!audio) return;
    const a = document.createElement("a");
    a.href = audio;
    a.download = "resume-video-voiceover.mp3";
    a.click();
  }

  // Render a real, downloadable MP4 by proxying to the legacy site's Remotion
  // renderer. Pro-only; free users are routed to the upgrade flow. The MP3
  // voiceover flow above is untouched — this is additional.
  async function handleGenerateMp4() {
    if (!isPro) {
      router.push("/candidate?upgrade=pro");
      return;
    }
    if (!script.trim()) {
      setMp4Error("Generate or write a script first.");
      return;
    }
    setMp4Loading(true);
    setMp4Error(null);
    setMp4Url(null);
    try {
      const res = await fetch("/api/resume-video/mp4", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script,
          resume: resumeText,
          style: tpl.accent, // accent hex — the legacy renderer accepts a hex or a style key
          audioUrl: audio || undefined, // reuse the ElevenLabs MP3 if one was generated
          title: "Resume video",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { success?: boolean; videoUrl?: string; error?: string; message?: string };
      if (res.status === 402 || data.error === "pro_required") {
        router.push("/candidate?upgrade=pro");
        return;
      }
      if (!res.ok || !data.success || !data.videoUrl) {
        throw new Error(data.message || data.error || "The video could not be rendered.");
      }
      setMp4Url(data.videoUrl);
    } catch (e) {
      setMp4Error(e instanceof Error ? e.message : "Something went wrong rendering the video.");
    } finally {
      setMp4Loading(false);
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
      <span className="mr-auto hidden text-xs text-white/45 sm:block">Pro · full generation</span>
      <PrimaryButton onClick={genScript} loading={loading}>
        <Sparkles className="h-4 w-4" /> {script ? "Regenerate script" : "Generate script"}
      </PrimaryButton>
      {script && (
        <PrimaryButton onClick={genVoiceover} loading={voicing}>
          <Video className="h-4 w-4" /> Generate voiceover
        </PrimaryButton>
      )}
    </>
  );

  return (
    <ToolModal title="Resume Video" icon={Video} onClose={onClose} footer={footer}>
      <div className="grid h-full grid-cols-1 lg:grid-cols-2">
        {/* Left: inputs */}
        <div className="min-h-0 space-y-4 overflow-y-auto border-b border-border-gold p-4 lg:border-b-0 lg:border-r">
          {resumes.length > 0 && (
            <div>
              <Label>Use a saved resume</Label>
              <Select
                value=""
                onChange={(e) => {
                  const d = resumes.find((r) => r.id === e.target.value);
                  if (d) setResumeText(d.content.result || d.content.resumeText || "");
                }}
              >
                <option value="">— Pick one (or paste below) —</option>
                {resumes.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
              </Select>
            </div>
          )}
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <Label>Resume text</Label>
              <input ref={fileRef} type="file" accept=".txt,.pdf,.docx,.doc,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden onChange={onFile} />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border-gold px-2.5 py-1.5 text-xs font-medium text-cream transition-colors hover:bg-white/8 disabled:opacity-50"
              >
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload resume
              </button>
            </div>
            <TextArea rows={7} value={resumeText} onChange={(e) => setResumeText(e.target.value)} placeholder="Upload a .pdf, .docx, or .txt above, paste your resume, or pick a saved one…" />
            {uploadNote && <p className="mt-1.5 text-xs text-white/55">{uploadNote}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Style</Label>
              <Select value={template} onChange={(e) => setTemplate(e.target.value)}>
                {VIDEO_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </Select>
            </div>
            <div>
              <Label>Voice</Label>
              <Select value={voice} onChange={(e) => setVoice(e.target.value)}>
                {VIDEO_VOICES.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
              </Select>
            </div>
          </div>

          {/* Personalize — who the video is for + greeting/closing style. */}
          <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-violet" />
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-cream">Personalize</h4>
            </div>
            <div>
              <Label>Who is this video for? (optional)</Label>
              <TextInput
                value={toWhom}
                onChange={(e) => setToWhom(e.target.value)}
                placeholder="e.g. Hiring Manager, Sarah Johnson, Team at Google"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label>How do you want to start?</Label>
                <TextInput list="rv-greetings" value={greeting} onChange={(e) => setGreeting(e.target.value)} placeholder={DEFAULT_GREETING} />
                <datalist id="rv-greetings">
                  {GREETING_OPTIONS.map((o) => <option key={o} value={o} />)}
                </datalist>
              </div>
              <div>
                <Label>How do you want to close?</Label>
                <TextInput list="rv-closings" value={closing} onChange={(e) => setClosing(e.target.value)} placeholder={DEFAULT_CLOSING} />
                <datalist id="rv-closings">
                  {CLOSING_OPTIONS.map((o) => <option key={o} value={o} />)}
                </datalist>
              </div>
            </div>
            <p className="text-[11px] text-white/45">
              Used at the open and close of your script — pick a preset or type your own.
            </p>
          </div>

          {script && (
            <div>
              <Label>Script (editable)</Label>
              <TextArea rows={8} value={script} onChange={(e) => { setScript(e.target.value); setAudio(null); setMp4Url(null); }} className="font-mono text-[13px]" />
            </div>
          )}
          {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
        </div>

        {/* Right: preview */}
        <div className="min-h-0 space-y-4 overflow-y-auto bg-navy/40 p-4">
          {scenes.length ? (
            <>
              {/* Animated caption preview in the chosen style. */}
              <div className="overflow-hidden rounded-xl" style={{ background: `linear-gradient(135deg, ${tpl.accent}, #0b0f19)` }}>
                <div className="flex aspect-video flex-col items-center justify-center gap-3 p-6 text-center">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/60">{tpl.label} · Resume Video</span>
                  {scenes.map((s, i) => (
                    <p key={i} className={cn("leading-snug text-white", i === 0 ? "text-lg font-bold" : "text-sm text-white/85")}>{s.text}</p>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <SecondaryButton onClick={browserPreview}><Volume2 className="h-4 w-4" /> Preview voice (browser)</SecondaryButton>
                {audio && (
                  <>
                    <SecondaryButton onClick={togglePlay}>{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />} {playing ? "Pause" : "Play voiceover"}</SecondaryButton>
                    <SecondaryButton onClick={downloadAudio}><Download className="h-4 w-4" /> Download MP3</SecondaryButton>
                  </>
                )}
              </div>
              {audio && <audio ref={audioRef} src={audio} onEnded={() => setPlaying(false)} className="w-full" controls />}

              {/* Full video (MP4) — real downloadable file, rendered server-side. */}
              <div className="rounded-xl border border-white/10 bg-navy/60 p-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet to-indigo-500">
                    <Film className="h-4 w-4 text-white" />
                  </span>
                  <div>
                    <h4 className="text-sm font-semibold text-white">Full Video (MP4)</h4>
                    <p className="text-[11px] text-white/50">
                      {isPro
                        ? "Render a shareable MP4 — your captions, style, and voiceover muxed into one file."
                        : "Pro renders a real, downloadable MP4 you can post to LinkedIn, Shorts, or Reels."}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleGenerateMp4}
                  disabled={mp4Loading}
                  className={cn(
                    "mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition-all",
                    "bg-gradient-to-r from-violet to-indigo-500 hover:shadow-[0_0_22px_rgba(139,92,246,0.4)]",
                    mp4Loading && "cursor-not-allowed opacity-70"
                  )}
                >
                  {mp4Loading ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Rendering… (this can take a minute)</>
                  ) : isPro ? (
                    <><Film className="h-4 w-4" /> {mp4Url ? "Re-render MP4" : "Generate MP4"}</>
                  ) : (
                    <><Lock className="h-4 w-4" /> Generate MP4</>
                  )}
                </button>

                {mp4Error && (
                  <p className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{mp4Error}</p>
                )}

                {mp4Url && (
                  <div className="mt-3 space-y-2">
                    <video src={mp4Url} controls className="w-full rounded-lg border border-white/10 bg-black" />
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={mp4Url}
                        download="resume-video.mp4"
                        className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-white/15"
                      >
                        <Download className="h-4 w-4" /> Download MP4
                      </a>
                      <button
                        type="button"
                        onClick={copyMp4Link}
                        className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-white/5"
                      >
                        {copied ? <><Check className="h-4 w-4 text-teal" /> Copied</> : <><Copy className="h-4 w-4" /> Copy Link</>}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex h-full min-h-[300px] items-center justify-center rounded-xl border border-dashed border-border-gold p-8 text-center text-sm text-white/45">
              Generate a script to see your video preview, then (Pro) add an AI voiceover.
            </div>
          )}
        </div>
      </div>
    </ToolModal>
  );
}
