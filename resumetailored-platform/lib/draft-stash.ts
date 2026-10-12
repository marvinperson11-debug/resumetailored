/**
 * The one place an in-progress draft is parked in sessionStorage.
 *
 * Two things use it, and they share the SAME key per form so there is never a second copy:
 *   1. AUTOSAVE — a form writes its draft as it is typed (debounced) and puts it back when the user
 *      returns (navigated away, refreshed, closed the modal). Guests and signed-in users alike.
 *   2. SIGN-UP HAND-OFF — "Create free account" writes the same record with `handoff: true`, which is
 *      what tells the signed-in side "this person just signed up: take them to their draft". Plain
 *      autosave never sets it, so a signed-in user with an autosaved draft is never redirected.
 *
 * sessionStorage (not localStorage) on purpose: per tab, dies with the tab, so a draft can never
 * surface in a later visit or on a shared machine. Every function swallows storage errors — a
 * blocked or full store just means no draft, never a broken form. A record carries only form text:
 * no quota state, and restoring one never calls a model or publishes anything.
 */

export type StoreLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function defaultStore(): StoreLike | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export interface StashDef<T> {
  key: string;
  ttlMs: number;
  /** Rebuild a well-formed draft from untrusted JSON, or null. */
  parse: (raw: unknown) => T | null;
  /** Nothing worth keeping (an empty form is never stored, and clears any older record). */
  isEmpty: (d: T) => boolean;
  /** If the store is full, a smaller version of the draft to try instead (e.g. without a photo). */
  shrink?: (d: T) => T | null;
}

export interface Stash<T> {
  readonly key: string;
  readonly ttlMs: number;
  isEmpty: (d: T) => boolean;
  /**
   * Write the draft (replacing any older one). Returns true if something was stored. `handoff`:
   * true flags it for the new account; omitted keeps whatever flag the record already had, so an
   * autosave landing right after "Create free account" can't strip the hand-off; false clears it.
   */
  save: (draft: T | null, opts?: { handoff?: boolean; store?: StoreLike | null; now?: number }) => boolean;
  /** The fresh draft, left in place. Stale or malformed records are removed. */
  read: (store?: StoreLike | null, now?: number) => T | null;
  /** Is a fresh record flagged as a sign-up hand-off waiting? (Does not consume it.) */
  pendingHandoff: (store?: StoreLike | null, now?: number) => boolean;
  /** Read AND remove the draft, but ONLY a sign-up hand-off — autosave is left alone. */
  takeHandoff: (store?: StoreLike | null, now?: number) => T | null;
  clear: (store?: StoreLike | null) => void;
}

export function createStash<T>(def: StashDef<T>): Stash<T> {
  type Rec = { v?: unknown; savedAt?: unknown; handoff?: unknown; draft?: unknown };

  /** Parse one raw record; null if stale / malformed / empty. */
  function open(raw: string | null, now: number): { draft: T; handoff: boolean } | null {
    if (!raw) return null;
    try {
      const p = JSON.parse(raw) as Rec;
      if (!p || p.v !== 1 || typeof p.savedAt !== "number" || now - p.savedAt > def.ttlMs || now < p.savedAt - 60_000) return null;
      const draft = def.parse(p.draft);
      return draft && !def.isEmpty(draft) ? { draft, handoff: p.handoff === true } : null;
    } catch {
      return null;
    }
  }

  function load(store: StoreLike, now: number): { draft: T; handoff: boolean } | null {
    let raw: string | null = null;
    try {
      raw = store.getItem(def.key);
    } catch {
      return null;
    }
    if (raw === null) return null;
    const rec = open(raw, now);
    if (!rec) {
      try {
        store.removeItem(def.key); // unusable: don't leave it to be re-parsed forever
      } catch {
        /* ignore */
      }
    }
    return rec;
  }

  return {
    key: def.key,
    ttlMs: def.ttlMs,
    isEmpty: def.isEmpty,
    save(draft, opts = {}) {
      const store = opts.store === undefined ? defaultStore() : opts.store;
      const now = opts.now ?? Date.now();
      if (!store) return false;
      try {
        const handoff = opts.handoff ?? load(store, now)?.handoff === true;
        store.removeItem(def.key); // never leave an older record behind
        if (!draft || def.isEmpty(draft)) return false;
        const write = (d: T) => store.setItem(def.key, JSON.stringify({ v: 1, savedAt: now, ...(handoff ? { handoff: true } : {}), draft: d }));
        try {
          write(draft);
        } catch {
          const small = def.shrink ? def.shrink(draft) : null;
          if (!small) return false;
          write(small);
        }
        return true;
      } catch {
        return false;
      }
    },
    read(store = defaultStore(), now = Date.now()) {
      return store ? (load(store, now)?.draft ?? null) : null;
    },
    pendingHandoff(store = defaultStore(), now = Date.now()) {
      return store ? load(store, now)?.handoff === true : false;
    },
    takeHandoff(store = defaultStore(), now = Date.now()) {
      if (!store) return null;
      const rec = load(store, now);
      if (!rec?.handoff) return null;
      try {
        store.removeItem(def.key);
      } catch {
        return null;
      }
      return rec.draft;
    },
    clear(store = defaultStore()) {
      try {
        store?.removeItem(def.key);
      } catch {
        /* ignore */
      }
    },
  };
}
