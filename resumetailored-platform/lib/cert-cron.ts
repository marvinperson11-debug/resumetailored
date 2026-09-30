import { listCertsForReminderScan, markCertReminded, type CertWithEmployee } from "./cert-store";
import { reminderWindowsDue } from "./cert-hub";
import { sendEmail, emailShell, escapeHtml, resolveUserEmail } from "./email";
import { getEmployerProfile } from "./employer-store";
import { logActivityForEmployer, logActivityForEmployee } from "./notifications-store";
import { getRecipientLocale } from "./locale-pref";
import { certReminderEmployeeCopy, certReminderEmployerCopy, certDaysLabel } from "./email-i18n";

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
  const daysLabelEn = which === "30" ? "30 days" : "7 days";
  const expiry = cert.expiryDate || "";
  const profile = await getEmployerProfile(cert.employerId).catch(() => null);
  const companyName = profile?.companyName || "your employer";

  logActivityForEmployee(cert.employerId, cert.employeeId, {
    eventType: "cert_expiring",
    title: `Your "${cert.name}" certification expires in ${daysLabelEn}`,
    msg: { key: "certExpiringSelf", params: { cert: cert.name, days: Number(which) } },
    link: "/employee/profile",
  }).catch(() => {});
  logActivityForEmployer(cert.employerId, {
    eventType: "cert_expiring",
    title: `${cert.employeeName || "An employee"}'s "${cert.name}" certification expires in ${daysLabelEn}`,
    msg: { key: "certExpiringEmployer", params: { employee: cert.employeeName || "", cert: cert.name, days: Number(which) } },
    link: "/employer/employees",
  }).catch(() => {});

  if (cert.employeeEmail) {
    const locale = await getRecipientLocale(cert.employeeClerkUserId || null);
    const copy = certReminderEmployeeCopy(locale);
    const daysLabel = certDaysLabel(locale, which);
    const firstName = escapeHtml((cert.employeeName || "there").split(" ")[0] || cert.employeeName || "there");
    await sendEmail({
      to: cert.employeeEmail,
      subject: copy.subject(cert.name, daysLabel),
      html: emailShell(
        `<p>${escapeHtml(copy.greeting(firstName))}</p>
<p>${copy.body(escapeHtml(cert.name), escapeHtml(expiry), daysLabel)}</p>
<p>${escapeHtml(copy.renewNote(companyName))}</p>`
      ),
    }).catch(() => false);
  }

  const employerEmail = await resolveUserEmail(cert.employerId).catch(() => null);
  if (employerEmail) {
    const locale = await getRecipientLocale(cert.employerId);
    const copy = certReminderEmployerCopy(locale);
    const daysLabel = certDaysLabel(locale, which);
    const employeeName = cert.employeeName || "An employee";
    await sendEmail({
      to: employerEmail,
      subject: copy.subject(employeeName, cert.name, daysLabel),
      html: emailShell(
        `<p>${copy.body(escapeHtml(employeeName), escapeHtml(cert.name), escapeHtml(expiry), daysLabel)}</p>
<p>${escapeHtml(copy.checkNote)}</p>`
      ),
    }).catch(() => false);
  }
}
