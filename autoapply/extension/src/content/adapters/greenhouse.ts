import type { Adapter } from "./types";
import type { ApplyData } from "../../lib/api";
import { fillCommonFields } from "./common";
import { fillByHints, fillElement, type Fillable } from "../../lib/filler";

// Greenhouse job boards (boards.greenhouse.io, job-boards.greenhouse.io, and
// embedded greenhouse iframes). Fields use #first_name, #last_name, #email,
// #phone plus custom question ids.
export const greenhouseAdapter: Adapter = {
  id: "greenhouse",
  matches: (url) => /greenhouse\.io/.test(url),
  fill(data: ApplyData) {
    const p = data.personal;
    const [firstName, ...rest] = (p.fullName || "").split(" ");

    // Greenhouse's canonical ids first (most reliable), then fall back to hints.
    fillById("first_name", firstName);
    fillById("last_name", rest.join(" "));
    fillById("email", p.email);
    fillById("phone", p.phone);

    // LinkedIn / website often appear as custom questions.
    fillByHints(["linkedin profile", "linkedin"], p.linkedin);
    fillByHints(["website", "portfolio"], p.portfolio || p.website);

    fillCommonFields(data);
  },
};

function fillById(id: string, value: string | undefined) {
  if (!value) return;
  const el = document.getElementById(id) as Fillable | null;
  if (el && !(el as HTMLInputElement).value) fillElement(el, value);
}
