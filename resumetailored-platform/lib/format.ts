/**
 * Locale-aware formatting for everything the site DISPLAYS: money and dates.
 *
 * Rules (product decision): every displayed amount goes through
 * `Intl.NumberFormat` and every displayed date through `Intl.DateTimeFormat`,
 * with the viewer's selected UI language — never a hard-coded "$", a manual
 * symbol concatenation, or an `en-US` literal — so separators, decimal marks,
 * symbol placement and month names all follow the locale.
 *
 * Currency is ALWAYS USD: prices are charged in USD (Stripe is untouched), this
 * only changes how the USD amount is written. Pure + isomorphic (no React, no
 * DOM) so it works in server components, route handlers and the client; the
 * `useFormat` hook binds it to the active next-intl locale.
 */

export const DISPLAY_CURRENCY = "USD" as const;

/** BCP-47 tag for APIs that want a region (speech recognition, etc.) — one per supported UI locale. */
const REGION_TAGS: Record<string, string> = { en: "en-US", zh: "zh-CN", es: "es-ES", hi: "hi-IN", fr: "fr-FR" };
export function regionTag(locale: string): string {
  return REGION_TAGS[locale] ?? "en-US";
}

/** List prices, display only. Checkout amounts live in Stripe and are never read from here. */
export const PRICES_USD = {
  pro: 19,
  proLifetime: 129,
  employerPortal: 49,
  employerScale: 99,
  employerCorporate: 299,
} as const;

const numberFormats = new Map<string, Intl.NumberFormat>();
function numberFormat(key: string, locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const id = `${locale}|${key}`;
  let f = numberFormats.get(id);
  if (!f) {
    f = new Intl.NumberFormat(locale, options);
    numberFormats.set(id, f);
  }
  return f;
}

export interface MoneyOptions {
  /** Fixed number of decimals (default 0 — whole dollars). Use 2 for prices like $19.00. */
  fractionDigits?: number;
  /** "$60K"-style short form for compact labels (filters, chart ticks). */
  compact?: boolean;
  /** ISO 4217 code. Defaults to USD (our own prices are always USD); only third-party
   *  amounts — an employer's job salary — pass their own. An invalid code falls back to USD. */
  currency?: string;
}

function safeCurrency(code: string | undefined): string {
  const c = (code || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) return DISPLAY_CURRENCY;
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: c });
    return c;
  } catch {
    return DISPLAY_CURRENCY;
  }
}

