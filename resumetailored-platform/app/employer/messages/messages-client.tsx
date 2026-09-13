"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, Send, Paperclip, Search, X, FileText, ImageIcon, ArrowLeft } from "lucide-react";
import {
  MESSAGE_TEMPLATES,
  type Conversation,
  type Message,
  type MessageAttachment,
  type Applicant,
} from "@/lib/employer-ai";
import { Panel, PageHeader, Btn, Area, Picker, EmptyState } from "../components/ui";
import { cn } from "@/lib/utils";

type FilterTab = "all" | "unread" | "sent";
const MAX_ATTACH_BYTES = 1_500_000; // ~1.5MB per file (stored inline as a data URL)

export function MessagesClient({ initialApplicantId }: { initialApplicantId?: number }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<FilterTab>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(initialApplicantId ?? null);
  // A candidate opened from elsewhere who has no messages yet (not in the inbox).
  const [pending, setPending] = useState<Conversation | null>(null);

  const loadConversations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/employer/messages", { cache: "no-store" });
      const d = (await res.json().catch(() => ({}))) as { conversations?: Conversation[] };
      setConversations(d.conversations || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // If we were sent a candidate that isn't in the inbox yet, fetch their info so
  // we can open an empty thread and start a conversation.
  useEffect(() => {
    if (!initialApplicantId) return;
    fetch(`/api/employer/candidates/${initialApplicantId}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { applicant?: Applicant }) => {
        if (d.applicant) {
          setPending({
            applicantId: d.applicant.id,
            name: d.applicant.name,
            email: d.applicant.email,
            jobTitle: d.applicant.jobTitle,
            lastMessage: "",
            lastSender: "employer",
            lastAt: "",
            unread: 0,
          });
        }
      })
      .catch(() => {});
  }, [initialApplicantId]);

  const filtered = conversations.filter((c) => {
    if (tab === "unread" && c.unread === 0) return false;
    if (tab === "sent" && c.lastSender !== "employer") return false;
    if (search.trim() && !c.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  });

  const selected =
    conversations.find((c) => c.applicantId === selectedId) ||
    (pending && pending.applicantId === selectedId ? pending : null);

  const totalUnread = conversations.reduce((n, c) => n + c.unread, 0);

  function selectConversation(id: number) {
    setSelectedId(id);
    // Optimistically clear the unread dot and tell the server.
    setConversations((prev) => prev.map((c) => (c.applicantId === id ? { ...c, unread: 0 } : c)));
    fetch("/api/employer/messages/read", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicantId: id }),
    }).catch(() => {});
  }

  return (
    <div>
      <PageHeader title="Messages" subtitle="In-app conversations with your candidates." />

      <Panel className="overflow-hidden p-0">
        <div className="grid min-h-[560px] grid-cols-1 md:grid-cols-[320px_1fr]">
          {/* Inbox */}
          <div className={cn("flex flex-col border-border-gold md:border-r", selected && "hidden md:flex")}>
            {/* Search + tabs */}
            <div className="space-y-3 border-b border-border-gold p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name…"
                  className="w-full rounded-lg border border-border-gold bg-white/5 py-2 pl-9 pr-3 text-sm text-cream placeholder:text-white/35 outline-none focus:border-violet focus:ring-1 focus:ring-violet"
                />
              </div>
              <div className="flex gap-1 text-xs">
                {(["all", "unread", "sent"] as FilterTab[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    className={cn(
                      "flex-1 rounded-md px-2 py-1.5 font-semibold capitalize transition-colors",
                      tab === t ? "bg-violet/20 text-cream" : "text-white/55 hover:bg-white/5"
                    )}
                  >
                    {t}
                    {t === "unread" && totalUnread > 0 ? ` (${totalUnread})` : ""}
                  </button>
                ))}
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <p className="p-4 text-sm text-white/50">Loading…</p>
              ) : filtered.length === 0 && !(pending && tab === "all" && !search) ? (
                <p className="p-4 text-sm text-white/45">
                  {conversations.length === 0 ? "No messages yet." : "No conversations match."}
                </p>
              ) : (
                <ul>
                  {pending && !conversations.some((c) => c.applicantId === pending.applicantId) && tab !== "unread" && (
                    <ConversationRow
                      key={`pending-${pending.applicantId}`}
                      c={pending}
                      active={selectedId === pending.applicantId}
                      onClick={() => setSelectedId(pending.applicantId)}
                    />
                  )}
                  {filtered.map((c) => (
                    <ConversationRow key={c.applicantId} c={c} active={selectedId === c.applicantId} onClick={() => selectConversation(c.applicantId)} />
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Thread */}
          <div className={cn("flex min-h-[560px] flex-col", !selected && "hidden md:flex")}>
            {selected ? (
              <Thread
                key={selected.applicantId}
                conversation={selected}
                onBack={() => setSelectedId(null)}
                onSent={loadConversations}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center p-6">
                <EmptyState
                  icon={MessageSquare}
                  title="No messages yet"
                  body="Start a conversation from the Candidates page, or pick a conversation on the left."
                />
              </div>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}

function ConversationRow({ c, active, onClick }: { c: Conversation; active: boolean; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full items-start gap-3 border-b border-border-gold/50 px-4 py-3 text-left transition-colors hover:bg-white/[0.03]",
          active && "bg-white/[0.05]"
        )}
      >
        <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: c.unread > 0 ? "#3B82F6" : "transparent" }} aria-label={c.unread > 0 ? "Unread" : undefined} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className={cn("truncate text-sm", c.unread > 0 ? "font-bold text-cream" : "font-medium text-cream/90")}>{c.name || "Candidate"}</span>
            <span className="shrink-0 text-[11px] text-white/40">{fmtShort(c.lastAt)}</span>
          </div>
          <p className="truncate text-xs text-white/50">
            {c.lastSender === "employer" && c.lastMessage ? "You: " : ""}
            {c.lastMessage || "No messages yet"}
          </p>
        </div>
      </button>
    </li>
  );
}

// ── Conversation thread ─────────────────────────────────────────────────────
function Thread({ conversation, onBack, onSent }: { conversation: Conversation; onBack: () => void; onSent: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/employer/messages?applicantId=${conversation.applicantId}`, { cache: "no-store" });
      const d = (await res.json().catch(() => ({}))) as { messages?: Message[] };
      setMessages(d.messages || []);
    } finally {
      setLoading(false);
    }
  }, [conversation.applicantId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function onPickFiles(files: FileList | null) {
    if (!files) return;
    setError(null);
    for (const f of Array.from(files).slice(0, 5)) {
      if (f.size > MAX_ATTACH_BYTES) {
        setError(`"${f.name}" is over 1.5MB — attach a smaller file or share a link.`);
        continue;
      }
      const isImage = f.type.startsWith("image/");
      const isPdf = f.type === "application/pdf";
      if (!isImage && !isPdf) {
        setError("Only PDF and image attachments are supported.");
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = reject;
        reader.readAsDataURL(f);
      }).catch(() => "");
      if (url) setAttachments((prev) => [...prev, { name: f.name, url, kind: isPdf ? "pdf" : "image" }]);
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  async function send() {
    if (!text.trim() && attachments.length === 0) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/employer/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicantId: conversation.applicantId, content: text, attachments }),
      });
      const d = (await res.json().catch(() => ({}))) as { message?: Message; error?: string };
      if (!res.ok || !d.message) throw new Error(d.error || "Could not send.");
      setMessages((prev) => [...prev, d.message!]);
      setText("");
      setAttachments([]);
      onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSending(false);
    }
  }

  function applyTemplate(body: string) {
    if (!body) return;
    const first = (conversation.name || "").split(" ")[0] || conversation.name || "there";
    setText(`Hi ${first},\n\n${body}`);
  }

  return (
    <>
      {/* Thread header */}
      <div className="flex items-center gap-3 border-b border-border-gold px-4 py-3">
        <button type="button" onClick={onBack} className="text-muted-cream hover:text-cream md:hidden" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          <div className="truncate font-medium text-cream">{conversation.name || "Candidate"}</div>
          <div className="truncate text-xs text-white/45">
            {conversation.email}
            {conversation.jobTitle ? ` · ${conversation.jobTitle}` : ""}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {loading ? (
          <p className="text-sm text-white/50">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="mt-8 text-center text-sm text-white/45">No messages yet. Say hello 👋</p>
        ) : (
          messages.map((m) => <Bubble key={m.id} m={m} />)
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-border-gold p-3">
        {error && <p className="mb-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((a, i) => (
              <span key={i} className="inline-flex items-center gap-1.5 rounded-md border border-border-gold bg-white/[0.04] px-2 py-1 text-xs text-cream">
                {a.kind === "pdf" ? <FileText className="h-3.5 w-3.5 text-violet" /> : <ImageIcon className="h-3.5 w-3.5 text-violet" />}
                <span className="max-w-[140px] truncate">{a.name}</span>
                <button type="button" onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))} aria-label="Remove">
                  <X className="h-3 w-3 text-white/50 hover:text-cream" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="mb-2">
          <Picker defaultValue="" onChange={(e) => { applyTemplate(e.target.value); e.target.value = ""; }}>
            <option value="">Insert a template…</option>
            {MESSAGE_TEMPLATES.map((t) => (
              <option key={t.label} value={t.body}>
                {t.label}
              </option>
            ))}
          </Picker>
        </div>
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="shrink-0 rounded-lg border border-border-gold bg-white/[0.03] p-2.5 text-muted-cream hover:bg-white/[0.08] hover:text-cream"
            aria-label="Attach a file"
            title="Attach a PDF or image"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <input ref={fileRef} type="file" accept="application/pdf,image/*" multiple className="hidden" onChange={(e) => onPickFiles(e.target.files)} />
          <Area
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Write a message…  (⌘/Ctrl + Enter to send)"
            className="flex-1"
          />
          <Btn onClick={send} loading={sending} disabled={!text.trim() && attachments.length === 0} className="shrink-0">
            <Send className="h-4 w-4" /> Send
          </Btn>
        </div>
      </div>
    </>
  );
}

function Bubble({ m }: { m: Message }) {
  const mine = m.sender === "employer";
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[80%] rounded-2xl px-3.5 py-2.5", mine ? "bg-violet text-white" : "border border-border-gold bg-white/[0.05] text-cream")}>
        {m.content && <p className="whitespace-pre-wrap text-sm">{m.content}</p>}
        {m.attachments.length > 0 && (
          <div className={cn("space-y-1.5", m.content && "mt-2")}>
            {m.attachments.map((a, i) =>
              a.kind === "image" ? (
                <a key={i} href={a.url} target="_blank" rel="noreferrer" className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element -- data:/remote attachment preview, not a static asset */}
                  <img src={a.url} alt={a.name} className="max-h-48 rounded-lg" />
                </a>
              ) : (
                <a
                  key={i}
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  download={a.name}
                  className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs underline", mine ? "text-white/90" : "text-violet")}
                >
                  <FileText className="h-3.5 w-3.5" /> {a.name}
                </a>
              )
            )}
          </div>
        )}
        <div className={cn("mt-1 text-[10px]", mine ? "text-white/70" : "text-white/40")}>{fmtTime(m.createdAt)}</div>
      </div>
    </div>
  );
}

function fmtShort(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function fmtTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
