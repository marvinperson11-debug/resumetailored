"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, GraduationCap, MessageSquare, Megaphone, CalendarClock, Clock, CalendarDays, ShieldAlert, UserCheck, Rss, type LucideIcon } from "lucide-react";

interface NotificationItem {
  id: number;
  eventType: string;
  title: string;
  body: string | null;
  link: string;
  createdAt: string;
  read: boolean;
}

const ICONS: Record<string, LucideIcon> = {
  training_assigned: GraduationCap,
  training_completed: GraduationCap,
  message_received: MessageSquare,
  announcement_posted: Megaphone,
  time_off_requested: CalendarClock,
  time_off_decided: CalendarClock,
  timesheet_submitted: Clock,
  timesheet_decided: Clock,
  schedule_published: CalendarDays,
  cert_expiring: ShieldAlert,
  invite_accepted: UserCheck,
  feed_post: Rss,
  feed_comment: Rss,
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

/**
 * Notification bell shared by the employer and employee top bars (candidate
 * has none — this component is simply never mounted there). `basePath` picks
 * which side's API to call; both expose the identical shape
 * (GET .../notifications, POST .../notifications/[id]/read,
 * POST .../notifications/read-all), so one component covers both.
 */
export function NotificationBell({ basePath }: { basePath: "/api/employer" | "/api/employee" }) {
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${basePath}/notifications`, { cache: "no-store" });
      const d = (await r.json().catch(() => ({}))) as { items?: NotificationItem[] };
      setItems(d.items || []);
    } finally {
      setLoading(false);
    }
  }, [basePath]);

  // Initial load + a light poll so the badge updates without a full refresh.
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  // Close on an outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (open && ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const unread = items.filter((i) => !i.read).length;

  async function openItem(item: NotificationItem) {
    setOpen(false);
    if (!item.read) {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, read: true } : i)));
      fetch(`${basePath}/notifications/${item.id}/read`, { method: "POST" }).catch(() => {});
    }
    router.push(item.link);
  }

  async function markAllRead() {
    setItems((prev) => prev.map((i) => ({ ...i, read: true })));
    await fetch(`${basePath}/notifications/read-all`, { method: "POST" }).catch(() => {});
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Notifications"
        className="relative rounded-lg p-2 text-muted-cream transition-colors hover:bg-white/10 hover:text-cream"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-xl border border-border-gold bg-navy shadow-2xl">
          <div className="flex items-center justify-between border-b border-border-gold px-4 py-2.5">
            <span className="text-sm font-semibold text-cream">Notifications</span>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs text-violet hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {loading && items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-white/45">Loading…</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-white/45">You&apos;re all caught up.</p>
            ) : (
              items.map((item) => {
                const Icon = ICONS[item.eventType] || Bell;
                return (
                  <button
                    key={item.id}
                    onClick={() => openItem(item)}
                    className={`flex w-full items-start gap-2.5 border-b border-white/5 px-4 py-3 text-left transition hover:bg-white/[0.06] last:border-0 ${item.read ? "" : "bg-violet/[0.06]"}`}
                  >
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${item.read ? "text-white/35" : "text-violet"}`} />
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm ${item.read ? "text-white/65" : "font-medium text-cream"}`}>{item.title}</span>
                      {item.body && <span className="mt-0.5 block truncate text-xs text-white/40">{item.body}</span>}
                      <span className="mt-0.5 block text-[11px] text-white/35">{timeAgo(item.createdAt)}</span>
                    </span>
                    {!item.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-violet" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
