"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, Send, ArrowLeft, Loader2 } from "lucide-react";
import { INVITE_STATUS_LABELS, type EmployeeThread, type EmployeeMessage, type InviteStatus } from "@/lib/employee-hub";
import { Panel, Btn, EmptyState, Badge } from "../components/ui";
import { cn } from "@/lib/utils";

const INVITE_TONE: Record<InviteStatus, "teal" | "gold" | "neutral"> = { none: "neutral", invited: "gold", accepted: "teal" };

/** Employer's employee-message inbox: a thread list on the left, the open thread
 *  on the right (single column with back-nav on mobile). Fresh component,
 *  deliberately separate from the candidate MessagesClient. */
export function EmployeeThreads({ initialEmployeeId }: { initialEmployeeId?: number } = {}) {
  const [threads, setThreads] = useState<EmployeeThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<number | null>(initialEmployeeId ?? null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/employer/employee-messages", { cache: "no-store" });
      const d = (await r.json().catch(() => ({}))) as { threads?: EmployeeThread[] };
      setThreads(d.threads || []);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const openThread = threads.find((t) => t.employee.id === openId) || null;

  if (loading) {
    return (
      <Panel className="flex items-center gap-2 text-sm text-white/55">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </Panel>
    );
  }

  if (threads.length === 0) {
    return (
      <EmptyState
        icon={MessageSquare}
        title="No employee messages yet"
        body="When an invited employee messages you from their portal, the conversation shows up here."
      />
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-[320px_1fr]">
      <Panel className={cn("p-0", openId !== null && "hidden md:block")}>
        <ul className="divide-y divide-border-gold/50">
          {threads.map((t) => (
            <li key={t.employee.id}>
              <button
                onClick={() => setOpenId(t.employee.id)}
                className={cn(
                  "flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left transition-colors hover:bg-white/[0.03]",
                  openId === t.employee.id && "bg-white/[0.04]"
                )}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="truncate font-medium text-cream">{t.employee.name}</span>
                  {t.unread > 0 && <span className="rounded-full bg-violet px-2 py-0.5 text-[10px] font-bold text-white">{t.unread}</span>}
                </div>
                <span className="line-clamp-1 text-xs text-white/50">
                  {t.lastSender === "employer" ? "You: " : ""}
                  {t.lastMessage}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      <div className={cn(openId === null && "hidden md:block")}>
        {openThread ? (
          <Thread key={openThread.employee.id} thread={openThread} onBack={() => setOpenId(null)} onSent={load} />
        ) : (
          <Panel className="flex h-full items-center justify-center text-sm text-white/40">Select a conversation</Panel>
        )}
      </div>
    </div>
  );
}

function Thread({ thread, onBack, onSent }: { thread: EmployeeThread; onBack: () => void; onSent: () => void }) {
  const employeeId = thread.employee.id;
  const [messages, setMessages] = useState<EmployeeMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/employer/employee-messages/${employeeId}`, { cache: "no-store" });
      const d = (await r.json().catch(() => ({}))) as { messages?: EmployeeMessage[] };
      setMessages(d.messages || []);
    } finally {
      setLoading(false);
    }
  }, [employeeId]);
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
    const optimistic: EmployeeMessage = { id: -Date.now(), employeeId, sender: "employer", body, readAt: null, createdAt: new Date().toISOString() };
    setMessages((m) => [...m, optimistic]);
    setDraft("");
    try {
      const r = await fetch(`/api/employer/employee-messages/${employeeId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (r.ok) {
        const d = (await r.json()) as { message?: EmployeeMessage };
        if (d.message) setMessages((m) => m.map((x) => (x.id === optimistic.id ? d.message! : x)));
        onSent();
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
    <Panel className="flex h-[calc(100vh-14rem)] flex-col p-0">
      <div className="flex items-center gap-3 border-b border-border-gold px-4 py-3">
        <button onClick={onBack} className="md:hidden" aria-label="Back">
          <ArrowLeft className="h-5 w-5 text-white/60" />
        </button>
        <div className="min-w-0">
          <div className="truncate font-medium text-cream">{thread.employee.name}</div>
          <div className="text-xs text-white/45">{thread.employee.role || thread.employee.email}</div>
        </div>
        <span className="ml-auto">
          <Badge tone={INVITE_TONE[thread.employee.inviteStatus]}>{INVITE_STATUS_LABELS[thread.employee.inviteStatus]}</Badge>
        </span>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-white/50">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={cn("flex", m.sender === "employer" ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[75%] rounded-2xl px-4 py-2 text-sm", m.sender === "employer" ? "bg-violet text-white" : "bg-white/10 text-cream")}>
                <p className="whitespace-pre-wrap">{m.body}</p>
                <div className={cn("mt-1 text-[10px]", m.sender === "employer" ? "text-white/70" : "text-white/40")}>
                  {new Date(m.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <div className="flex items-end gap-2 border-t border-border-gold p-3">
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
          placeholder="Reply…"
          className="max-h-32 flex-1 resize-none rounded-xl border border-border-gold bg-white/5 px-4 py-2.5 text-sm text-cream placeholder:text-white/30 focus:border-violet focus:outline-none"
        />
        <Btn onClick={send} loading={sending} disabled={!draft.trim()}>
          <Send className="h-4 w-4" />
        </Btn>
      </div>
    </Panel>
  );
}
