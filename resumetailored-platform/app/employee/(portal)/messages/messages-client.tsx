"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Loader2, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

interface Msg {
  id: number;
  sender: "employer" | "employee";
  body: string;
  createdAt: string;
}

export function EmployeeMessagesClient() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/employee/messages", { cache: "no-store" });
      const d = (await r.json().catch(() => ({}))) as { messages?: Msg[] };
      setMessages(d.messages || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    // Optimistic append.
    const optimistic: Msg = { id: -Date.now(), sender: "employee", body, createdAt: new Date().toISOString() };
    setMessages((m) => [...m, optimistic]);
    setDraft("");
    try {
      const r = await fetch("/api/employee/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (r.ok) {
        const d = (await r.json()) as { message?: Msg };
        if (d.message) setMessages((m) => m.map((x) => (x.id === optimistic.id ? d.message! : x)));
      } else {
        setMessages((m) => m.filter((x) => x.id !== optimistic.id));
        setDraft(body);
      }
    } catch {
      setMessages((m) => m.filter((x) => x.id !== optimistic.id));
      setDraft(body);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-3xl flex-col">
      <header className="mb-4">
        <h1 className="font-serif text-3xl font-medium text-cream">Messages</h1>
        <p className="mt-1 text-sm text-white/60">A direct line to your employer.</p>
      </header>

      <div className="glass flex flex-1 flex-col overflow-hidden p-0">
        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-white/50">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-sm text-white/50">
              <MessageSquare className="mb-2 h-8 w-8 text-white/25" />
              No messages yet. Say hello 👋
            </div>
          ) : (
            messages.map((m) => (
              <div key={m.id} className={cn("flex", m.sender === "employee" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[75%] rounded-2xl px-4 py-2 text-sm",
                    m.sender === "employee" ? "bg-violet text-white" : "bg-white/10 text-cream"
                  )}
                >
                  <p className="whitespace-pre-wrap">{m.body}</p>
                  <div className={cn("mt-1 text-[10px]", m.sender === "employee" ? "text-white/70" : "text-white/40")}>
                    {new Date(m.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              </div>
            ))
          )}
          <div ref={endRef} />
        </div>

        <div className="flex items-end gap-2 border-t border-white/10 p-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder="Write a message…"
            className="max-h-32 flex-1 resize-none rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-cream placeholder:text-white/30 focus:border-violet focus:outline-none"
          />
          <button
            onClick={send}
            disabled={sending || !draft.trim()}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet text-white transition hover:bg-violet/90 disabled:opacity-40"
            aria-label="Send"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
