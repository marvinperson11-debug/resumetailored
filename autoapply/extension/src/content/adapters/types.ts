import type { ApplyData } from "../../lib/api";

export interface Adapter {
  id: string;
  /** Does this adapter handle the current page? */
  matches(url: string): boolean;
  /** Fill the form. May be called more than once (SPA navigations). */
  fill(data: ApplyData): Promise<void> | void;
}
