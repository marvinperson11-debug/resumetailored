// Generic form-filling engine shared by every ATS adapter.
// Finds fields by their visible label / name / placeholder / aria, sets the
// value in a way React and Angular forms accept, and tints filled fields green.

export type Fillable = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const HIGHLIGHT = "2px solid #10b981";
const HIGHLIGHT_BG = "rgba(16,185,129,0.08)";

let filledCount = 0;
export function resetCount() { filledCount = 0; }
export function getCount() { return filledCount; }

/** Set a value on an input/textarea so framework listeners fire. */
export function setNativeValue(el: Fillable, value: string) {
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  const setter = desc?.set;
  if (setter) setter.call(el, value);
  else (el as HTMLInputElement).value = value;

  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function highlight(el: HTMLElement) {
  el.style.outline = HIGHLIGHT;
  el.style.outlineOffset = "1px";
  el.style.backgroundColor = HIGHLIGHT_BG;
  el.setAttribute("data-autoapply-filled", "1");
}

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

/** The human-readable label text associated with a field, lowercased. */
export function labelTextFor(el: Fillable): string {
  const parts: string[] = [];
  if (el.id) {
    const lab = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(el.id)}"]`);
    if (lab?.textContent) parts.push(lab.textContent);
  }
  const wrappingLabel = el.closest("label");
  if (wrappingLabel?.textContent) parts.push(wrappingLabel.textContent);
  const aria = el.getAttribute("aria-label");
  if (aria) parts.push(aria);
  const labelledby = el.getAttribute("aria-labelledby");
  if (labelledby) {
    labelledby.split(/\s+/).forEach((id) => {
      const t = document.getElementById(id)?.textContent;
      if (t) parts.push(t);
    });
  }
  parts.push(el.getAttribute("name") ?? "");
  parts.push(el.getAttribute("placeholder") ?? "");
  parts.push(el.id ?? "");
  return parts.join(" ").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Find the first visible, empty field whose label matches ANY hint and NONE
 * of the negative hints. `hints` are matched as substrings.
 */
export function findField(hints: string[], opts: { negative?: string[]; includeFilled?: boolean } = {}): Fillable | null {
  const candidates = Array.from(
    document.querySelectorAll<Fillable>("input, textarea, select")
  ).filter((el) => {
    const type = (el as HTMLInputElement).type;
    if (["hidden", "submit", "button", "file", "checkbox", "radio", "password"].includes(type)) return false;
    if (!isVisible(el)) return false;
    if (!opts.includeFilled && (el as HTMLInputElement).value) return false;
    return true;
  });

  for (const el of candidates) {
    const text = labelTextFor(el);
    if (opts.negative?.some((n) => text.includes(n))) continue;
    if (hints.some((h) => text.includes(h))) return el;
  }
  return null;
}

/** Fill a text/textarea field found by hints. Returns true if it filled. */
export function fillByHints(hints: string[], value: string | null | undefined, opts?: { negative?: string[] }): boolean {
  if (!value) return false;
  const el = findField(hints, opts);
  if (!el || el.tagName === "SELECT") return false;
  setNativeValue(el, value);
  highlight(el);
  filledCount++;
  return true;
}

/** Fill a specific element directly. */
export function fillElement(el: Fillable, value: string | null | undefined): boolean {
  if (!value) return false;
  setNativeValue(el, value);
  highlight(el);
  filledCount++;
  return true;
}

/** Choose the closest option in a <select> by hints, then value text. */
export function selectByHints(hints: string[], value: string | null | undefined): boolean {
  if (!value) return false;
  const el = findField(hints, { includeFilled: true });
  if (!el || el.tagName !== "SELECT") return false;
  const sel = el as HTMLSelectElement;
  const wanted = value.toLowerCase();
  const match = Array.from(sel.options).find(
    (o) => o.text.toLowerCase().includes(wanted) || wanted.includes(o.text.toLowerCase())
  );
  if (!match) return false;
  sel.value = match.value;
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  highlight(sel);
  filledCount++;
  return true;
}
