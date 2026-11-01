"use client";

import { useEffect, useState, useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ShieldCheck, AlertTriangle, ExternalLink } from "lucide-react";
import { BGC_PACKAGES, priceForPackage, fairChanceWarning, type BgcPackageId } from "@/lib/bgc-packages";
import { formatDate } from "@/lib/format";
import { Modal, Btn, Field, Picker, Badge, Panel, employerCheckoutHref } from "../components/ui";

interface BgcOrder {
  id: string;
  package: BgcPackageId;
  status: string;
  result: string | null;
  priceCents: number;
  passThroughFeeCents: number;
  fairChanceWarning: boolean;
  orderedAt: string;
}

interface AdverseActionState {
  stage: "none" | "pre_adverse_sent" | "waiting" | "adverse_notice_sent" | "canceled";
  waitUntil: string | null;
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** The background-check button + order modal + timeline for one candidate
 *  (Portal+). Ordering and every adverse-action step are confirmed inline
 *  before dispatch, same pattern as the SMS compose box. */
export function BackgroundCheckPanel({ applicantId, candidateStateCode, onClose }: { applicantId: number; candidateStateCode?: string; onClose: () => void }) {
  const t = useTranslations("employerBgc");
  const locale = useLocale();
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<BgcOrder[]>([]);
  const [adverseByOrder, setAdverseByOrder] = useState<Record<string, AdverseActionState>>({});
  const [ordering, setOrdering] = useState(false);
  const [packageId, setPackageId] = useState<BgcPackageId>("basic");
  const [stateCode, setStateCode] = useState(candidateStateCode || "");
  const [confirmOrder, setConfirmOrder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planRequired, setPlanRequired] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/employer/background-checks?applicantId=${applicantId}`, { cache: "no-store" });
      if (res.status === 402) {
        setPlanRequired(true);
        return;
      }
      const d = (await res.json().catch(() => ({}))) as { orders?: BgcOrder[] };
      const list = d.orders || [];
      setOrders(list);
      const details = await Promise.all(list.map((o) => fetch(`/api/employer/background-checks/${o.id}`).then((r) => r.json()).catch(() => ({}))));
      const next: Record<string, AdverseActionState> = {};
      details.forEach((detail: { adverseAction?: AdverseActionState }, i) => {
        if (detail.adverseAction) next[list[i].id] = detail.adverseAction;
      });
      setAdverseByOrder(next);
    } finally {
      setLoading(false);
    }
  }, [applicantId]);

  useEffect(() => {
    load();
  }, [load]);

  const pkg = BGC_PACKAGES[packageId];
  const pricing = priceForPackage(pkg);
  const warn = fairChanceWarning(stateCode);

  async function placeOrder() {
    setOrdering(true);
    setError(null);
    try {
      const res = await fetch("/api/employer/background-checks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicantId, packageId, candidateStateCode: stateCode || undefined, confirm: true }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !d.ok) throw new Error(d.error || t("errorOrderFailed"));
      setConfirmOrder(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errorOrderFailed"));
    } finally {
      setOrdering(false);
    }
  }

  async function adverseAction(orderId: string, action: "start_pre_adverse" | "send_adverse_notice") {
    setError(null);
    try {
      const res = await fetch(`/api/employer/background-checks/${orderId}/adverse-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, confirm: true }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !d.ok) throw new Error(d.error === "still_waiting" ? t("errorStillWaiting") : t("errorGeneric"));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errorGeneric"));
    }
  }

  if (planRequired) {
    return (
      <Modal title={t("title")} onClose={onClose}>
        <div className="space-y-3 text-sm text-white/70">
          <p>{t("planRequired")}</p>
          <Btn onClick={() => { window.location.href = employerCheckoutHref("portal"); }}>{t("upgrade")}</Btn>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={t("title")} onClose={onClose} wide>
      <div className="space-y-4">
        {loading ? (
          <p className="text-sm text-white/50">{t("loading")}</p>
        ) : (
          orders.map((o) => {
            const adverse = adverseByOrder[o.id];
            const canSendNotice = adverse?.stage === "waiting" && adverse.waitUntil && new Date(adverse.waitUntil).getTime() <= Date.now();
            return (
              <Panel key={o.id} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-cream">
                    <ShieldCheck className="h-4 w-4 text-teal" /> {BGC_PACKAGES[o.package].label}
                  </div>
                  <Badge tone={o.status === "completed" ? (o.result === "clear" ? "teal" : "gold") : o.status === "suspended" || o.status === "disputed" ? "red" : "sky"}>
                    {t(`orderStatus.${o.status}`)}
                  </Badge>
                </div>
                <div className="text-xs text-white/60">{money(o.priceCents)} {o.passThroughFeeCents > 0 && t("plusPassThrough", { fee: money(o.passThroughFeeCents) })}</div>
                {o.result && <div className="text-xs text-white/70">{t("resultLabel")}: {t(`resultValue.${o.result}`)}</div>}
                {o.status === "completed" && (
                  <a href={`https://dashboard.checkr.com/reports`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-violet hover:underline">
                    {t("viewFullReport")} <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {o.fairChanceWarning && (
                  <div className="flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {t("fairChanceWarning")}
                  </div>
                )}
                {(o.status === "completed" || o.status === "report_pending") && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-border-gold pt-2">
                    {(!adverse || adverse.stage === "none") && (
                      <Btn variant="ghost" onClick={() => adverseAction(o.id, "start_pre_adverse")}>
                        {t("startPreAdverse")}
                      </Btn>
                    )}
                    {adverse?.stage === "waiting" && (
                      <Btn variant="ghost" disabled={!canSendNotice} onClick={() => adverseAction(o.id, "send_adverse_notice")}>
                        {canSendNotice ? t("sendAdverseNotice") : t("waitingUntil", { date: adverse.waitUntil ? formatDate(adverse.waitUntil, locale) : "" })}
                      </Btn>
                    )}
                    {adverse?.stage === "adverse_notice_sent" && <Badge tone="neutral">{t("adverseNoticeSent")}</Badge>}
                  </div>
                )}
              </Panel>
            );
          })
        )}

        <div className="space-y-3 border-t border-border-gold pt-4">
          <h3 className="text-sm font-semibold text-cream">{t("orderNew")}</h3>
          <Field label={t("package")}>
            <Picker value={packageId} onChange={(e) => { setPackageId(e.target.value as BgcPackageId); setConfirmOrder(false); }}>
              {Object.values(BGC_PACKAGES).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Picker>
          </Field>
          <Field label={t("candidateState")} hint={t("candidateStateHint")}>
            <input
              value={stateCode}
              onChange={(e) => { setStateCode(e.target.value.toUpperCase().slice(0, 2)); setConfirmOrder(false); }}
              placeholder="CA"
              className="w-24 rounded-lg border border-border-gold bg-white/5 px-3 py-2 text-sm uppercase text-cream outline-none focus:border-violet focus:ring-1 focus:ring-violet"
            />
          </Field>

          <div className="rounded-lg border border-border-gold bg-white/[0.03] p-3 text-xs text-white/70">
            <p>{pkg.description}</p>
            <p className="mt-1 font-semibold text-cream">{t("priceLine", { price: money(pricing.priceCents) })}</p>
            {pricing.passThroughFeeCents > 0 && <p>{t("passThroughLine", { fee: money(pricing.passThroughFeeCents) })}</p>}
            <p className="mt-1">{t("candidateContactedNotice")}</p>
          </div>
          {warn && (
            <div className="flex items-start gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {t("fairChanceWarning")}
            </div>
          )}

          {error && <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}

          {!confirmOrder ? (
            <Btn onClick={() => setConfirmOrder(true)}>{t("runCheck")}</Btn>
          ) : (
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setConfirmOrder(false)} className="rounded-lg border border-border-gold px-3 py-2 text-sm text-muted-cream hover:bg-white/5">
                {t("cancel")}
              </button>
              <Btn onClick={placeOrder} loading={ordering}>
                {t("confirmOrder")}
              </Btn>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
