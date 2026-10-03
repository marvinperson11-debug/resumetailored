"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { PRICES_USD } from "@/lib/format";
import { useFormat } from "@/lib/use-format";
import type { ExportAuth } from "./use-export-auth";

/**
 * Watermark conversion moments around a FREE export. Every piece is gated on the
 * server's answer from /api/export/authorize (`ready && !pro && watermark`, which comes
 * from canUseIndividualPro) — never on a client-only prop — so a Pro account sees none of it.
 *
 *   1. <WatermarkNote>      pre-download line next to the export buttons
 *   2. banner "standard"    one-time-per-session banner after a free export
 *   3. banner "ab"          alternate copy after 2+ free exports — feature-flagged, OFF by default
 *
 * A/B flag: set NEXT_PUBLIC_WATERMARK_AB=on (build/runtime env), or set the cookie
 * `rt_wm_ab=1` in the browser to try it on one device. Nothing else changes when it is off.
 */
const UPGRADE_HREF = "/candidate?upgrade=pro";
const COUNT_KEY = "rt_free_export_count"; // localStorage — free exports so far
const SESSION_STD = "rt_wm_banner_std"; // sessionStorage — standard banner already shown
const SESSION_AB = "rt_wm_banner_ab"; // sessionStorage — A/B banner already shown
export const AB_COOKIE = "rt_wm_ab";

export type NudgeBanner = "standard" | "ab" | null;

function abEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_WATERMARK_AB === "on") return true;
  try {
    return typeof document !== "undefined" && document.cookie.split(";").some((c) => c.trim() === `${AB_COOKIE}=1`);
  } catch {
    return false;
  }
}

function read(store: "local" | "session", key: string): string | null {
  try {
    return (store === "local" ? window.localStorage : window.sessionStorage).getItem(key);
  } catch {
    return null;
  }
}
function write(store: "local" | "session", key: string, value: string) {
  try {
    (store === "local" ? window.localStorage : window.sessionStorage).setItem(key, value);
  } catch {
    /* storage blocked — the banner just may show again */
  }
}

export function useExportNudge(auth: ExportAuth): { banner: NudgeBanner; noteExport: () => void; dismiss: () => void } {
  const [banner, setBanner] = useState<NudgeBanner>(null);
  const isFree = auth.ready && !auth.pro && auth.watermark;

  /** Call after a free export was actually started. */
  const noteExport = useCallback(() => {
    if (!isFree) return;
    const count = (Number(read("local", COUNT_KEY)) || 0) + 1;
    write("local", COUNT_KEY, String(count));
    if (abEnabled() && count >= 2 && !read("session", SESSION_AB)) {
      write("session", SESSION_AB, "1");
      write("session", SESSION_STD, "1"); // never stack the two banners in one session
      setBanner("ab");
    } else if (!read("session", SESSION_STD)) {
      write("session", SESSION_STD, "1");
      setBanner("standard");
    }
  }, [isFree]);

  const dismiss = useCallback(() => setBanner(null), []);
  return { banner: isFree ? banner : null, noteExport, dismiss };
}

/** Pre-download line for free users, shown on/above the export buttons. */
export function WatermarkNote({ auth }: { auth: ExportAuth }) {
  const t = useTranslations("candidateTools.exportNudge");
  const fmt = useFormat();
  if (!(auth.ready && !auth.pro && auth.watermark)) return null;
  return (
    <p className="border-t border-border-gold px-4 py-2 text-xs leading-snug text-white/60">
      {t.rich("pre", {
        price: fmt.money(PRICES_USD.pro),
        link: (chunks) => (
          <a href={UPGRADE_HREF} className="font-semibold text-gold underline-offset-2 hover:underline">
            {chunks}
          </a>
        ),
      })}
    </p>
  );
}

/** One-time-per-session banner shown at the top of the result screen after a free export. */
export function ExportNudgeBanner({ banner, onDismiss }: { banner: NudgeBanner; onDismiss: () => void }) {
  const t = useTranslations("candidateTools.exportNudge");
  if (!banner) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-gold/40 bg-gold/10 px-4 py-2.5 text-xs text-gold">
      <span className="min-w-[14rem] flex-1 leading-snug">{banner === "ab" ? t("abBody") : t("postBody")}</span>
      <a href={UPGRADE_HREF} className="rounded-full bg-gold px-3 py-1 font-bold text-navy transition-colors hover:bg-gold/90">
        {t("goPro")}
      </a>
      <button type="button" onClick={onDismiss} className="inline-flex items-center gap-1 text-white/60 transition-colors hover:text-white">
        <X className="h-3 w-3" aria-hidden="true" /> {t("maybeLater")}
      </button>
    </div>
  );
}
