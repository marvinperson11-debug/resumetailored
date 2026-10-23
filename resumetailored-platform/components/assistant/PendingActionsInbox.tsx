"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ActionCard, type ActionCardUndo } from "./ActionCard";

interface ArtifactItem {
  id: string;
  label?: string;
  artifact: string;
}
interface Artifact {
  title: string;
  irreversible: boolean;
  irreversibleLabel?: string;
  resolvedSpecifics?: { label: string; value: string }[];
  items: ArtifactItem[];
  blocked?: boolean;
}
type PendingStatus = "pending" | "executed" | "cancelled" | "failed";
interface PendingAction {
  id: string;
  action: string;
  artifact: Artifact;
  irreversible: boolean;
  status: PendingStatus;
  failureReason: string | null;
  createdAt: string;
  expiresAt: string;
}
interface UndoState {
  sendQueueId: string;
  deadline: string;
  status: ActionCardUndo["status"];
}
interface ResolvedCard {
  artifact: Artifact;
  status: PendingStatus;
  failureReason: string | null;
  undo?: UndoState;
}

/**
 * The employer's own open approvals inbox
 * (docs/assistant-confirmation-card.md "batch approval"): every action a
 * mutating Assistant tool has drafted and is waiting on a human for, each
 * rendered through the SAME ActionCard every card in this product uses.
 * Polls GET /api/employer/assistant/actions on an interval so a card drafted
 * on a teammate's screen still shows up here without a page reload.
 */
export function PendingActionsInbox() {
  const t = useTranslations("employerAssistant");
  const [actions, setActions] = useState<PendingAction[]>([]);
  const [resolved, setResolved] = useState<Record<string, ResolvedCard>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/employer/assistant/actions");
      if (!res.ok) return;
      const data = (await res.json()) as { actions?: PendingAction[] };
      setActions(data.actions || []);
    } catch {
      // best-effort — the inbox just stays as it was
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, [load]);

  function unselect(id: string) {
    setSelected((s) => {
      if (!s.has(id)) return s;
      const copy = new Set(s);
      copy.delete(id);
      return copy;
    });
  }

  function applyResolution(id: string, artifact: Artifact, status: PendingStatus, failureReason: string | null, sendQueue?: { id: string; sendAt: string; status: string }[]) {
    const firstSend = (sendQueue || [])[0];
    setResolved((r) => ({
      ...r,
      [id]: {
        artifact,
        status,
        failureReason,
        undo: firstSend ? { sendQueueId: firstSend.id, deadline: firstSend.sendAt, status: firstSend.status as ActionCardUndo["status"] } : undefined,
      },
    }));
    setActions((prev) => prev.filter((a) => a.id !== id));
    unselect(id);
  }

  async function approveOne(action: PendingAction) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/employer/assistant/actions/${action.id}/approve`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { status?: PendingStatus; failureReason?: string | null; sendQueue?: { id: string; sendAt: string; status: string }[]; message?: string };
      if (!res.ok) {
        setError(data.message || t("genericError"));
        return;
      }
      applyResolution(action.id, action.artifact, data.status || "executed", data.failureReason ?? null, data.sendQueue);
    } catch {
      setError(t("genericError"));
    } finally {
      setBusy(false);
      load();
    }
  }

  async function cancelOne(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/employer/assistant/actions/${id}/cancel`, { method: "POST" });
    } finally {
      setBusy(false);
      unselect(id);
      setActions((prev) => prev.filter((a) => a.id !== id));
      load();
    }
  }

  async function approveSelected() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    const byId = new Map(actions.map((a) => [a.id, a]));
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/employer/assistant/actions/batch-approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = (await res.json().catch(() => ({ results: [] }))) as { results?: { id: string; status: PendingStatus | "forbidden" | "not_found" | null; failureReason: string | null }[] };
      for (const r of data.results || []) {
        const original = byId.get(r.id);
        if (!original || !r.status || r.status === "forbidden" || r.status === "not_found") continue;
        applyResolution(r.id, original.artifact, r.status, r.failureReason);
      }
    } catch {
      setError(t("genericError"));
    } finally {
      setBusy(false);
      setSelected(new Set());
      load();
    }
  }

  async function undoSend(cardId: string, sendQueueId: string) {
    try {
      const res = await fetch(`/api/employer/assistant/send-queue/${sendQueueId}/cancel`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { status?: string };
      setResolved((r) => {
        const row = r[cardId];
        if (!row || !row.undo) return r;
        const nextStatus = res.ok ? (data.status as ActionCardUndo["status"]) || "cancelled" : "sent";
        return { ...r, [cardId]: { ...row, undo: { ...row.undo, status: nextStatus } } };
      });
    } catch {
      // best-effort — the server-side send is still correctly gated either way
    }
  }

  const resolvedEntries = Object.entries(resolved);
  if (!actions.length && !resolvedEntries.length) return null;

  return (
    <div className="mb-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-white/55">{t("pendingApprovals")}</h2>
        {actions.length > 1 && (
          <button
            type="button"
            disabled={busy || !selected.size}
            onClick={approveSelected}
            className="rounded-lg bg-violet px-3 py-1 text-xs font-semibold text-white transition-colors disabled:opacity-40"
          >
            {t("approveSelected", { count: selected.size })}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}

      {actions.map((a) => (
        <div key={a.id} className="flex items-start gap-2">
          {actions.length > 1 && (
            <input
              type="checkbox"
              className="mt-4 h-3.5 w-3.5"
              checked={selected.has(a.id)}
              onChange={(e) =>
                setSelected((s) => {
                  const copy = new Set(s);
                  if (e.target.checked) copy.add(a.id);
                  else copy.delete(a.id);
                  return copy;
                })
              }
              aria-label={a.artifact.title}
            />
          )}
          <div className="flex-1">
            <ActionCard
              title={a.artifact.title}
              irreversible={a.artifact.irreversible}
              irreversibleLabel={a.artifact.irreversibleLabel}
              resolvedSpecifics={a.artifact.resolvedSpecifics}
              items={a.artifact.items}
              state="pending"
              blocked={a.artifact.blocked}
              onApprove={() => approveOne(a)}
              onCancel={() => cancelOne(a.id)}
            />
          </div>
        </div>
      ))}

      {resolvedEntries.map(([id, r]) => (
        <ActionCard
          key={id}
          title={r.artifact.title}
          irreversible={r.artifact.irreversible}
          irreversibleLabel={r.artifact.irreversibleLabel}
          resolvedSpecifics={r.artifact.resolvedSpecifics}
          items={r.artifact.items}
          state={r.status === "failed" ? "failed" : "approved-executed"}
          failureReason={r.failureReason || undefined}
          undo={r.undo ? { deadline: r.undo.deadline, status: r.undo.status, onUndo: () => undoSend(id, r.undo!.sendQueueId) } : undefined}
        />
      ))}
    </div>
  );
}
