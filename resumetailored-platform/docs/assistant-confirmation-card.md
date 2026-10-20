# Assistant confirmation card

Every mutating tool the Employer Portal AI Assistant ever gets — in any later
prompt — asks for approval through ONE shared UI pattern: the confirmation
card (`components/assistant/ActionCard.tsx`). This phase ships the component
and this spec; no mutating tool exists yet, so nothing calls it for real. A
later prompt may not wire up a mutation until the card renders that
mutation's artifact correctly against this spec — the card is the design
gate, not an afterthought bolted on once a tool already works.

## Why a shared card, not one UI per tool

The failure mode this guards against is a chat turn that *says* it did
something ("I've moved Maria to Interviews and sent her a note") while the
employer has no way to tell what was actually about to happen before it
happened. A single, consistent card means an employer only ever has to learn
one interaction, and every mutating tool is forced through the same
discipline: show the real thing, name what's ambiguous, label what can't be
undone, and make every state visible.

## The rule: render the artifact, not a summary of it

The card must show the **actual final content** the tool is about to write —
never a paraphrase.

- Moving a candidate's stage → the real candidate name and the real
  from → to stage labels, not "moving a candidate forward."
- Sending a message → the **full message body** as the candidate will read
  it, not "a follow-up message."
- Posting/editing a job → the **actual job post text** (title, description,
  the fields that changed), not "an updated job listing."
- Scheduling an interview → the real date/time, real candidate name, real
  interviewer — not "an interview."

If the tool's output is too large to show in full (e.g. a long job
description), show it complete and scrollable, never truncated-and-hoped. A
truncated artifact is a paraphrase with extra steps.

## Resolved specifics

When the assistant had to resolve something ambiguous from the request to
reach this exact action — "the hygienist job" → job #482, "move her
forward" → Interviewed stage, "the top 3" → these three named candidates by
match score — the card lists each resolution as a labeled fact (`Job`,
`From`, `To`, `Ranked by`, …), not folded silently into the artifact. The
employer approves the resolution, not just the output.

## Reversibility labeling

Every card declares `irreversible: boolean`:

- **Irreversible** (e.g. sending an email/message, submitting to an external
  system like DocuSign): labeled **"This can't be unsent"** (or the
  tool-specific equivalent — "This can't be un-sent to the candidate",
  "This can't be undone once filed") in the card's action row, visually
  distinct (warm/amber accent) from an undoable action.
- **Undoable** (e.g. moving a pipeline stage, editing a draft job post):
  labeled plainly as changeable later — no warning chrome.

A tool author decides this per action, not per tool — the same tool can have
both (e.g. "save as draft" vs. "send now").

## Batch approval

A single card can carry a **list of items** (e.g. "message these 4
candidates", "move these 6 to Rejected"), each rendering its own artifact and
its own resolved specifics where they differ per item (a per-candidate
message body, for instance). One Approve acts on the whole batch; there is
no partial-approve in this version — a tool that needs per-item approval
should not use a single batch card.

## Visible states

A card is always in exactly one of:

| State | Meaning | UI |
|---|---|---|
| `pending` | Shown, awaiting the employer's decision | Artifact(s), resolved specifics, reversibility label, Approve / Cancel |
| `approved-executed` | Employer approved and the tool call succeeded | Artifact(s) retained on screen (so there's a record of what happened), a success mark, no more Approve/Cancel |
| `failed` | Employer approved but the tool call errored | Artifact(s) retained, the failure reason surfaced in plain language, a Retry affordance (left to the caller — the card surfaces the reason, the caller decides whether Retry re-runs or re-opens `pending`) |

There is no `rejected`/`cancelled` state rendered persistently — a Cancel
simply dismisses the card (the caller may still log that it was offered and
declined, via `lib/assistant-audit.ts`, exactly as "Move Maria to
interviews" being refused in Phase 0 is itself auditable even though nothing
executed).

## Component contract

`components/assistant/ActionCard.tsx` exports:

```ts
type ActionCardState = "pending" | "approved-executed" | "failed";

interface ResolvedSpecific {
  label: string;   // "Job", "From", "To", "Ranked by"
  value: string;
}

interface ActionCardItem {
  id: string;
  /** Short per-item label inside a batch (e.g. a candidate's name). Omit for
   *  a single-item card. */
  label?: string;
  /** The real final artifact text — see "render the artifact" above. */
  artifact: string;
}

interface ActionCardProps {
  title: string;
  irreversible: boolean;
  /** Tool-specific wording for the irreversible warning; falls back to a
   *  generic "This can't be undone" when omitted. */
  irreversibleLabel?: string;
  resolvedSpecifics?: ResolvedSpecific[];
  items: ActionCardItem[];
  state: ActionCardState;
  /** Required when state === "failed"; ignored otherwise. */
  failureReason?: string;
  onApprove?: () => void;
  onCancel?: () => void;
}
```

This phase's `ActionCard` renders all three states (the type is a union and
each is handled), but only `pending` and `failed` are exercised anywhere
right now — there is no mutating tool yet to ever reach
`approved-executed`. The dev-only demo route
(`app/employer/assistant/card-demo/page.tsx`, hidden in production) renders
one `pending` and one `failed` card with realistic sample data, specifically
so a human can eyeball both against this spec without waiting for a real
mutating tool to exist.

## Prompt 2 addendum: the four mutating tools, and the undo sub-state

Four tools now exist (`draft_job_post`, `move_candidates`,
`schedule_interviews`, `message_candidates` — `lib/assistant-tools.ts`), each
behind this exact card, gated to the Scale tier and up
(`canAssistantMutate`, `lib/employer-plan.ts`). A mutating tool's executor
only ever writes a row to `assistant_pending_actions`
(`lib/assistant-pending.ts`) with the rendered artifact already resolved —
it never touches a job, candidate, interview, or message. The real mutation
runs exactly once, when a human approves it
(`app/api/employer/assistant/actions/[id]/approve`,
`lib/assistant-mutations.ts` `executePendingAction`).

The **pending-approvals inbox**
(`components/assistant/PendingActionsInbox.tsx`, mounted in the Assistant
panel) lists every open card for the employer and supports the batch
approval this doc already specified — one Approve acts on every selected
card, each still rendering its own artifact.

**The `undo` sub-state.** `message_candidates` is `irreversible: true` but its
real effect (`lib/employer-collab-store.ts` `sendMessage`) is delayed behind
`ASSISTANT_UNDO_WINDOW_SECONDS` (default 60s) in
`assistant_send_queue` — approving the card doesn't send anything by
itself, it enqueues. `ActionCard`'s `undo` prop extends the
`approved-executed` state with this sub-state, keyed by the queue row's own
status:

| `undo.status` | Rendering |
|---|---|
| `queued` | A live countdown to `undo.deadline` + an Undo button, alongside the irreversible label (shown from the moment of approval, per the rule above — the countdown does not contradict "can't be unsent", it's the grace period before that becomes true) |
| `sent` | "Sent." — no Undo button; the send-queue cancel route (`app/api/employer/assistant/send-queue/[id]/cancel`) answers 409 "This can't be unsent" if asked anyway |
| `cancelled` | "Undone — nothing was sent." |
| `failed` | The queued send itself failed after approval (e.g. the candidate became unavailable) — shown inline, distinct from the top-level `failed` state (which means the *approval/mutation* failed, not the later mechanical send) |

A tool with no delayed effect (the other three) simply omits `undo`, and
`approved-executed` renders exactly as it did in Phase 0.
