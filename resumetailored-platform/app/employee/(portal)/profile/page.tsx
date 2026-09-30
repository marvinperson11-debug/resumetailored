import { getLocale, getTranslations } from "next-intl/server";
import { employeeContext } from "@/lib/employee-auth";
import { getEmployerProfile } from "@/lib/employer-store";
import { ManageAccountButton } from "./profile-client";
import { MyCertifications } from "./certs-client";
import { MySkills } from "./skills-client";
import { fullDate } from "../../components/format";

export const dynamic = "force-dynamic";

/**
 * Employee-portal Profile. A read-only summary of the employee's own record
 * (from their `employees` row) plus a button into Clerk's account panel for
 * photo/name changes. Lives under the (portal) route group so it renders the
 * employee shell + sidebar (never the candidate one). The layout already gates
 * access, so ctx is present; the null-guard is only for type-narrowing.
 */
export default async function EmployeeProfilePage() {
  const ctx = await employeeContext();
  if (!ctx) return null;

  const t = await getTranslations("employeeProfile");
  const locale = await getLocale();
  const profile = await getEmployerProfile(ctx.employerId);
  const company = profile?.companyName || ctx.access.employerName || t("companyFallback");
  const e = ctx.employee;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-medium text-cream">{t("title")}</h1>
        <p className="mt-1 text-sm text-white/60">{t("subtitle", { company })}</p>
      </div>

      <div className="rounded-2xl border border-border-gold bg-white/[0.03] p-6">
        <dl className="divide-y divide-border-gold/60">
          <Row label={t("name")} value={e.name || "—"} />
          <Row label={t("email")} value={e.email || "—"} />
          <Row label={t("role")} value={e.role || "—"} />
          <Row label={t("startDate")} value={e.startDate ? fullDate(e.startDate, locale) : "—"} />
          <Row label={t("status")} value={t(`statuses.${e.status}`)} />
        </dl>
        <p className="mt-4 text-xs text-white/40">
          {t("managedNote")}
        </p>
      </div>

      <MyCertifications />

      <MySkills />

      <div className="rounded-2xl border border-border-gold bg-white/[0.03] p-6">
        <h2 className="mb-1 text-sm font-semibold text-cream">{t("account")}</h2>
        <p className="mb-4 text-xs text-white/50">{t("accountHint")}</p>
        <ManageAccountButton />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="text-sm text-white/45">{label}</dt>
      <dd className="text-right text-sm text-cream">{value}</dd>
    </div>
  );
}
