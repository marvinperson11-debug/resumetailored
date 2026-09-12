/**
 * Shared (type-only + tiny pure helpers) glue for the Web Studio editor —
 * imported by the shell, canvas and panels so none of them import each other's
 * component modules directly (keeps the value-import graph acyclic).
 */
import type {
  StudioSite, StudioSection, StudioElement, StudioTheme, SectionType, ElementType, SectionBackground, StyleMap,
} from "@/lib/studio-types";

export type Device = "desktop" | "tablet" | "mobile";

export type Selection =
  | { kind: "page" }
  | { kind: "section"; sectionId: string }
  | { kind: "element"; sectionId: string; elementId: string };

export function findSection(site: StudioSite, id: string | undefined): StudioSection | undefined {
  return id ? site.sections.find((s) => s.id === id) : undefined;
}
export function findElement(site: StudioSite, secId: string | undefined, elId: string | undefined): StudioElement | undefined {
  const sec = findSection(site, secId);
  return sec && elId ? sec.elements.find((e) => e.id === elId) : undefined;
}

/** All mutation entry points the panels/canvas call. Every one goes through the
 *  shell's history-aware setter so undo/redo and autosave stay consistent. */
export interface StudioActions {
  patchSite: (patch: Partial<StudioSite>) => void;
  patchTheme: (patch: Partial<StudioTheme>) => void;
  patchSection: (id: string, patch: Partial<StudioSection>) => void;
  setSectionBg: (id: string, bg: SectionBackground) => void;
  patchElement: (secId: string, elId: string, patch: Partial<StudioElement>) => void;
  patchElementStyle: (secId: string, elId: string, style: StyleMap) => void;
  patchElementProps: (secId: string, elId: string, props: Record<string, string | number | boolean>) => void;
  setElementContent: (secId: string, elId: string, content: string) => void;
  addSection: (type: SectionType, afterSectionId?: string) => void;
  addElement: (type: ElementType, secId?: string) => void;
  deleteSection: (id: string) => void;
  duplicateSection: (id: string) => void;
  moveSection: (id: string, dir: -1 | 1) => void;
  reorderSection: (id: string, toIndex: number) => void;
  toggleSectionVisible: (id: string) => void;
  deleteElement: (secId: string, elId: string) => void;
  duplicateElement: (secId: string, elId: string) => void;
  moveElement: (secId: string, elId: string, dir: -1 | 1) => void;
  reorderElement: (secId: string, elId: string, toIndex: number) => void;
}

export const DEVICE_WIDTH: Record<Device, number> = { desktop: 1200, tablet: 768, mobile: 390 };

/** Read any file to a data URL (no downscale). Guarded so we don't bloat the
 *  site JSON — large media should be a hosted URL instead. Returns null if the
 *  file is over `maxBytes` (default 6 MB). */
export async function fileToDataUrl(file: File, maxBytes = 6_000_000): Promise<string | null> {
  if (file.size > maxBytes) return null;
  return new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

/** Downscale an image file to a compact JPEG data URL (kept small for the JSON). */
export async function imageToDataUrl(file: File, max = 1200): Promise<string> {
  const raw = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  try {
    const img = document.createElement("img");
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = raw; });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    if (scale >= 1 && raw.length < 400_000) return raw;
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    const ctx = c.getContext("2d");
    if (!ctx) return raw;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  } catch {
    return raw;
  }
}
