import type { Adapter } from "./types";
import type { ApplyData } from "../../lib/api";
import { fillCommonFields } from "./common";
import { fillByHints, fillElement } from "../../lib/filler";

// Lever (jobs.lever.co/<company>/<id>/apply). Fields use name="name",
// name="email", name="phone", name="urls[LinkedIn]", name="urls[Portfolio]".
export const leverAdapter: Adapter = {
  id: "lever",
  matches: (url) => /jobs\.lever\.co/.test(url),
  fill(data: ApplyData) {
    const p = data.personal;

    fillByName("name", p.fullName);
    fillByName("email", p.email);
    fillByName("phone", p.phone);
    fillByName("org", ""); // current company — left blank intentionally

    // Lever nests links under urls[...]
    fillByHints(["linkedin"], p.linkedin);
    fillByHints(["portfolio", "website", "github"], p.portfolio || p.website);

    // Lever "Additional information" textarea → cover letter.
    fillByHints(["additional information", "cover letter"], data.coverLetter);

    fillCommonFields(data);
  },
};

function fillByName(name: string, value: string | undefined) {
  if (!value) return;
  const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `input[name="${name}"], textarea[name="${name}"]`
  );
  if (el && !el.value) fillElement(el, value);
}
