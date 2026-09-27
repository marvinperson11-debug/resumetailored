"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Star, Plus, Trash2, Pencil, UserPlus, X, Mail, MessageSquare, Search, FileSignature } from "lucide-react";
import Link from "next/link";
import { type Shortlist, type Applicant, type ApplicantStatus } from "@/lib/employer-ai";
import { Panel, PageHeader, Btn, Field, Input, Area, Badge, EmptyState, Modal, Drawer, ScoreChip } from "../components/ui";
import { SendDocumentModal } from "../components/send-document-modal";

const STATUS_TONE: Record<ApplicantStatus, "neutral" | "sky" | "violet" | "gold" | "teal" | "red"> = {
  new: "sky",
  reviewed: "neutral",
  shortlisted: "violet",
  interviewed: "gold",
  "offer extended": "gold",
  hired: "teal",
  rejected: "red",
};

export function ShortlistsClient() {
  const t = useTranslations("employerShortlists");
  const [shortlists, setShortlists] = useState<Shortlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Shortlist | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/employer/shortlists", { cache: "no-store" });
      const d = (await res.json().catch(() => ({}))) as { shortlists?: Shortlist[] };
      setShortlists(d.shortlists || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const open = shortlists.find((s) => s.id === openId) || null;

  return (
    <div>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        action={
          <Btn onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> {t("newShortlist")}
          </Btn>
        }
      />

      {loading ? (
        <Panel className="text-sm text-white/50">{t("loadingShortlists")}</Panel>
      ) : shortlists.length === 0 ? (
        <EmptyState
          icon={Star}
          title={t("emptyStateTitle")}
          body={t("emptyStateBody")}
          action={
            <Btn onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> {t("newShortlist")}
            </Btn>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shortlists.map((s) => (
            <Panel key={s.id} className="flex flex-col">
              <button type="button" onClick={() => setOpenId(s.id)} className="flex-1 text-left">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <h3 className="font-serif text-lg font-medium text-cream">{s.name}</h3>
                  <Badge tone="violet">{s.memberCount}</Badge>
                </div>
                {s.description && <p className="line-clamp-3 text-sm text-white/55">{s.description}</p>}
                <p className="mt-3 text-xs text-white/40">{t("candidateCount", { count: s.memberCount })}</p>
              </button>
              <div className="mt-4 flex gap-2 border-t border-border-gold/60 pt-3">
                <button type="button" onClick={() => setOpenId(s.id)} className="text-xs font-semibold text-violet hover:underline">
                  {t("open")}
                </button>
                <button type="button" onClick={() => setEditing(s)} className="ml-auto text-white/45 hover:text-cream" aria-label={t("edit")}>
                  <Pencil className="h-4 w-4" />
                </button>
                <DeleteButton shortlist={s} onDeleted={load} />
              </div>
            </Panel>
          ))}
        </div>
      )}

      {creating && <ShortlistForm onClose={() => setCreating(false)} onSaved={async () => { setCreating(false); await load(); }} />}
      {editing && (
        <ShortlistForm existing={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />
      )}
      {open && <ShortlistDrawer shortlist={open} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}

function DeleteButton({ shortlist, onDeleted }: { shortlist: Shortlist; onDeleted: () => void }) {
  const t = useTranslations("employerShortlists");
  const [confirming, setConfirming] = useState(false);
  async function del() {
    await fetch(`/api/employer/shortlists/${shortlist.id}`, { method: "DELETE" });
    onDeleted();
  }
  return confirming ? (
    <span className="flex items-center gap-1 text-xs">
      <button type="button" onClick={del} className="font-semibold text-red-300 hover:underline">
        {t("delete")}
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="text-white/45 hover:text-cream">
        {t("cancel")}
      </button>
    </span>
  ) : (
    <button type="button" onClick={() => setConfirming(true)} className="text-white/45 hover:text-red-300" aria-label={t("delete")}>
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

function ShortlistForm({ existing, onClose, onSaved }: { existing?: Shortlist; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations("employerShortlists");
  const [name, setName] = useState(existing?.name || "");
  const [description, setDescription] = useState(existing?.description || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) return setError(t("errorNeedName"));
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(existing ? `/api/employer/shortlists/${existing.id}` : "/api/employer/shortlists", {
        method: existing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error || t("errorCouldNotSave"));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errorGeneric"));
      setSaving(false);
    }
  }

  return (
    <Modal title={existing ? t("editShortlist") : t("newShortlist")} onClose={onClose}>
      <div className="space-y-4">
        <Field label={t("fieldName")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("placeholderName")} autoFocus />
        </Field>
        <Field label={t("fieldDescription")} hint={t("optional")}>
          <Area rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("placeholderDescription")} />
        </Field>
        {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
        <div className="flex justify-end">
          <Btn onClick={submit} loading={saving}>
            {existing ? t("saveChanges") : t("createShortlist")}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}

// ── Shortlist detail drawer ─────────────────────────────────────────────────
function ShortlistDrawer({ shortlist, onClose, onChanged }: { shortlist: Shortlist; onClose: () => void; onChanged: () => void }) {
  const t = useTranslations("employerShortlists");
  const [members, setMembers] = useState<Applicant[]>([]);
  const [offerFor, setOfferFor] = useState<Applicant | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/employer/shortlists/${shortlist.id}/members`, { cache: "no-store" });
      const d = (await res.json().catch(() => ({}))) as { members?: Applicant[] };
      setMembers(d.members || []);
    } finally {
      setLoading(false);
    }
  }, [shortlist.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(applicantId: number) {
    setMembers((prev) => prev.filter((m) => m.id !== applicantId));
    await fetch(`/api/employer/shortlists/${shortlist.id}/members`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicantId }),
    });
    onChanged();
  }

  return (
    <Drawer title={shortlist.name} onClose={onClose}>
      <div className="space-y-4">
        {shortlist.description && <p className="text-sm text-white/60">{shortlist.description}</p>}
        <Btn variant="ghost" onClick={() => setAdding(true)}>
          <UserPlus className="h-4 w-4" /> {t("addCandidate")}
        </Btn>

        {loading ? (
          <p className="text-sm text-white/50">{t("loading")}</p>
        ) : members.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border-gold p-4 text-sm text-white/50">
            {t("noMembersYet")}
          </p>
        ) : (
          <ul className="space-y-2">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 rounded-xl border border-border-gold bg-white/[0.03] p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-cream">{m.name}</span>
                    <ScoreChip score={m.matchScore} />
                  </div>
                  <div className="truncate text-xs text-white/45">
                    {m.email}
                    {m.jobTitle ? ` · ${m.jobTitle}` : ""}
                  </div>
                </div>
                <Badge tone={STATUS_TONE[m.status]}>{t(`applicantStatus.${m.status}`)}</Badge>
                <Link href={`/employer/messages?applicantId=${m.id}`} className="text-white/45 hover:text-cream" aria-label={t("message")} title={t("message")}>
                  <MessageSquare className="h-4 w-4" />
                </Link>
                <button type="button" onClick={() => setOfferFor(m)} className="text-white/45 hover:text-violet" aria-label={t("sendOffer")} title={t("sendOffer")}>
                  <FileSignature className="h-4 w-4" />
                </button>
                <a href={`mailto:${m.email}`} className="text-white/45 hover:text-cream" aria-label={t("email")} title={t("email")}>
                  <Mail className="h-4 w-4" />
                </a>
                <button type="button" onClick={() => remove(m.id)} className="text-white/45 hover:text-red-300" aria-label={t("remove")}>
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {adding && (
        <AddCandidates
          shortlistId={shortlist.id}
          existingIds={members.map((m) => m.id)}
          onClose={() => setAdding(false)}
          onAdded={async () => {
            await load();
            onChanged();
          }}
        />
      )}
      {offerFor && (
        <SendDocumentModal
          applicantId={offerFor.id}
          candidateName={offerFor.name}
          candidateEmail={offerFor.email}
          defaultPosition={offerFor.jobTitle}
          onClose={() => setOfferFor(null)}
        />
      )}
    </Drawer>
  );
}

function AddCandidates({
  shortlistId,
  existingIds,
  onClose,
  onAdded,
}: {
  shortlistId: number;
  existingIds: number[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const t = useTranslations("employerShortlists");
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [added, setAdded] = useState<Set<number>>(new Set(existingIds));

  useEffect(() => {
    fetch("/api/employer/candidates?sort=best", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { applicants?: Applicant[] }) => setApplicants(d.applicants || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function add(applicantId: number) {
    setBusyId(applicantId);
    const res = await fetch(`/api/employer/shortlists/${shortlistId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicantId }),
    });
    if (res.ok) {
      setAdded((prev) => new Set(prev).add(applicantId));
      onAdded();
    }
    setBusyId(null);
  }

  const filtered = applicants.filter((a) => !search.trim() || `${a.name} ${a.email}`.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <Modal title={t("addCandidates")} onClose={onClose} wide>
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchCandidatesPlaceholder")}
            className="w-full rounded-lg border border-border-gold bg-white/5 py-2 pl-9 pr-3 text-sm text-cream placeholder:text-white/35 outline-none focus:border-violet focus:ring-1 focus:ring-violet"
          />
        </div>
        {loading ? (
          <p className="text-sm text-white/50">{t("loadingCandidates")}</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-white/45">{t("noCandidatesFound")}</p>
        ) : (
          <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
            {filtered.map((a) => {
              const inList = added.has(a.id);
              return (
                <li key={a.id} className="flex items-center gap-3 rounded-lg border border-border-gold bg-white/[0.03] p-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-cream">{a.name}</span>
                      <ScoreChip score={a.matchScore} />
                    </div>
                    <div className="truncate text-xs text-white/45">
                      {a.email}
                      {a.jobTitle ? ` · ${a.jobTitle}` : ""}
                    </div>
                  </div>
                  <Btn
                    variant={inList ? "ghost" : "primary"}
                    onClick={() => add(a.id)}
                    loading={busyId === a.id}
                    disabled={inList}
                    className="shrink-0 px-3 py-1.5 text-xs"
                  >
                    {inList ? t("added") : t("add")}
                  </Btn>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex justify-end border-t border-border-gold pt-3">
          <Btn variant="ghost" onClick={onClose}>
            {t("done")}
          </Btn>
        </div>
      </div>
    </Modal>
  );
}
