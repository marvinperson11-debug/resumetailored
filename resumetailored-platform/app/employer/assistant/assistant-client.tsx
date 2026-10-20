"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Send, Bot, User } from "lucide-react";
import { PageHeader, Panel, Btn, Input } from "../components/ui";

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

/**
 * The read-only Employer Portal AI Assistant panel (Phase 0). Keeps the
 * WHOLE conversation in local state and sends it back in full on every
 * request — the server (lib/assistant-chat.ts) enforces the per-conversation
 * turn cap by counting user turns in exactly this array, so there is no
 * separate "conversation id" to manage on either side.
 *
 * The response streams in (chunked text) so the panel can render it as it
 * arrives, even though the underlying Claude call is not itself
 * token-streamed — see the route for why.
 */
export function AssistantClient() {
  const t = useTranslations("employerAssistant");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    const outgoing = [...messages, { role: "user" as const, content: text }];
    setMessages([...outgoing, { role: "assistant", content: "" }]);
    setInput("");
    setSending(true);
    setError("");

    const setReply = (content: string) =>
      setMessages((m) => {
        const copy = m.slice();
        copy[copy.length - 1] = { role: "assistant", content };
        return copy;
      });

    try {
      const res = await fetch("/api/employer/assistant/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: outgoing }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error === "portal_required" ? t("portalRequired") : t("genericError"));
      }
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
    } catch (e) {
      setError(e instanceof Error ? e.message : t("genericError"));
      setMessages((m) => m.slice(0, -1));
    } finally {
      setSending(false);
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }));
    }
  }

  return (
    <div>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
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
              {m.role === "user" && <User className="mt-1 h-4 w-4 shrink-0 text-white/40" aria-hidden="true" />}
            </div>
          ))}
        </div>
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        <div className="mt-3 flex gap-2 border-t border-border-gold/60 pt-3">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={t("placeholder")}
            disabled={sending}
          />
          <Btn onClick={send} disabled={sending || !input.trim()} aria-label={t("send")}>
            <Send className="h-4 w-4" />
          </Btn>
        </div>
      </Panel>
    </div>
  );
}
