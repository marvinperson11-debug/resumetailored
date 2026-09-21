"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Clock, Loader2, Play, Square } from "lucide-react";
import { entryHours, formatHM } from "@/lib/time-hub";

interface Entry {
  id: number;
  clockIn: string;
  clockOut: string | null;
  note: string;
}

/**
 * Clock in / out card for the portal home. Raw hours only. Shows a live-ticking
 * elapsed timer while on the clock, an optional note, and today's entries. All
 * state comes from /api/employee/time-clock.
 */
export function TimeClockWidget() {
  const [open, setOpen] = useState<Entry | null>(null);
  const [recent, setRecent] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [, forceTick] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/employee/time-clock", { cache: "no-store" });
      const d = (await r.json().catch(() => ({}))) as { open?: Entry | null; recent?: Entry[] };
      setOpen(d.open || null);
      setRecent(d.recent || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Tick every second while clocked in so the elapsed timer moves.
  useEffect(() => {
    if (open) {
      tickRef.current = setInterval(() => forceTick((n) => n + 1), 1000);
      return () => {
        if (tickRef.current) clearInterval(tickRef.current);
      };
    }
  }, [open]);

  async function punch(action: "in" | "out") {
    if (busy) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/employee/time-clock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: note.trim() || undefined }),
      });
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setErr(d.error || "Something went wrong.");
      } else {
        setNote("");
        await load();
      }
    } catch {
      setErr("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const elapsed = open ? formatHM(entryHours(open)) : null;
  const today = new Date().toISOString().slice(0, 10);
  const todays = recent.filter((e) => e.clockIn.slice(0, 10) === today);

  return (
    <section className="glass px-5 py-5">
      <div className="flex items-center gap-2 text-sm font-medium text-white/70">
        <Clock className="h-4 w-4 text-violet" /> Time clock
      </div>

      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-white/50">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : open ? (
            <div>
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal opacity-60" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-teal" />
                </span>
                <span className="font-serif text-2xl font-medium text-cream tabular-nums">{elapsed}</span>
              </div>
              <p className="mt-1 text-xs text-white/50">
                On the clock since{" "}
                {new Date(open.clockIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
          ) : (
            <p className="text-sm text-white/60">You&rsquo;re clocked out.</p>
          )}
        </div>

        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          {!loading && (
            <>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={500}
                placeholder="Add a note (optional)"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-cream placeholder:text-white/30 focus:border-violet focus:outline-none sm:w-64"
              />
              {open ? (
                <button
                  onClick={() => punch("out")}
                  disabled={busy}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-500/90 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-500 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />} Clock out
                </button>
              ) : (
                <button
                  onClick={() => punch("in")}
                  disabled={busy}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-teal px-5 py-2.5 text-sm font-semibold text-navy transition hover:bg-teal/90 disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Clock in
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {err && <p className="mt-3 text-xs text-red-300">{err}</p>}

      {todays.length > 0 && (
        <div className="mt-4 border-t border-white/10 pt-3">
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-white/40">Today</div>
          <ul className="space-y-1">
            {todays.map((e) => (
              <li key={e.id} className="flex items-center justify-between text-xs text-white/60">
                <span>
                  {new Date(e.clockIn).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} –{" "}
                  {e.clockOut ? new Date(e.clockOut).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "now"}
                  {e.note ? <span className="text-white/40"> · {e.note}</span> : null}
                </span>
                <span className="tabular-nums text-white/50">{formatHM(entryHours(e))}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
