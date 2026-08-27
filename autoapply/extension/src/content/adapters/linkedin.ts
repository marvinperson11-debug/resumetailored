import type { Adapter } from "./types";
import type { ApplyData } from "../../lib/api";
import { fillByHints, selectByHints } from "../../lib/filler";
import { fillCustomQuestions } from "./common";

// LinkedIn Easy Apply is a multi-step modal (div.jobs-easy-apply-modal). Each
// step renders a few fields; the user clicks "Next" between them. We fill
// whatever is currently visible; ats.ts's MutationObserver re-runs fill() as
// new steps mount. LinkedIn pre-fills identity from the profile, so we mostly
// handle phone, the free-text/custom questions, and dropdowns.
export const linkedinAdapter: Adapter = {
  id: "linkedin",
  matches: (url) => /linkedin\.com\/jobs\//.test(url),
  fill(data: ApplyData) {
    const modal = document.querySelector(".jobs-easy-apply-modal") || document.body;
    if (!modal) return;

    const p = data.personal;

    // Phone/email are the common editable identity fields in Easy Apply.
    fillByHints(["mobile phone", "phone"], p.phone);
    fillByHints(["email address", "email"], p.email);

    // City / location typeahead.
    fillByHints(["city", "location"], p.location, { negative: ["relocat"] });

    // Common numeric screening questions map poorly to free text; handle
    // salary + notice period which we do have.
    fillByHints(["desired salary", "salary expectation", "expected salary"], data.preferredSalary);
    fillByHints(["notice period", "when can you start", "available to start"], data.startDate);

    // Yes/No and experience dropdowns — best effort on work authorization is
    // intentionally skipped (legal). Map "years of experience"-style selects.
    selectByHints(["years of experience", "how many years"], "3");

    // Everything else (custom screening questions) → suggested answers.
    fillCustomQuestions(data);
  },
};
