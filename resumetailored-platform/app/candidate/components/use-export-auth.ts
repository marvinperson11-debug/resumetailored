"use client";

import { useEffect, useState } from "react";

export interface ExportAuth {
  /** false when the selected template needs Pro (server said 402). */
  allowed: boolean;
  /** Whether exports must carry the free-tier watermark. Defaults to true until the server answers. */
  watermark: boolean;
  message: string;
  /** The server has answered (until then no upsell copy may render). */
  ready: boolean;
  /** Server-derived (canUseIndividualPro). Free-only upsell copy keys off `ready && !pro`. */
  pro: boolean;
}

/**
 * Asks /api/export/authorize about the selected template(s). The result is
 * cached in state so export buttons can stay synchronous (window.open for the
 * print dialog must run inside the click, before any await).
 */
export function useExportAuth(tplIds: string[]): ExportAuth {
  const [auth, setAuth] = useState<ExportAuth>({ allowed: true, watermark: true, message: "", ready: false, pro: false });
  const key = tplIds.join("|");
  useEffect(() => {
    let live = true;
    fetch("/api/export/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tplIds: key ? key.split("|") : [] }),
    })
      .then(async (r) => {
        const d = (await r.json().catch(() => ({}))) as { watermark?: boolean; message?: string; pro?: boolean };
        if (!live) return;
        if (r.status === 402) setAuth({ allowed: false, watermark: true, message: d.message || r.statusText, ready: true, pro: false });
        else if (r.ok) setAuth({ allowed: true, watermark: d.watermark !== false, message: "", ready: true, pro: d.pro === true });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [key]);
  return auth;
}