/** An amount in USD written the way `locale` writes it. Non-finite input renders as 0. */
export function formatMoney(amount: number, locale: string, opts: MoneyOptions = {}): string {
  const n = Number.isFinite(amount) ? amount : 0;
  const currency = safeCurrency(opts.currency);
  if (opts.compact) {
    return numberFormat(`money-compact-${currency}`, locale, {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 0,
    }).format(n);
  }
  const digits = opts.fractionDigits ?? 0;
  return numberFormat(`money-${digits}-${currency}`, locale, {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

/** A plain number (no currency) in compact form — for chart labels where the unit is stated elsewhere. */
export function formatCompactNumber(n: number, locale: string): string {
  return numberFormat("compact", locale, { notation: "compact", maximumFractionDigits: 1 }).format(Number.isFinite(n) ? n : 0);
}

/** A plain number with the locale's grouping/decimal marks. */
export function formatNumber(n: number, locale: string, maximumFractionDigits = 2): string {
  return numberFormat(`num-${maximumFractionDigits}`, locale, { maximumFractionDigits }).format(Number.isFinite(n) ? n : 0);
}

/** "$60,000 – $80,000" / "$60,000+" style range; either end may be missing. */
export function formatMoneyRange(min: number | null | undefined, max: number | null | undefined, locale: string, opts: MoneyOptions = {}): string | null {
  if (min && max) return `${formatMoney(min, locale, opts)} – ${formatMoney(max, locale, opts)}`;
  if (min) return `${formatMoney(min, locale, opts)}+`;
  return null;
}

// ── Dates ────────────────────────────────────────────────────────────────────
export type DateStyle =
  | "medium" // Aug 31, 2026 / 31 अगस्त 2026
  | "long" // August 31, 2026
  | "monthDay" // Aug 31
  | "monthShort" // Aug
  | "weekdayMonthDay" // Monday, Aug 31
  | "weekdayLong" // Monday
  | "weekdayShort"; // Mon

const DATE_OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  medium: { year: "numeric", month: "short", day: "numeric" },
  long: { year: "numeric", month: "long", day: "numeric" },
  monthDay: { month: "short", day: "numeric" },
  monthShort: { month: "short" },
  weekdayMonthDay: { weekday: "long", month: "short", day: "numeric" },
  weekdayLong: { weekday: "long" },
  weekdayShort: { weekday: "short" },
};

/** Hindi abbreviates months awkwardly ("अग॰"); the agreed display is the full name ("31 अगस्त 2026"). */
function optionsFor(style: DateStyle, locale: string): Intl.DateTimeFormatOptions {
  const base = DATE_OPTIONS[style];
  return base.month === "short" && /^hi(-|$)/i.test(locale) ? { ...base, month: "long" } : base;
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();
function dateFormat(key: string, locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const id = `${locale}|${key}`;
  let f = dateFormats.get(id);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    dateFormats.set(id, f);
  }
  return f;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A calendar date ("YYYY-MM-DD") is a day, not an instant: read and format it in UTC so it never shifts. */
function parse(value: Date | string | number | null | undefined): { date: Date; utc: boolean } | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    const m = DATE_ONLY.exec(value.trim());
    if (m) {
      const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
      return Number.isNaN(d.getTime()) ? null : { date: d, utc: true };
    }
  }
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : { date: d, utc: false };
}

/** A date in the viewer's locale; `fallback` (default "") for missing/invalid input. */
export function formatDate(value: Date | string | number | null | undefined, locale: string, style: DateStyle = "medium", fallback = ""): string {
  const p = parse(value);
  if (!p) return fallback;
  const base = optionsFor(style, locale);
  const options = p.utc ? { ...base, timeZone: "UTC" } : base;
  return dateFormat(`${style}|${p.utc}`, locale, options).format(p.date);
}

/** Date + time of day ("Aug 31, 2026, 2:30 PM"), in the viewer's timezone. */
export function formatDateTime(value: Date | string | number | null | undefined, locale: string, fallback = ""): string {
  const p = parse(value);
  if (!p) return fallback;
  return dateFormat("datetime", locale, { year: "numeric", month: optionsFor("monthShort", locale).month, day: "numeric", hour: "numeric", minute: "2-digit" }).format(p.date);
}

/** Short date + time ("Aug 31, 2:30 PM") for timelines and chat. */
export function formatDateTimeShort(value: Date | string | number | null | undefined, locale: string, fallback = ""): string {
  const p = parse(value);
  if (!p) return fallback;
  return dateFormat("datetime-short", locale, { month: optionsFor("monthShort", locale).month, day: "numeric", hour: "numeric", minute: "2-digit" }).format(p.date);
}

/** Time of day ("2:30 PM" / "14:30" depending on the locale). `HH:MM` strings are read as wall-clock times. */
export function formatTime(value: Date | string | number | null | undefined, locale: string, fallback = ""): string {
  if (typeof value === "string") {
    const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
    if (m) {
      return dateFormat("time-utc", locale, { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(
        new Date(Date.UTC(2000, 0, 1, Number(m[1]), Number(m[2])))
      );
    }
  }
  const p = parse(value);
  if (!p) return fallback;
  return dateFormat("time", locale, { hour: "numeric", minute: "2-digit" }).format(p.date);
}

/** "Aug 28 – Sep 27, 2026": a range written by the locale's own range rules (single date if start == end). */
export function formatDateRange(start: Date | string | number, end: Date | string | number, locale: string, fallback = ""): string {
  const a = parse(start);
  const b = parse(end);
  if (!a || !b) return fallback;
  const utc = a.utc && b.utc;
  const medium = optionsFor("medium", locale);
  const fmt = dateFormat(`range|${utc}`, locale, utc ? { ...medium, timeZone: "UTC" } : medium);
  if (a.date.getTime() === b.date.getTime()) return fmt.format(a.date);
  return typeof fmt.formatRange === "function" ? fmt.formatRange(a.date, b.date) : `${fmt.format(a.date)} – ${fmt.format(b.date)}`;
}

/** Weekday name for a 0–6 (Sunday-first) index, in the locale. */
export function weekdayName(index: number, locale: string, style: "long" | "short" = "long"): string {
  return dateFormat(`wd-${style}`, locale, { weekday: style, timeZone: "UTC" }).format(new Date(Date.UTC(2023, 0, 1 + index)));
}

/** "Mon 2:30 PM" — weekday + time of day, for interview slots and similar. */
export function formatWeekdayTime(value: Date | string | number | null | undefined, locale: string, fallback = ""): string {
  const p = parse(value);
  if (!p) return fallback;
  return dateFormat("weekday-time", locale, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(p.date);
}
