"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { renderAIOutput, type Mode, type CoverMeta } from "@/lib/resume-templates";

const PAGE_W = 794; // A4 width in px, the template's own coordinate space

/**
 * Live document preview. Renders the chosen template (screen mode) at its true
 * 794px width and scales it to fit the available column, so the preview matches
 * the printed PDF exactly. The outer box is SIZED to the scaled height (not just
 * scaled) so it never leaves a tall gap of dead space beneath a short document.
 */
export function DocPreview({
  text,
  tplId,
  mode,
  docFont,
  coverMeta,
  photo,
  signature,
  sigFont,
  placeholder,
}: {
  text: string;
  tplId: string;
  mode: Exclude<Mode, "both">;
  docFont?: string;
  coverMeta?: CoverMeta;
  photo?: string;
  signature?: string;
  sigFont?: string;
  placeholder?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [innerH, setInnerH] = useState(0);

  const html = text.trim() ? renderAIOutput(text, tplId, mode, { docFont, coverMeta, photo, signature, sigFont }) : "";

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => {
      const avail = el.clientWidth;
      if (avail > 0) setScale(Math.min(1, avail / PAGE_W));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Measure the natural (unscaled) height so the wrapper can reserve the scaled
  // height. Re-measure whenever the rendered HTML changes.
  useLayoutEffect(() => {
    if (innerRef.current) setInnerH(innerRef.current.scrollHeight);
  }, [html, scale, photo, signature]);

  return (
    <div ref={wrapRef} className="w-full">
      {html ? (
        <div style={{ height: innerH ? innerH * scale : undefined, overflow: "hidden" }}>
          <div
            ref={innerRef}
            style={{ width: PAGE_W, transform: `scale(${scale})`, transformOrigin: "top left" }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      ) : (
        <div className="flex min-h-[320px] items-center justify-center rounded-xl border border-dashed border-border-gold bg-white/5 p-8 text-center text-sm text-white/45">
          {placeholder || "Your live preview will appear here."}
        </div>
      )}
    </div>
  );
}
