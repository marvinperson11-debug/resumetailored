import type { Adapter } from "./types";
import type { ApplyData } from "../../lib/api";
import { fillCommonFields } from "./common";
import { findField, fillElement } from "../../lib/filler";

// Workday (*.myworkdayjobs.com). Workday is a heavy React app with
// automation-id attributes and lazy-rendered sections, so we lean on
// data-automation-id where available and retry via the MutationObserver in
// ats.ts. Legal / EEO selects are deliberately left to the user.
export const workdayAdapter: Adapter = {
  id: "workday",
  matches: (url) => /myworkdayjobs\.com/.test(url),
  fill(data: ApplyData) {
    const p = data.personal;
    const [firstName, ...rest] = (p.fullName || "").split(" ");

    fillByAutomationId("legalNameSection_firstName", firstName);
    fillByAutomationId("legalNameSection_lastName", rest.join(" "));
    fillByAutomationId("email", p.email);
    fillByAutomationId("phone-number", p.phone);
    fillByAutomationId("addressSection_city", p.location);

    // Fall back to label-based matching for everything else.
    fillCommonFields(data);
  },
};

function fillByAutomationId(id: string, value: string | undefined) {
  if (!value) return;
  const container = document.querySelector(`[data-automation-id="${id}"]`);
  const el =
    (container as HTMLInputElement | null) ??
    (container?.querySelector("input, textarea") as HTMLInputElement | null);
  if (el && "value" in el && !el.value) {
    fillElement(el, value);
    return;
  }
  // Last resort: hint search on the automation id words.
  const words = id.replace(/([A-Z])/g, " $1").replace(/_/g, " ").toLowerCase();
  const found = findField(words.split(/\s+/).filter((w) => w.length > 2));
  if (found && found.tagName !== "SELECT") fillElement(found, value);
}
