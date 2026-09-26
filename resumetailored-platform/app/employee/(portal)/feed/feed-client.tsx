"use client";

import { useCallback, useEffect, useState } from "react";
import { Rss, Flag, PartyPopper, Send, Loader2, Pin, MessageCircle, CheckCircle2, Circle } from "lucide-react";
import { FEED_KIND_LABELS, type FeedPost, type FeedComment, type FeedPostKind } from "@/lib/feed-hub";

const KIND_ICON: Record<FeedPostKind, typeof Rss> = { post: Rss, issue: Flag, win: PartyPopper };
const KIND_STYLE: Record<FeedPostKind, string> = {
  post: "bg-violet/20 text-violet",
  issue: "bg-red-500/20 text-red-300",
  win: "bg-teal/20 text-teal",
};

export function EmployeeFeedClient() {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [myId, setMyId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<FeedPostKind>("post");
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [comments, setComments] = useState<Record<number, FeedComment[]>>({});
  const [reply, setReply] = useState("");
  const [replying, setReplying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [feedRes, meRes] = await Promise.all([
      fetch("/api/employee/feed", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
      fetch("/api/employee/me", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
    ]);
    setPosts(feedRes.posts || []);
    setMyId(meRes.employee?.id ?? null);
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function post() {
    if (!body.trim() || posting) return;
    setPosting(true);
    try {
      const res = await fetch("/api/employee/feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, body }),
      });
      if (res.ok) {
        setBody("");
        setKind("post");
        await load();
      }
    } finally {
      setPosting(false);
    }
  }

  async function toggleResolved(id: number, resolved: boolean) {
    await fetch(`/api/employee/feed/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolved }),
    });
    await load();
  }

  async function loadComments(postId: number) {
    const res = await fetch(`/api/employee/feed/${postId}/comments`).then((r) => r.json()).catch(() => ({}));
    setComments((c) => ({ ...c, [postId]: res.comments || [] }));
  }

  async function openThread(id: number) {
    const next = openId === id ? null : id;
    setOpenId(next);
    if (next && !comments[id]) await loadComments(id);
  }

  async function sendReply(postId: number) {
    if (!reply.trim() || replying) return;
    setReplying(true);
    try {
      const res = await fetch(`/api/employee/feed/${postId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: reply }),
      });
      if (res.ok) {
        setReply("");
        await loadComments(postId);
        await load();
      }
    } finally {
      setReplying(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="font-serif text-3xl font-medium text-cream">Team feed</h1>
        <p className="mt-1 text-sm text-white/60">Updates, issues, and wins from your team.</p>
      </header>

      <div className="glass space-y-3 px-5 py-4">
        <div className="flex gap-2">
          {(Object.keys(FEED_KIND_LABELS) as FeedPostKind[]).map((k) => {
            const Icon = KIND_ICON[k];
            return (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                  kind === k ? "border-violet bg-violet/15 text-violet" : "border-white/10 text-white/60 hover:bg-white/5"
                }`}
              >
                <Icon className="h-3.5 w-3.5" /> {FEED_KIND_LABELS[k]}
              </button>
            );
          })}
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="Share an update, flag something, or celebrate a win…"
          className="w-full resize-y rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-cream placeholder:text-white/35 outline-none focus:border-violet focus:ring-1 focus:ring-violet"
        />
        <button
          onClick={post}
          disabled={!body.trim() || posting}
          className="inline-flex items-center gap-2 rounded-lg bg-violet px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Post
        </button>
      </div>

      {loading ? (
        <div className="glass flex items-center gap-2 px-5 py-8 text-sm text-white/50">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : posts.length === 0 ? (
        <div className="glass flex flex-col items-center gap-2 px-5 py-12 text-center text-sm text-white/50">
          <Rss className="h-7 w-7 text-white/25" />
          No posts yet. Be the first to share something.
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((p) => {
            const Icon = KIND_ICON[p.kind];
            const isMine = p.authorKind === "employee" && myId !== null && p.authorId === String(myId);
            return (
              <div key={p.id} className={`glass px-5 py-4 ${p.resolved ? "opacity-70" : ""}`}>
                <div className="flex flex-wrap items-center gap-2">
                  {p.pinned && <Pin className="h-3.5 w-3.5 shrink-0 text-gold" />}
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${KIND_STYLE[p.kind]}`}>
                    <Icon className="h-3 w-3" /> {FEED_KIND_LABELS[p.kind]}
                  </span>
                  <span className="font-medium text-cream">{p.authorName}</span>
                  <span className="text-xs text-white/40">{p.authorKind === "employee" ? "employee" : "employer"}</span>
                  {p.resolved && <span className="rounded-full bg-teal/20 px-2.5 py-0.5 text-[11px] font-semibold text-teal">Resolved</span>}
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-sm text-white/80">{p.body}</p>
                <div className="mt-1.5 text-xs text-white/40">{new Date(p.createdAt).toLocaleString()}</div>

                <div className="mt-3 flex items-center gap-3 border-t border-white/10 pt-3">
                  <button onClick={() => openThread(p.id)} className="inline-flex items-center gap-1.5 text-xs font-medium text-violet hover:underline">
                    <MessageCircle className="h-3.5 w-3.5" /> {p.commentCount} {p.commentCount === 1 ? "comment" : "comments"}
                  </button>
                  {isMine && (
                    <button onClick={() => toggleResolved(p.id, !p.resolved)} className="inline-flex items-center gap-1.5 text-xs font-medium text-white/60 hover:text-cream">
                      {p.resolved ? <Circle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      {p.resolved ? "Reopen" : "Mark resolved"}
                    </button>
                  )}
                </div>

                {openId === p.id && (
                  <div className="mt-3 space-y-2 border-t border-white/10 pt-3">
                    {(comments[p.id] || []).map((c) => (
                      <div key={c.id} className="rounded-lg bg-white/[0.04] px-3 py-2">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-medium text-cream">{c.authorName}</span>
                          <span className="text-white/35">{new Date(c.createdAt).toLocaleString()}</span>
                        </div>
                        <p className="mt-0.5 whitespace-pre-wrap text-sm text-white/75">{c.body}</p>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <input
                        value={reply}
                        onChange={(e) => setReply(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && sendReply(p.id)}
                        placeholder="Reply…"
                        maxLength={2000}
                        className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-cream placeholder:text-white/35 outline-none focus:border-violet focus:ring-1 focus:ring-violet"
                      />
                      <button
                        onClick={() => sendReply(p.id)}
                        disabled={!reply.trim() || replying}
                        className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-cream transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {replying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
