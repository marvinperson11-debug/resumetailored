"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Send, Bot, User, Mic, MicOff, Volume2 } from "lucide-react";
import { PageHeader, Panel, Btn, Input } from "../components/ui";
import { regionTag } from "@/lib/format";
import { PendingActionsInbox } from "@/components/assistant/PendingActionsInbox";
import { isCoarsePointer, isVoiceInputSupported } from "@/components/assistant/voice-support";
import { useVoiceInput } from "@/components/assistant/useVoiceInput";
import { useVoiceOutput } from "@/components/assistant/useVoiceOutput";
import { VoiceSettingsPopover } from "@/components/assistant/VoiceSettingsPopover";

const MIC_HINT_SEEN_KEY = "rt_voice_mic_hint_seen";

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  /** Markdown-stripped, length-capped text for TTS — only ever populated
   *  for messages fetched through the voice-chat route (canVoice
   *  employers); undefined for the plain-text route, which has no use for
   *  it. */
  spoken?: string;
}

export interface AssistantClientProps {
  /** Voice Mode (mic + spoken replies + persona) — Scale tier and up
   *  (lib/employer-plan.ts `canUseVoiceMode`). Everything in this component
   *  behind this flag is additive; a Portal-tier employer's chat is exactly
   *  what it was before this feature existed. */
  canVoice: boolean;
  initialAssistantName: string | null;
  initialVoiceIntroduced: boolean;
  initialTtsVoice: string | null;
  initialTtsRate: number | null;
}

/**
 * The Employer Portal AI Assistant panel. Keeps the WHOLE conversation in
 * local state and sends it back in full on every request — the server
 * (lib/assistant-chat.ts) enforces the per-conversation turn cap by counting
 * user turns in exactly this array, so there is no separate "conversation
 * id" to manage on either side.
 *
 * Voice Mode (canVoice) swaps the text route for the voice-chat route
 * (JSON with a `spoken` field) for EVERY turn, not just mic-initiated ones —
 * both routes call the same non-token-streamed `runAssistantTurn`, so this
 * loses nothing: a typed message still gets a ready `spoken` variant for
 * its manual speak button, and a mic-initiated one auto-speaks. Portal-tier
 * (!canVoice) keeps the original streamed-text route untouched.
 */
