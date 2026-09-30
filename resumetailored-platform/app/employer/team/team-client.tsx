"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { UserPlus, Copy, Check, RefreshCw, Trash2 } from "lucide-react";
import { TEAM_ROLES, type TeamMember, type TeamRole } from "@/lib/employer-ai";
import { Panel, PageHeader, Btn, Field, Input, Picker, Badge, EmptyState, Modal, QuotaBar, UpgradeCard } from "../components/ui";

const ROLE_TONE: Record<TeamRole, "gold" | "violet" | "teal" | "neutral"> = {
  owner: "gold",
  admin: "violet",
  recruiter: "teal",
  viewer: "neutral",
};

export function TeamClient({ canManage, openInvite, seatLimit = null }: { canManage: boolean; openInvite: boolean; seatLimit?: number | null }) {
  const t = useTranslations("employerTeam");
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/employer/team", { cache: "no-store" });
      const d = (await res.json().catch(() => ({}))) as { team?: TeamMember[] };
      setTeam(d.team || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (openInvite && canManage) setInviting(true);
  }, [openInvite, canManage]);

  async function changeRole(id: number, role: TeamRole) {
    setBusyId(id);
    try {
      await fetch(`/api/employer/team/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }) });
      await load();
    } finally {
      setBusyId(null);
    }
  }
  async function resend(id: number) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/employer/team/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "resend" }) });
      const d = (await res.json().catch(() => ({}))) as { link?: string };
      if (d.link) {
        await navigator.clipboard.writeText(d.link).catch(() => {});
        setCopied(id);
        setTimeout(() => setCopied(null), 2000);
      }
      await load();
    } finally {
      setBusyId(null);
    }
  }
  async function remove(id: number) {
    if (!confirm(t("confirmRemove"))) return;
    setBusyId(id);
    try {
      await fetch(`/api/employer/team/${id}`, { method: "DELETE" });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          canManage ? (
            <Btn onClick={() => setInviting(true)}>
              <UserPlus className="h-4 w-4" /> {t("inviteTeamMember")}
            </Btn>
          ) : undefined
        }
      />

      {seatLimit !== null && (
        <QuotaBar label="team seats" used={team.length} limit={seatLimit} nextTierLabel="Employer Portal" />
      )}

      {loading ? (
        <Panel className="text-sm text-white/50">{t("loadingTeam")}</Panel>
      ) : team.length === 0 ? (
        <EmptyState icon={UserPlus} title={t("emptyStateTitle")} body={t("emptyStateBody")} />
      ) : (
        <Panel className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border-gold text-left text-xs uppercase tracking-wide text-white/45">
                <th className="px-4 py-3 font-semibold">{t("colMember")}</th>
                <th className="px-4 py-3 font-semibold">{t("colRole")}</th>
                <th className="px-4 py-3 font-semibold">{t("colStatus")}</th>
                <th className="px-4 py-3 font-semibold">{t("colAdded")}</th>
                {canManage && <th className="px-4 py-3 text-right font-semibold">{t("colActions")}</th>}
              </tr>
            </thead>
            <tbody>
              {team.map((m) => (
                <tr key={m.id} className="border-b border-border-gold/50 last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-cream">{m.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    {canManage && m.role !== "owner" ? (
                      <Picker value={m.role} onChange={(e) => changeRole(m.id, e.target.value as TeamRole)} disabled={busyId === m.id} className="w-32">
                        {TEAM_ROLES.filter((r) => r !== "owner").map((r) => (
                          <option key={r} value={r}>
                            {t(`role.${r}`)}
                          </option>
                        ))}
                      </Picker>
                    ) : (
                      <Badge tone={ROLE_TONE[m.role]}>{t(`role.${m.role}`)}</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={m.status === "active" ? "teal" : "gold"}>{m.status === "active" ? t("active") : t("pendingInvite")}</Badge>
                  </td>
                  <td className="px-4 py-3 text-white/60">{fmtDate(m.createdAt)}</td>
                  {canManage && (
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {m.status === "pending" && (
                          <button type="button" title={t("resendInviteTitle")} onClick={() => resend(m.id)} disabled={busyId === m.id} className="rounded-md p-1.5 text-muted-cream hover:bg-white/8 hover:text-cream disabled:opacity-40">
                            {copied === m.id ? <Check className="h-4 w-4 text-teal" /> : <RefreshCw className="h-4 w-4" />}
                          </button>
                        )}
                        {m.role !== "owner" && (
                          <button type="button" title={t("remove")} onClick={() => remove(m.id)} disabled={busyId === m.id} className="rounded-md p-1.5 text-red-300 hover:bg-red-500/15 disabled:opacity-40">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {inviting && <InviteModal onClose={() => setInviting(false)} onSaved={async () => { await load(); }} />}

      <UpgradeCard />
    </div>
  );
}

function InviteModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const t = useTranslations("employerTeam");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("recruiter");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ link: string; emailed: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit() {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError(t("errorInvalidEmail"));
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/employer/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, role }) });
      const d = (await res.json().catch(() => ({}))) as { link?: string; emailed?: boolean; error?: string };
      if (!res.ok || !d.link) throw new Error(d.error || t("errorCouldNotSendInvite"));
      setResult({ link: d.link, emailed: !!d.emailed });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errorGeneric"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={t("inviteTeamMember")} onClose={onClose}>
      {result ? (
        <div className="space-y-4">
          <p className="text-sm text-white/75">
            {result.emailed ? t("inviteEmailSent") : t("inviteCreated")}
            {" "}{t("shareThisLink")}
          </p>
          <div className="flex gap-2">
            <Input readOnly value={result.link} onFocus={(e) => e.currentTarget.select()} />
            <Btn
              variant="ghost"
              className="shrink-0"
              onClick={async () => {
                await navigator.clipboard.writeText(result.link).catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? <Check className="h-4 w-4 text-teal" /> : <Copy className="h-4 w-4" />} {copied ? t("copied") : t("copy")}
            </Btn>
          </div>
          <div className="flex justify-end">
            <Btn onClick={onClose}>{t("done")}</Btn>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label={t("fieldEmail")}>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" autoFocus />
          </Field>
          <Field label={t("fieldRole")}>
            <Picker value={role} onChange={(e) => setRole(e.target.value as TeamRole)}>
              {TEAM_ROLES.filter((r) => r !== "owner").map((r) => (
                <option key={r} value={r}>
                  {t(`role.${r}`)}
                </option>
              ))}
            </Picker>
          </Field>
          {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
          <div className="flex justify-end">
            <Btn onClick={submit} loading={saving}>
              {t("sendInvite")}
            </Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
