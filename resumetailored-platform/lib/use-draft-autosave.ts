"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Stash } from "./draft-stash";

/**
 * Autosave a form's draft into its stash as it is typed (debounced), so leaving and coming back
 * keeps the work. Pass `enabled: false` while the form is not the place to save from (editing an
 * existing record).
 *
 * - A form that has never held anything never touches the store (so mounting a blank form can't
 *   erase a waiting draft); once it has held content, emptying it removes the stash.
 * - A write still pending when the form unmounts is flushed, so the last keystrokes survive a
 *   quick navigation.
 * - `clear()` (after a successful publish, or an explicit discard) removes the stash and drops any
 *   write still pending, so a closing form can't put the draft back.
 */
export function useDraftAutosave<T>(stash: Stash<T>, value: T, enabled: boolean, delayMs = 500): { clear: () => void } {
  const latest = useRef(value);
  latest.current = value;
  const on = useRef(enabled);
  on.current = enabled;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touched = useRef(false);
  const written = useRef<string | null>(null);

  const write = useCallback(() => {
    timer.current = null;
    if (!on.current) return;
    const snap = JSON.stringify(latest.current);
    if (snap === written.current) return;
    written.current = snap;
    stash.save(latest.current);
  }, [stash]);

  const snapshot = JSON.stringify(value);
  useEffect(() => {
    if (!enabled || snapshot === written.current) return;
    if (!touched.current && stash.isEmpty(latest.current)) return;
    touched.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(write, delayMs);
  }, [snapshot, enabled, delayMs, write, stash]);

  // On unmount, write what is still waiting on the debounce.
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        write();
      }
    },
    [write]
  );

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    written.current = JSON.stringify(latest.current);
    touched.current = false;
    stash.clear();
  }, [stash]);

  return useMemo(() => ({ clear }), [clear]); // stable: callers list it in effect dependencies
}
