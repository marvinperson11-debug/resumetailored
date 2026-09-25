import { listCertsForReminderScan, markCertReminded, type CertWithEmployee } from "./cert-store";
import { reminderWindowsDue } from "./cert-hub";
import { sendEmail, emailShell, escapeHtml, resolveUserEmail } from "./email";
import { getEmployerProfile } from "./employer-store";

/**
 * Daily scan: emails BOTH the employee and the employer 30 and 7 days before
 * a certification expires (Phase 3, item 9). Best-effort throughout — a
 * failed send never throws and the marker is still stamped so a broken email
 * address can't cause the same cert to retry forever.
 */
export async function runCertReminderScan(now: number = Date.now()): Promise<{ scanned: number; reminded: number }> {
  const certs = await listCertsForReminderScan();
  let reminded = 0;
  for (const cert of certs) {
    const windows = reminderWindowsDue(cert, now);
    for (const which of windows) {
      await sendCertReminder(cert, which);
      await markCertReminded(cert.id, which);
      reminded++;
    }
  }
  return { scanned: certs.length, reminded };
}

async function sendCertReminder(cert: CertWithEmployee, which: "30" | "7"): Promise<void> {
  const daysLabel = which === "30" ? "30 days" : "7 days";
  const expiry = cert.expiryDate || "";
  const profile = await getEmployerProfile(cert.employerId).catch(() => null);
  const companyName = profile?.companyName || "your employer";

  if (cert.employeeEmail) {
    await sendEmail({
      to: cert.employeeEmail,
      subject: `Your "${cert.name}" certification expires in ${daysLabel}`,
      html: emailShell(
        `<p>Hi ${escapeHtml(cert.employeeName || "there")},</p>
<p>Your certification <strong>${escapeHtml(cert.name)}</strong> expires on <strong>${escapeHtml(expiry)}</strong> — that's ${daysLabel} away.</p>
<p>Renew it and add the new expiry date from your employee portal, or send it to ${escapeHtml(companyName)}.</p>`
      ),
    }).catch(() => false);
  }

  const employerEmail = await resolveUserEmail(cert.employerId).catch(() => null);
  if (employerEmail) {
    await sendEmail({
      to: employerEmail,
      subject: `${cert.employeeName || "An employee"}'s "${cert.name}" certification expires in ${daysLabel}`,
      html: emailShell(
        `<p><strong>${escapeHtml(cert.employeeName || "An employee")}</strong>'s certification <strong>${escapeHtml(cert.name)}</strong> expires on <strong>${escapeHtml(expiry)}</strong> — that's ${daysLabel} away.</p>
<p>Check the Employees tab to follow up.</p>`
      ),
    }).catch(() => false);
  }
}
