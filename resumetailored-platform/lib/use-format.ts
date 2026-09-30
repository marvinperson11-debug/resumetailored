import { useLocale } from "next-intl";
import { useMemo } from "react";
import {
  formatCompactNumber,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatDateTimeShort,
  formatMoney,
  formatMoneyRange,
  formatNumber,
  formatTime,
  weekdayName,
  type DateStyle,
  type MoneyOptions,
} from "./format";

/** `lib/format` bound to the viewer's active locale (client + non-async server components). */
export function useFormat() {
  const locale = useLocale();
  return useMemo(
    () => ({
      locale,
      money: (amount: number, opts?: MoneyOptions) => formatMoney(amount, locale, opts),
      moneyRange: (min: number | null | undefined, max: number | null | undefined) => formatMoneyRange(min, max, locale),
      compactNumber: (n: number) => formatCompactNumber(n, locale),
      number: (n: number, maximumFractionDigits?: number) => formatNumber(n, locale, maximumFractionDigits),
      date: (v: Date | string | number | null | undefined, style?: DateStyle, fallback?: string) => formatDate(v, locale, style, fallback),
      dateTime: (v: Date | string | number | null | undefined, fallback?: string) => formatDateTime(v, locale, fallback),
      dateTimeShort: (v: Date | string | number | null | undefined, fallback?: string) => formatDateTimeShort(v, locale, fallback),
      time: (v: Date | string | number | null | undefined, fallback?: string) => formatTime(v, locale, fallback),
      dateRange: (a: Date | string | number, b: Date | string | number, fallback?: string) => formatDateRange(a, b, locale, fallback),
      weekday: (index: number, style?: "long" | "short") => weekdayName(index, locale, style),
    }),
    [locale]
  );
}
