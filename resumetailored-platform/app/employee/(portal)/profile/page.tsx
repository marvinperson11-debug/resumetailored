import { employeeContext } from "@/lib/employee-auth";
import { getEmployerProfile } from "@/lib/employer-store";
import { EMPLOYEE_STATUS_LABELS } from "@/lib/employee-hub";
import { ManageAccountButton } from "./profile-client";

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

  const profile = await getEmployerProfile(ctx.employerId);
  const company = profile?.companyName || ctx.access.employerName || "your workplace";
  const e = ctx.employee;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-medium text-cream">Profile</h1>
        <p className="mt-1 text-sm text-white/60">Your details at {company}.</p>
      </div>

      <div className="rounded-2xl border border-border-gold bg-white/[0.03] p-6">
        <dl className="divide-y divide-border-gold/60">
          <Row label="Name" value={e.name || "—"} />
          <Row label="Email" value={e.email || "—"} />
          <Row label="Role" value={e.role || "—"} />
          <Row label="Start date" value={e.startDate || "—"} />
          <Row label="Status" value={EMPLOYEE_STATUS_LABELS[e.status]} />
        </dl>
        <p className="mt-4 text-xs text-white/40">
          Your role and start date are managed by your employer. To correct them, message your employer from the Messages tab.
        </p>
      </div>

      <div className="rounded-2xl border border-border-gold bg-white/[0.03] p-6">
        <h2 className="mb-1 text-sm font-semibold text-cream">Account</h2>
        <p className="mb-4 text-xs text-white/50">Update your photo, name, or email in your account panel.</p>
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
