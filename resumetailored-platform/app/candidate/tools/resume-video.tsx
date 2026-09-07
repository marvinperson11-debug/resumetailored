"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Video, Sparkles, Play, Pause, Download, Volume2, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { ToolModal } from "../components/tool-modal";
import { Label, TextArea, Select, PrimaryButton, SecondaryButton, UpgradeNote } from "../components/ui";
import { VIDEO_TEMPLATES, VIDEO_VOICES, parseScriptScenes } from "@/lib/video-ai";
import type { ResumeDraft } from "@/lib/draft-types";

export function ResumeVideoTool({ onClose, isPro }: { onClose: () => void; isPro: boolean }) {
  const router = useRouter();
  const [resumes, setResumes] = useState<ResumeDraft[]>([]);
  const [resumeText, setResumeText] = useState("");
  const [template, setTemplate] = useState("professional");
  const [voice, setVoice] = useState("rachel");
  const [script, setScript] = useState("");
  const [loading, setLoading] = useState(false);
  const [voicing, setVoicing] = useState(false);
  const [audio, setAudio] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    fetch("/api/resumes", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { drafts?: ResumeDraft[] }) => setResumes(d.drafts || []))
      .catch(() => {});
  }, []);

  const tpl = VIDEO_TEMPLATES.find((t) => t.id === template) || VIDEO_TEMPLATES[0];
  const scenes = parseScriptScenes(script);

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
        body: JSON.stringify({ resume: resumeText, template }),
      });
      const data = (await res.json().catch(() => ({}))) as { script?: string; error?: string; message?: string };
      if (!res.ok || !data.script) throw new Error(data.message || data.error || "Could not generate the script.");
      setScript(data.script);
      setAudio(null);
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

  const footer = (
    <>
      <span className="mr-auto hidden text-xs text-white/45 sm:block">{isPro ? "Pro · full generation" : "Free · script + preview"}</span>
      <PrimaryButton onClick={genScript} loading={loading}>
        <Sparkles className="h-4 w-4" /> {script ? "Regenerate script" : "Generate script"}
      </PrimaryButton>
      {script && (
        <PrimaryButton onClick={genVoiceover} loading={voicing} className={cn(!isPro && "bg-gold text-navy hover:shadow-none")}>
          {isPro ? <Video className="h-4 w-4" /> : <Lock className="h-4 w-4" />} Generate voiceover
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
            <Label>Resume text</Label>
            <TextArea rows={7} value={resumeText} onChange={(e) => setResumeText(e.target.value)} placeholder="Paste your resume, or pick a saved one above…" />
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
          {script && (
            <div>
              <Label>Script (editable)</Label>
              <TextArea rows={8} value={script} onChange={(e) => { setScript(e.target.value); setAudio(null); }} className="font-mono text-[13px]" />
            </div>
          )}
          {!isPro && script && <UpgradeNote>Pro generates the AI voiceover and lets you download the video.</UpgradeNote>}
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
