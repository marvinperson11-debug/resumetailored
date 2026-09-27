"use client";

import { useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import type { PresentationDeck } from "@/lib/office-hub";

const SWIPE_THRESHOLD = 40;

/** Fullscreen "Present" mode — one slide per viewport, dark theme matching
 *  the rest of the Employer Portal, with arrow-key, swipe, and on-screen
 *  navigation plus a slide counter. Escape (or the × button) closes it. */
export function PresentModeViewer({ deck, onClose }: { deck: PresentationDeck; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const total = deck.slides.length;
  const touchStartX = useRef(0);

  function next() {
    setIndex((i) => Math.min(total - 1, i + 1));
  }
  function prev() {
    setIndex((i) => Math.max(0, i - 1));
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === " ") next();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
  }
  function onTouchEnd(e: React.TouchEvent) {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) < SWIPE_THRESHOLD) return;
    if (dx < 0) next();
    else prev();
  }

  const slide = deck.slides[index];

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-navy" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close presentation"
        className="absolute right-5 top-5 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
      >
        <X className="h-5 w-5" />
      </button>

      <div className="flex flex-1 flex-col items-center justify-center px-[8%] py-[6%] text-center">
        <h1 className="font-serif text-3xl font-medium text-cream sm:text-5xl">{slide.title}</h1>
        <ul className="mt-8 max-w-2xl space-y-4 text-left">
          {slide.bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-3 text-lg text-white/80 sm:text-xl">
              <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet" />
              {b}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex items-center justify-center gap-6 pb-8">
        <button
          type="button"
          onClick={prev}
          disabled={index === 0}
          aria-label="Previous slide"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/70 transition-colors hover:bg-white/20 hover:text-white disabled:opacity-30"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="text-sm text-white/50">
          {index + 1} / {total}
        </span>
        <button
          type="button"
          onClick={next}
          disabled={index === total - 1}
          aria-label="Next slide"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/70 transition-colors hover:bg-white/20 hover:text-white disabled:opacity-30"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