export function AssistantClient({ canVoice, initialAssistantName, initialVoiceIntroduced, initialTtsVoice, initialTtsRate }: AssistantClientProps) {
  const t = useTranslations("employerAssistant");
  const locale = useLocale();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const [assistantName, setAssistantName] = useState<string>(initialAssistantName || "Taylor");
  const [voiceIntroduced, setVoiceIntroduced] = useState(initialVoiceIntroduced);
  const [ttsVoice, setTtsVoice] = useState<string | null>(initialTtsVoice);
  const [ttsRate, setTtsRate] = useState<number | null>(initialTtsRate);
  const [onboarding, setOnboarding] = useState<{ proposedName: string } | null>(null);
  const [micHintVisible, setMicHintVisible] = useState(false);

  const voiceOutput = useVoiceOutput();
  const voiceInitiatedRef = useRef(false);
  const voiceInput = useVoiceInput({
    lang: regionTag(locale),
    onFinalTranscript: (text) => {
      if (onboarding) {
        void answerOnboarding(text);
        return;
      }
      setInput(text);
      voiceInitiatedRef.current = true;
      // Push-to-talk hands off a reviewable transcript, never an
      // auto-send — the employer still presses Send (or Enter), exactly
      // like a typed message. This is deliberately NOT conditioned on any
      // ASR confidence score (unreliable across browsers); every
      // transcript is reviewable, not just low-confidence ones.
    },
  });

  const voiceInputSupported = canVoice && isVoiceInputSupported();
  const coarsePointer = isCoarsePointer();

  useEffect(() => {
    if (!voiceInputSupported) return;
    if (typeof window === "undefined") return;
    if (!window.localStorage.getItem(MIC_HINT_SEEN_KEY)) setMicHintVisible(true);
  }, [voiceInputSupported]);

  function dismissMicHint() {
    window.localStorage.setItem(MIC_HINT_SEEN_KEY, "1");
    setMicHintVisible(false);
  }

  async function ensureIntroduced(): Promise<boolean> {
    if (!canVoice || voiceIntroduced || onboarding) return true;
    try {
      const res = await fetch("/api/employer/assistant/voice-chat/intro");
      const data = (await res.json().catch(() => ({}))) as {
        intro?: boolean;
        spoken?: string;
        awaitingConfirmation?: boolean;
        proposedName?: string | null;
      };
      if (!data.intro) {
        setVoiceIntroduced(true);
        return true;
      }
      if (data.spoken) voiceOutput.speak(data.spoken, { ttsVoice, ttsRate });
      if (!data.awaitingConfirmation) {
        setVoiceIntroduced(true);
        return true;
      }
      setOnboarding({ proposedName: data.proposedName || "" });
      return false; // the greeting is playing; the next mic press captures the answer
    } catch {
      setVoiceIntroduced(true); // fail open — never block normal voice use on a network hiccup
      return true;
    }
  }

  async function answerOnboarding(answerText: string) {
    if (!onboarding) return;
    try {
      const res = await fetch("/api/employer/assistant/voice-chat/intro", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ proposedName: onboarding.proposedName, answer: answerText }),
      });
      const data = (await res.json().catch(() => ({}))) as { handled?: boolean; spoken?: string };
      if (data.spoken) voiceOutput.speak(data.spoken, { ttsVoice, ttsRate });
      if (data.handled) {
        setOnboarding(null);
        setVoiceIntroduced(true);
      }
      // else: stays in onboarding state, the employer presses mic again to retry
    } catch {
      setOnboarding(null);
      setVoiceIntroduced(true);
    }
  }

  async function onMicPress() {
    if (voiceInput.status === "listening") return;
    const ready = await ensureIntroduced();
    if (ready) voiceInput.start();
  }

  function onMicRelease() {
    if (voiceInput.status === "listening") voiceInput.stop();
  }

  async function refreshPersona() {
    if (!canVoice) return;
    try {
      const res = await fetch("/api/employer/assistant/persona");
      if (!res.ok) return;
      const data = (await res.json()) as { assistantName?: string; ttsVoice?: string | null; ttsRate?: number | null };
      if (data.assistantName) setAssistantName(data.assistantName);
      if (data.ttsVoice !== undefined) setTtsVoice(data.ttsVoice ?? null);
      if (data.ttsRate !== undefined) setTtsRate(data.ttsRate ?? null);
    } catch {
      // best-effort — the header just keeps whatever name it already had
    }
  }

  async function renameAssistantViaSettings(name: string) {
    setAssistantName(name); // optimistic
    try {
      await fetch("/api/employer/assistant/persona", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assistantName: name }),
      });
    } catch {
      // best-effort — a failed rename just leaves the previous name next refresh
    }
  }

  async function changeVoice(voiceURI: string | null) {
    setTtsVoice(voiceURI);
    try {
      await fetch("/api/employer/assistant/persona", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ttsVoice: voiceURI }),
      });
    } catch {
      // best-effort
    }
  }

  async function changeRate(rate: number) {
    setTtsRate(rate);
    try {
      await fetch("/api/employer/assistant/persona", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ttsRate: rate }),
      });
    } catch {
      // best-effort
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    const wasVoiceInitiated = voiceInitiatedRef.current;
    voiceInitiatedRef.current = false;

    const outgoing = [...messages, { role: "user" as const, content: text }];
    setMessages([...outgoing, { role: "assistant", content: "" }]);
    setInput("");
    setSending(true);
    setError("");

    const setReply = (content: string, spoken?: string) =>
      setMessages((m) => {
        const copy = m.slice();
        copy[copy.length - 1] = { role: "assistant", content, spoken };
        return copy;
      });

    try {
      const endpoint = canVoice ? "/api/employer/assistant/voice-chat" : "/api/employer/assistant/chat";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: outgoing.map(({ role, content }) => ({ role, content })) }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error === "portal_required" || d.error === "scale_required" ? t("portalRequired") : t("genericError"));
      }

      if (canVoice) {
        const data = (await res.json()) as { reply: string; spoken: string };
        setReply(data.reply, data.spoken);
        if (wasVoiceInitiated) voiceOutput.speak(data.spoken, { ttsVoice, ttsRate });
        void refreshPersona(); // a deterministic "call you X" rename may have just landed
      } else {
        const reader = res.body?.getReader();
        if (!reader) {
          setReply(await res.text());
        } else {
          const decoder = new TextDecoder();
          let acc = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            acc += decoder.decode(value, { stream: true });
            setReply(acc);
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("genericError"));
      setMessages((m) => m.slice(0, -1));
    } finally {
      setSending(false);
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
    }
  }

  const headerTitle = canVoice && assistantName ? assistantName : t("title");

  return (
    <div>
      <PageHeader
        title={headerTitle}
        subtitle={t("subtitle")}
        action={
          canVoice ? (
            <VoiceSettingsPopover
              assistantName={assistantName}
              onRenameAssistant={renameAssistantViaSettings}
              voices={voiceOutput.voices}
              ttsVoice={ttsVoice}
              ttsRate={ttsRate}
              onChangeVoice={changeVoice}
              onChangeRate={changeRate}
              muted={voiceOutput.muted}
              onToggleMute={() => voiceOutput.setMuted((m) => !m)}
            />
          ) : undefined
        }
      />
      <PendingActionsInbox />
      <Panel className="flex h-[65vh] flex-col">
        <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto pr-1">
          {messages.length === 0 && <p className="text-sm text-white/50">{t("emptyHint")}</p>}
          {messages.map((m, i) => (
            <div key={i} className={`flex items-start gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              {m.role === "assistant" && <Bot className="mt-1 h-4 w-4 shrink-0 text-violet" aria-hidden="true" />}
              <div
                className={`max-w-[80%] whitespace-pre-wrap rounded-xl px-3.5 py-2.5 text-sm ${
                  m.role === "user" ? "bg-violet text-white" : "bg-white/5 text-cream"
                }`}
              >
                {m.content || (sending && i === messages.length - 1 ? t("thinking") : "")}
              </div>
              {m.role === "assistant" && canVoice && m.spoken && (
                <button
                  type="button"
                  onClick={() => voiceOutput.speak(m.spoken as string, { ttsVoice, ttsRate })}
                  aria-label={t("speakReply")}
                  className="mt-1 text-white/40 transition-colors hover:text-violet"
                >
                  <Volume2 className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
              {m.role === "user" && <User className="mt-1 h-4 w-4 shrink-0 text-white/40" aria-hidden="true" />}
            </div>
          ))}
        </div>
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        {voiceInput.status === "denied" && <p className="mt-2 text-xs text-amber-300">{t("micDenied")}</p>}
        {canVoice && !voiceInputSupported && <p className="mt-2 text-xs text-white/40">{t("keyboardDictationHint")}</p>}
        <div className="mt-3 flex items-end gap-2 border-t border-border-gold/60 pt-3">
          <div className="relative flex-1">
            <Input
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                voiceInitiatedRef.current = false;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={voiceInput.interimTranscript || t("placeholder")}
              disabled={sending}
            />
          </div>
          {voiceInputSupported && (
            <div className="relative">
              {micHintVisible && (
                <div className="absolute bottom-11 right-0 w-48 rounded-lg border border-border-gold bg-[#15131c] p-2 text-xs text-white/70 shadow-lg">
                  {coarsePointer ? t("micHintTouch") : t("micHintHold")}
                  <button type="button" onClick={dismissMicHint} className="mt-1 block text-violet underline">
                    {t("gotIt")}
                  </button>
                </div>
              )}
              <button
                type="button"
                aria-label={t("micLabel")}
                aria-pressed={voiceInput.status === "listening"}
                onMouseDown={coarsePointer ? undefined : onMicPress}
                onMouseUp={coarsePointer ? undefined : onMicRelease}
                onMouseLeave={coarsePointer ? undefined : onMicRelease}
                onClick={
                  coarsePointer
                    ? () => {
                        if (voiceInput.status === "listening") onMicRelease();
                        else void onMicPress();
                        if (micHintVisible) dismissMicHint();
                      }
                    : () => {
                        if (micHintVisible) dismissMicHint();
                      }
                }
                className={`flex h-10 w-10 items-center justify-center rounded-lg border transition-colors ${
                  voiceInput.status === "listening"
                    ? "border-violet bg-violet/20 text-violet"
                    : "border-border-gold bg-white/[0.03] text-white/70 hover:bg-white/[0.08]"
                }`}
              >
                {voiceInput.status === "listening" ? <MicOff className="h-4 w-4" aria-hidden="true" /> : <Mic className="h-4 w-4" aria-hidden="true" />}
              </button>
            </div>
          )}
          <Btn onClick={send} disabled={sending || !input.trim()} aria-label={t("send")}>
            <Send className="h-4 w-4" />
          </Btn>
        </div>
      </Panel>
    </div>
  );
}
