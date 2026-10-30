"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { UserSearch, Loader2, Lock } from "lucide-react";
import type { TalentPoolProfileData } from "@/lib/talent-pool-core";
import { Panel, PageHeader, Btn, Field, Input, Area, Badge, EmptyState, Drawer, Modal, LockedModuleBanner, employerCheckoutHref } from "../components/ui";

interface SearchResult {
  id: string;
  profile: Partial<TalentPoolProfileData>;
}

interface SentRequest {
  id: string;
  candidateName: string;
  status: "pending" | "accepted" | "declined" | "withdrawn";
  createdAt: string;
  contact?: { email: string | null; phone: string | null };
}

export function TalentPoolClient({ locked, canContact }: { locked: boolean; canContact: boolean }) {
  const t = useTranslations("employerTalentPool");

  const [skills, setSkills] = useState("");
  const [location, setLocation] = useState("");
  const [desiredRole, setDesiredRole] = useState("");
  const [minYears, setMinYears] = useState("");
  const [q, setQ] = useState("");

  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [contactOpen, setContactOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendOk, setSendOk] = useState(false);

  const [sent, setSent] = useState<SentRequest[] | null>(null);

  const search = useCallback(async () => {
    if (locked) return;
    setSearching(true);
    try {
      const params = new URLSearchParams();
      if (skills.trim()) params.set("skills", skills.trim());
      if (location.trim()) params.set("location", location.trim());
      if (desiredRole.trim()) params.set("desiredRole", desiredRole.trim());
      if (minYears.trim()) params.set("minYearsExperience", minYears.trim());
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/employer/talent-pool/search?${params.toString()}`, { cache: "no-store" });
      const d = (await res.json().catch(() => ({}))) as { results?: SearchResult[] };
      setResults(res.ok ? d.results || [] : []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [locked, skills, location, desiredRole, minYears, q]);

  const loadSent = useCallback(() => {
    if (!canContact) return;
    fetch("/api/employer/talent-pool/contact", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { requests: [] }))
      .then((d: { requests?: SentRequest[] }) => setSent(d.requests || []))
      .catch(() => setSent([]));
  }, [canContact]);

  useEffect(() => {
    search();
    loadSent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openContact() {
    setMessage("");
    setSendError(null);
    setSendOk(false);
    setContactOpen(true);
  }

  async function sendContact() {
    if (!selected) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch("/api/employer/talent-pool/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: selected.id, message }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error || t("errors.generic"));
      setSendOk(true);
      loadSent();
    } catch (e) {
      setSendError(e instanceof Error ? e.message : t("errors.generic"));
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {locked && <LockedModuleBanner featureKey="talentPool" tier="Portal" />}

      <Panel className="mb-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t("filters.skills")}>
            <Input value={skills} onChange={(e) => setSkills(e.target.value)} placeholder={t("filters.skillsPh")} disabled={locked} />
          </Field>
          <Field label={t("filters.location")}>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder={t("filters.locationPh")} disabled={locked} />
          </Field>
          <Field label={t("filters.desiredRole")}>
            <Input value={desiredRole} onChange={(e) => setDesiredRole(e.target.value)} placeholder={t("filters.desiredRolePh")} disabled={locked} />
          </Field>
          <Field label={t("filters.minYears")}>
            <Input type="number" min={0} value={minYears} onChange={(e) => setMinYears(e.target.value)} placeholder="0" disabled={locked} />
          </Field>
          <Field label={t("filters.q")}>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("filters.qPh")} disabled={locked} />
          </Field>
          <div className="flex items-end">
            <Btn onClick={search} loading={searching} disabled={locked} className="w-full">
              {t("filters.search")}
            </Btn>
          </div>
        </div>
      </Panel>

      {results === null || searching ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-white/50" />
        </div>
      ) : results.length === 0 ? (
        <EmptyState icon={UserSearch} title={t("empty.title")} body={t("empty.body")} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((r) => (
            <button key={r.id} type="button" onClick={() => setSelected(r)} className="text-left">
              <Panel className="h-full transition-colors hover:border-violet/60">
                <div className="flex items-center gap-3">
                  {r.profile.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.profile.photoUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
                  ) : (
                    <div className="h-10 w-10 rounded-full bg-white/10" />
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-cream">{r.profile.name ?? t("card.hiddenName")}</div>
                    <div className="truncate text-xs text-white/55">{r.profile.headline ?? ""}</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(r.profile.skills || []).slice(0, 4).map((s) => (
                    <Badge key={s} tone="violet">
                      {s}
                    </Badge>
                  ))}
                </div>
                {r.profile.location && <p className="mt-2 text-xs text-white/50">{r.profile.location}</p>}
              </Panel>
            </button>
          ))}
        </div>
      )}

      {canContact && sent !== null && sent.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 font-serif text-lg font-medium text-cream">{t("sentTitle")}</h2>
          <div className="space-y-2">
            {sent.map((r) => (
              <Panel key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-cream">{r.candidateName}</span>
                <div className="flex items-center gap-3">
                  <Badge tone={r.status === "accepted" ? "teal" : r.status === "declined" ? "red" : r.status === "withdrawn" ? "neutral" : "gold"}>
                    {t(`status.${r.status}`)}
                  </Badge>
                  {r.status === "accepted" && r.contact && (
                    <span className="text-xs text-white/60">{r.contact.email}{r.contact.phone ? ` · ${r.contact.phone}` : ""}</span>
                  )}
                </div>
              </Panel>
            ))}
          </div>
        </div>
      )}

      {selected && (
        <Drawer title={selected.profile.name ?? t("card.hiddenName")} onClose={() => setSelected(null)}>
          <div className="space-y-4">
            <div>
              <p className="text-sm text-white/70">{selected.profile.headline ?? ""}</p>
              {selected.profile.location && <p className="mt-1 text-xs text-white/50">{selected.profile.location}</p>}
            </div>
            {selected.profile.bio && <p className="text-sm text-white/70">{selected.profile.bio}</p>}
            {selected.profile.skills && selected.profile.skills.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-cream">{t("filters.skills")}</h3>
                <div className="flex flex-wrap gap-1.5">
                  {selected.profile.skills.map((s) => (
                    <Badge key={s} tone="violet">
                      {s}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {selected.profile.desiredRoles && selected.profile.desiredRoles.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-cream">{t("filters.desiredRole")}</h3>
                <div className="flex flex-wrap gap-1.5">
                  {selected.profile.desiredRoles.map((s) => (
                    <Badge key={s} tone="gold">
                      {s}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {typeof selected.profile.yearsExperience === "number" && (
              <p className="text-sm text-white/70">{t("detail.years", { years: selected.profile.yearsExperience })}</p>
            )}
            {selected.profile.workAuthorization && <p className="text-sm text-white/70">{selected.profile.workAuthorization}</p>}

            <p className="text-xs text-white/40">{t("detail.noContactNote")}</p>

            {canContact ? (
              <Btn onClick={openContact} className="w-full">
                {t("contactButton")}
              </Btn>
            ) : (
              <a
                href={employerCheckoutHref("scale")}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gold px-4 py-2.5 text-sm font-bold text-navy transition-colors hover:bg-gold/90"
              >
                <Lock className="h-4 w-4" /> {t("upgradeToContact")}
              </a>
            )}
          </div>
        </Drawer>
      )}

      {contactOpen && selected && (
        <Modal title={t("contactModal.title")} onClose={() => setContactOpen(false)}>
          {sendOk ? (
            <p className="text-sm text-teal">{t("contactModal.sent")}</p>
          ) : (
            <div className="space-y-4">
              <Field label={t("contactModal.message")}>
                <Area rows={5} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t("contactModal.messagePh")} />
              </Field>
              {sendError && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{sendError}</p>}
              <Btn onClick={sendContact} loading={sending} disabled={!message.trim()} className="w-full">
                {t("contactModal.send")}
              </Btn>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
