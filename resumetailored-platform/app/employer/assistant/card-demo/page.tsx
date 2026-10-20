import { notFound } from "next/navigation";
import { ActionCard } from "@/components/assistant/ActionCard";

export const dynamic = "force-dynamic";

/**
 * Dev-only demo route: no mutating Assistant tool exists yet to ever render
 * a real ActionCard, so this is how a human eyeballs the pending/failed
 * states against docs/assistant-confirmation-card.md without one. Hidden in
 * production — it's a story, not a feature.
 */
export default function AssistantCardDemoPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="font-serif text-xl font-medium text-cream">ActionCard demo (dev only)</h1>
        <p className="mt-1 text-sm text-white/55">Sample data — nothing on this page calls a real tool. See docs/assistant-confirmation-card.md.</p>
      </div>

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/45">Pending — batch, irreversible</h2>
        <ActionCard
          title="Send a follow-up message to 2 candidates"
          irreversible
          irreversibleLabel="This can't be unsent"
          resolvedSpecifics={[{ label: "Job", value: "Dental Hygienist — Downtown Clinic" }]}
          items={[
            {
              id: "1",
              label: "Maria Alvarez",
              artifact:
                "Hi Maria,\n\nThanks for your patience — we'd like to move forward with an interview. Are you available this Thursday or Friday afternoon?\n\nBest,\nDowntown Clinic",
            },
            {
              id: "2",
              label: "Devon Wu",
              artifact:
                "Hi Devon,\n\nThanks for your patience — we'd like to move forward with an interview. Are you available this Thursday or Friday afternoon?\n\nBest,\nDowntown Clinic",
            },
          ]}
          state="pending"
        />
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/45">Pending — single item, undoable</h2>
        <ActionCard
          title="Move candidate to Interviewed"
          irreversible={false}
          resolvedSpecifics={[
            { label: "Candidate", value: "Maria Alvarez" },
            { label: "From", value: "Shortlisted" },
            { label: "To", value: "Interviewed" },
          ]}
          items={[{ id: "1", artifact: "Maria Alvarez — Dental Hygienist — Downtown Clinic" }]}
          state="pending"
        />
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/45">Failed</h2>
        <ActionCard
          title="Send a follow-up message to Maria Alvarez"
          irreversible
          items={[
            {
              id: "1",
              artifact: "Hi Maria,\n\nThanks for your patience — we'd like to move forward with an interview...",
            },
          ]}
          state="failed"
          failureReason="The candidate's email on file bounced (invalid address). Nothing was sent."
        />
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/45">Approved — executed (undoable, Scale tier)</h2>
        <ActionCard
          title="Send a message to Maria Alvarez"
          irreversible
          irreversibleLabel="This can't be unsent once it sends"
          items={[{ id: "1", artifact: "Hi Maria, thanks for your patience — we'd like to move forward with an interview." }]}
          state="approved-executed"
          undo={{ deadline: new Date(Date.now() + 45_000).toISOString(), status: "queued" }}
        />
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/45">Approved — executed, sent (undo window closed)</h2>
        <ActionCard
          title="Send a message to Maria Alvarez"
          irreversible
          items={[{ id: "1", artifact: "Hi Maria, thanks for your patience — we'd like to move forward with an interview." }]}
          state="approved-executed"
          undo={{ deadline: new Date(Date.now() - 60_000).toISOString(), status: "sent" }}
        />
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/45">Approved — executed, undone</h2>
        <ActionCard
          title="Send a message to Maria Alvarez"
          irreversible
          items={[{ id: "1", artifact: "Hi Maria, thanks for your patience — we'd like to move forward with an interview." }]}
          state="approved-executed"
          undo={{ deadline: new Date(Date.now() - 10_000).toISOString(), status: "cancelled" }}
        />
      </section>

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/45">Approved — executed, plain (e.g. move_candidates)</h2>
        <ActionCard
          title="Move Devon Wu to Interviewed"
          irreversible={false}
          resolvedSpecifics={[
            { label: "Candidate", value: "Devon Wu" },
            { label: "From", value: "Shortlisted" },
            { label: "To", value: "Interviewed" },
          ]}
          items={[{ id: "1", artifact: "Devon Wu: Shortlisted → Interviewed" }]}
          state="approved-executed"
        />
      </section>
    </div>
  );
}
