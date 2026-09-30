"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { formatDate, formatDateRange, formatTime } from "@/lib/format";
import { Bell, GraduationCap, MessageSquare, Megaphone, CalendarClock, Clock, CalendarDays, ShieldAlert, UserCheck, Rss, type LucideIcon } from "lucide-react";

interface NotificationItem {
  id: number;
  eventType: string;
  title: string;
  body: string | null;
  link: string;
  /** Structured title (message id + params); null on events logged before it
   *  existed, which render the stored English `title`. */
  msg?: { key: string; params?: Record<string, string | number> } | null;
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

/** "5 min. ago" / "hace 5 min" in the viewer's language. */
function timeAgo(iso: string, locale: string): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "narrow" });
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return rtf.format(0, "second");
  if (min < 60) return rtf.format(-min, "minute");
  const hr = Math.floor(min / 60);
  if (hr < 24) return rtf.format(-hr, "hour");
  return rtf.format(-Math.floor(hr / 24), "day");
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const isIsoDay = (v: unknown): v is string => typeof v === "string" && ISO_DAY.test(v);

/** ISO day + n days, as an ISO day (UTC, so DST can't shift it). */
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Turn a structured event's raw params into display values for the locale
 * (all via Intl, see lib/format): ISO dates become "Jan 5", `start`/`end`
 * become a range, `week` becomes the 7-day span, `HH:MM` times follow the
 * locale's clock style. ISO days are passed as strings so they are read as
 * calendar days and never shift with the viewer's timezone.
 */
function displayParams(params: Record<string, string | number>, locale: string): Record<string, string | number> {
  const out: Record<string, string | number> = { ...params };
  if (isIsoDay(params.start) && isIsoDay(params.end)) out.range = formatDateRange(params.start, params.end, locale);
  if (isIsoDay(params.week)) out.week = formatDateRange(params.week, addDays(params.week, 6), locale);
  if (isIsoDay(params.date)) out.date = formatDate(params.date, locale, "monthDay");
  for (const k of ["from", "to"]) {
    if (/^\d{1,2}:\d{2}$/.test(String(params[k] ?? ""))) out[k] = formatTime(String(params[k]), locale);
  }
  return out;
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
  const t = useTranslations("notificationBell");
  const locale = useLocale();
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
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
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

  /** The title in the viewer's language when the event carries a structured
   *  message we have text for; otherwise the English title stored with it. */
  function titleOf(item: NotificationItem): string {
    const key = item.msg?.key;
    if (!key || !t.has(`events.${key}`)) return item.title;
    const params = displayParams(item.msg?.params || {}, locale);
    if (params.employee === "") params.employee = key === "messageFromEmployee" ? t("anEmployeeLower") : t("anEmployee");
    return t(`events.${key}`, params);
  }

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
        aria-label={t("title")}
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
            <span className="text-sm font-semibold text-cream">{t("title")}</span>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs text-violet hover:underline">
                {t("markAllRead")}
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {loading && items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-white/45">{t("loading")}</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-white/45">{t("caughtUp")}</p>
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
                      <span className={`block truncate text-sm ${item.read ? "text-white/65" : "font-medium text-cream"}`}>{titleOf(item)}</span>
                      {item.body && <span className="mt-0.5 block truncate text-xs text-white/40">{item.body}</span>}
                      <span className="mt-0.5 block text-[11px] text-white/35">{timeAgo(item.createdAt, locale)}</span>
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
