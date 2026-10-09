/**
 * Where the script for a run comes from. Pure, so the one rule that protects the user's text is tested:
 *  - a script the user wrote, or an AI script they edited, is used exactly as it stands (no AI call, never overwritten);
 *  - only an empty box — or an untouched AI script whose inputs (resume, style, recipient, opener, closer) have
 *    changed since it was written — is (re)written by the AI. An untouched AI script with unchanged inputs is reused.
 */
export type ScriptSourceChoice = "ai" | "written";

export interface ScriptPlan {
  /** true ⇒ send the box's text on as the script; false ⇒ ask the AI for a fresh one. */
  useAsIs: boolean;
  /** An AI script that was changed by hand (recorded with the saved video). */
  edited: boolean;
}

export function planScript(input: {
  source: ScriptSourceChoice;
  /** The box's text. */
  typed: string;
  /** The AI's last script + the inputs key it was written from, if the box still descends from one. */
  base: { script: string; key: string } | null;
  /** The inputs key for this run. */
  key: string;
}): ScriptPlan {
  const typed = input.typed.trim();
  if (input.source === "written") return { useAsIs: true, edited: false };
  if (!typed) return { useAsIs: false, edited: false };
  const untouched = !!input.base && typed === input.base.script.trim();
  if (untouched) return { useAsIs: input.base!.key === input.key, edited: false };
  return { useAsIs: true, edited: true };
}
