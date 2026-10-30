import type { Locale } from "@/i18n/locales";
import type { DocKind } from "./employee-hub";

/**
 * Localized copy for server-sent emails. Server-side sends have no request
 * (no cookie, no Accept-Language) — the recipient's language comes from
 * `getRecipientLocale()` (lib/locale-pref.ts), which reads their saved
 * Settings preference off Clerk `publicMetadata.locale`.
 *
 * Coverage: every email here goes to a recipient who can plausibly already
 * have a Clerk account (and therefore a saved locale preference) at send
 * time — an employer, an employee who has accepted their portal invite, or
 * an interviewer/host on the employer's own team. Emails to a recipient who
 * cannot have an account yet at send time (a pre-signup team/employee invite,
 * a public job applicant with no portal, an arbitrary "send a copy"
 * recipient the employer typed in) are left English-only: there is no
 * locale to read for them, and defaulting them to the *employer's* locale
 * would guess at a stranger's language rather than honor a saved
 * preference. The pattern (one small copy object per email, keyed by
 * Locale, with the same shape and a `parity` test target) is meant to be
 * repeated for any future recipient-has-an-account email, not reinvented
 * per email.
 */

export interface TrainingReminderCopy {
  subject: (overdue: boolean, title: string) => string;
  greeting: (firstName: string) => string;
  needsToComplete: (company: string, kind: string) => string;
  due: (overdue: boolean, date: string) => string;
  signatureRequiredNote: string;
  replyNote: string;
}

const TRAINING_REMINDER: Record<Locale, TrainingReminderCopy> = {
  en: {
    subject: (overdue, title) => `${overdue ? "Overdue: " : "Reminder: "}${title}`,
    greeting: (firstName) => `Hi ${firstName},`,
    needsToComplete: (company, kind) => `${company} needs you to complete the following ${kind.toLowerCase()} item:`,
    due: (overdue, date) => (overdue ? `This was due ${date}.` : `Due ${date}.`),
    signatureRequiredNote: "Check your inbox for the signing request and complete it to acknowledge.",
    replyNote: "Reply to this email once you've reviewed it, or ask your manager if you have questions.",
  },
  zh: {
    subject: (overdue, title) => `${overdue ? "逾期：" : "提醒："}${title}`,
    greeting: (firstName) => `您好 ${firstName}，`,
    needsToComplete: (company, kind) => `${company}需要您完成以下${kind}项目：`,
    due: (overdue, date) => (overdue ? `此项已于 ${date} 到期。` : `截止日期为 ${date}。`),
    signatureRequiredNote: "请查看您的收件箱中的签署请求，完成签署以确认。",
    replyNote: "查看后请回复此邮件，如有疑问请联系您的经理。",
  },
  es: {
    subject: (overdue, title) => `${overdue ? "Vencido: " : "Recordatorio: "}${title}`,
    greeting: (firstName) => `Hola ${firstName},`,
    needsToComplete: (company, kind) => `${company} necesita que completes el siguiente elemento de ${kind.toLowerCase()}:`,
    due: (overdue, date) => (overdue ? `Esto vencía el ${date}.` : `Vence el ${date}.`),
    signatureRequiredNote: "Revisa tu bandeja de entrada para la solicitud de firma y complétala para confirmar.",
    replyNote: "Responde a este correo una vez que lo hayas revisado, o consulta a tu gerente si tienes dudas.",
  },
  hi: {
    subject: (overdue, title) => `${overdue ? "समय-सीमा समाप्त: " : "रिमाइंडर: "}${title}`,
    greeting: (firstName) => `नमस्ते ${firstName},`,
    needsToComplete: (company, kind) => `${company} को आपसे यह ${kind} आइटम पूरा करना है:`,
    due: (overdue, date) => (overdue ? `यह ${date} को देय था।` : `देय तिथि ${date} है।`),
    signatureRequiredNote: "हस्ताक्षर के लिए अपना इनबॉक्स देखें और पुष्टि हेतु उसे पूरा करें।",
    replyNote: "इसे देखने के बाद इस ईमेल का उत्तर दें, या प्रश्न होने पर अपने मैनेजर से पूछें।",
  },
  fr: {
    subject: (overdue, title) => `${overdue ? "En retard : " : "Rappel : "}${title}`,
    greeting: (firstName) => `Bonjour ${firstName},`,
    needsToComplete: (company, kind) => `${company} a besoin que vous complétiez l'élément de ${kind.toLowerCase()} suivant :`,
    due: (overdue, date) => (overdue ? `C'était à faire avant le ${date}.` : `À faire avant le ${date}.`),
    signatureRequiredNote: "Consultez votre boîte de réception pour la demande de signature et complétez-la pour confirmer.",
    replyNote: "Répondez à cet e-mail une fois que vous l'avez consulté, ou demandez à votre responsable si vous avez des questions.",
  },
};

export function trainingReminderCopy(locale: Locale): TrainingReminderCopy {
  return TRAINING_REMINDER[locale] ?? TRAINING_REMINDER.en;
}

export interface CertReminderEmployeeCopy {
  subject: (certName: string, daysLabel: string) => string;
  greeting: (firstName: string) => string;
  body: (certName: string, expiry: string, daysLabel: string) => string;
  renewNote: (company: string) => string;
}

const CERT_REMINDER_EMPLOYEE: Record<Locale, CertReminderEmployeeCopy> = {
  en: {
    subject: (certName, daysLabel) => `Your "${certName}" certification expires in ${daysLabel}`,
    greeting: (firstName) => `Hi ${firstName},`,
    body: (certName, expiry, daysLabel) => `Your certification <strong>${certName}</strong> expires on <strong>${expiry}</strong> — that's ${daysLabel} away.`,
    renewNote: (company) => `Renew it and add the new expiry date from your employee portal, or send it to ${company}.`,
  },
  zh: {
    subject: (certName, daysLabel) => `您的“${certName}”证书将在${daysLabel}后到期`,
    greeting: (firstName) => `您好 ${firstName}，`,
    body: (certName, expiry, daysLabel) => `您的证书<strong>${certName}</strong>将于<strong>${expiry}</strong>到期——还有${daysLabel}。`,
    renewNote: (company) => `请在员工门户续期并添加新的到期日期，或将其发送给${company}。`,
  },
  es: {
    subject: (certName, daysLabel) => `Tu certificación "${certName}" vence en ${daysLabel}`,
    greeting: (firstName) => `Hola ${firstName},`,
    body: (certName, expiry, daysLabel) => `Tu certificación <strong>${certName}</strong> vence el <strong>${expiry}</strong> — eso es en ${daysLabel}.`,
    renewNote: (company) => `Renuévala y añade la nueva fecha de vencimiento desde tu portal de empleado, o envíasela a ${company}.`,
  },
  hi: {
    subject: (certName, daysLabel) => `आपका "${certName}" प्रमाणपत्र ${daysLabel} में समाप्त हो रहा है`,
    greeting: (firstName) => `नमस्ते ${firstName},`,
    body: (certName, expiry, daysLabel) => `आपका प्रमाणपत्र <strong>${certName}</strong> <strong>${expiry}</strong> को समाप्त हो रहा है —— यह ${daysLabel} दूर है।`,
    renewNote: (company) => `इसे अपने कर्मचारी पोर्टल से रिन्यू करें और नई समाप्ति तिथि जोड़ें, या इसे ${company} को भेजें।`,
  },
  fr: {
    subject: (certName, daysLabel) => `Votre certification « ${certName} » expire dans ${daysLabel}`,
    greeting: (firstName) => `Bonjour ${firstName},`,
    body: (certName, expiry, daysLabel) => `Votre certification <strong>${certName}</strong> expire le <strong>${expiry}</strong> — soit dans ${daysLabel}.`,
    renewNote: (company) => `Renouvelez-la et ajoutez la nouvelle date d'expiration depuis votre portail employé, ou envoyez-la à ${company}.`,
  },
};

export function certReminderEmployeeCopy(locale: Locale): CertReminderEmployeeCopy {
  return CERT_REMINDER_EMPLOYEE[locale] ?? CERT_REMINDER_EMPLOYEE.en;
}

export interface CertReminderEmployerCopy {
  subject: (employeeName: string, certName: string, daysLabel: string) => string;
  body: (employeeName: string, certName: string, expiry: string, daysLabel: string) => string;
  checkNote: string;
}

const CERT_REMINDER_EMPLOYER: Record<Locale, CertReminderEmployerCopy> = {
  en: {
    subject: (employeeName, certName, daysLabel) => `${employeeName}'s "${certName}" certification expires in ${daysLabel}`,
    body: (employeeName, certName, expiry, daysLabel) => `<strong>${employeeName}</strong>'s certification <strong>${certName}</strong> expires on <strong>${expiry}</strong> — that's ${daysLabel} away.`,
    checkNote: "Check the Employees tab to follow up.",
  },
  zh: {
    subject: (employeeName, certName, daysLabel) => `${employeeName}的“${certName}”证书将在${daysLabel}后到期`,
    body: (employeeName, certName, expiry, daysLabel) => `<strong>${employeeName}</strong>的证书<strong>${certName}</strong>将于<strong>${expiry}</strong>到期——还有${daysLabel}。`,
    checkNote: "请前往“员工”标签页跟进。",
  },
  es: {
    subject: (employeeName, certName, daysLabel) => `La certificación "${certName}" de ${employeeName} vence en ${daysLabel}`,
    body: (employeeName, certName, expiry, daysLabel) => `La certificación <strong>${certName}</strong> de <strong>${employeeName}</strong> vence el <strong>${expiry}</strong> — eso es en ${daysLabel}.`,
    checkNote: "Consulta la pestaña Empleados para dar seguimiento.",
  },
  hi: {
    subject: (employeeName, certName, daysLabel) => `${employeeName} का "${certName}" प्रमाणपत्र ${daysLabel} में समाप्त हो रहा है`,
    body: (employeeName, certName, expiry, daysLabel) => `<strong>${employeeName}</strong> का प्रमाणपत्र <strong>${certName}</strong> <strong>${expiry}</strong> को समाप्त हो रहा है —— यह ${daysLabel} दूर है।`,
    checkNote: "आगे की कार्रवाई के लिए कर्मचारी टैब देखें।",
  },
  fr: {
    subject: (employeeName, certName, daysLabel) => `La certification « ${certName} » de ${employeeName} expire dans ${daysLabel}`,
    body: (employeeName, certName, expiry, daysLabel) => `La certification <strong>${certName}</strong> de <strong>${employeeName}</strong> expire le <strong>${expiry}</strong> — soit dans ${daysLabel}.`,
    checkNote: "Consultez l'onglet Employés pour faire un suivi.",
  },
};

export function certReminderEmployerCopy(locale: Locale): CertReminderEmployerCopy {
  return CERT_REMINDER_EMPLOYER[locale] ?? CERT_REMINDER_EMPLOYER.en;
}

const CERT_DAYS_LABEL: Record<Locale, Record<"30" | "7", string>> = {
  en: { "30": "30 days", "7": "7 days" },
  zh: { "30": "30 天", "7": "7 天" },
  es: { "30": "30 días", "7": "7 días" },
  hi: { "30": "30 दिन", "7": "7 दिन" },
  fr: { "30": "30 jours", "7": "7 jours" },
};

/** The "30 days" / "7 days" phrase used inside the cert-reminder copy above. */
export function certDaysLabel(locale: Locale, which: "30" | "7"): string {
  return CERT_DAYS_LABEL[locale]?.[which] ?? CERT_DAYS_LABEL.en[which];
}

export interface InterviewModeLabels {
  video: string;
  phone: string;
  onsite: string;
}

const INTERVIEW_MODE_LABELS_I18N: Record<Locale, InterviewModeLabels> = {
  en: { video: "Video call", phone: "Phone call", onsite: "On-site" },
  zh: { video: "视频通话", phone: "电话", onsite: "现场" },
  es: { video: "Videollamada", phone: "Llamada telefónica", onsite: "Presencial" },
  hi: { video: "वीडियो कॉल", phone: "फ़ोन कॉल", onsite: "ऑन-साइट" },
  fr: { video: "Appel vidéo", phone: "Appel téléphonique", onsite: "Sur site" },
};

export function interviewModeLabel(locale: Locale, mode: "video" | "phone" | "onsite"): string {
  return INTERVIEW_MODE_LABELS_I18N[locale]?.[mode] ?? INTERVIEW_MODE_LABELS_I18N.en[mode];
}

/** "Interview scheduled — {title} with {candidate}" confirmation sent to the
 *  interviewer/host (an employer-side team member, always a Clerk account). */
export interface InterviewerConfirmationCopy {
  subject: (title: string, candidateName: string) => string;
  intro: string;
  whatLabel: string;
  candidateLabel: string;
  whenLabel: string;
  typeLabel: string;
  openRoomCta: string;
  hostNote: (candidateName: string) => string;
  manageNote: (company: string) => string;
}

const INTERVIEWER_CONFIRMATION: Record<Locale, InterviewerConfirmationCopy> = {
  en: {
    subject: (title, candidateName) => `Interview scheduled — ${title} with ${candidateName}`,
    intro: "Your interview is scheduled:",
    whatLabel: "What",
    candidateLabel: "Candidate",
    whenLabel: "When",
    typeLabel: "Type",
    openRoomCta: "Open interview room (host)",
    hostNote: (candidateName) => `You're the host. The same link was sent to ${candidateName}.`,
    manageNote: (company) => `Manage this interview in ${company}'s Scheduler.`,
  },
  zh: {
    subject: (title, candidateName) => `面试已安排 —— ${title}，与 ${candidateName}`,
    intro: "您的面试已安排：",
    whatLabel: "内容",
    candidateLabel: "候选人",
    whenLabel: "时间",
    typeLabel: "类型",
    openRoomCta: "打开面试房间（主持人）",
    hostNote: (candidateName) => `您是主持人。相同的链接已发送给${candidateName}。`,
    manageNote: (company) => `在${company}的排班工具中管理此次面试。`,
  },
  es: {
    subject: (title, candidateName) => `Entrevista programada — ${title} con ${candidateName}`,
    intro: "Tu entrevista está programada:",
    whatLabel: "Qué",
    candidateLabel: "Candidato",
    whenLabel: "Cuándo",
    typeLabel: "Tipo",
    openRoomCta: "Abrir sala de entrevista (anfitrión)",
    hostNote: (candidateName) => `Eres el anfitrión. Se envió el mismo enlace a ${candidateName}.`,
    manageNote: (company) => `Gestiona esta entrevista en el Programador de ${company}.`,
  },
  hi: {
    subject: (title, candidateName) => `इंटरव्यू शेड्यूल हुआ —— ${title}, ${candidateName} के साथ`,
    intro: "आपका इंटरव्यू शेड्यूल हो गया है:",
    whatLabel: "विषय",
    candidateLabel: "उम्मीदवार",
    whenLabel: "समय",
    typeLabel: "प्रकार",
    openRoomCta: "इंटरव्यू रूम खोलें (होस्ट)",
    hostNote: (candidateName) => `आप होस्ट हैं। यही लिंक ${candidateName} को भी भेजा गया है।`,
    manageNote: (company) => `इस इंटरव्यू को ${company} के शेड्यूलर में प्रबंधित करें।`,
  },
  fr: {
    subject: (title, candidateName) => `Entretien programmé — ${title} avec ${candidateName}`,
    intro: "Votre entretien est programmé :",
    whatLabel: "Quoi",
    candidateLabel: "Candidat",
    whenLabel: "Quand",
    typeLabel: "Type",
    openRoomCta: "Ouvrir la salle d'entretien (hôte)",
    hostNote: (candidateName) => `Vous êtes l'hôte. Le même lien a été envoyé à ${candidateName}.`,
    manageNote: (company) => `Gérez cet entretien dans le planificateur de ${company}.`,
  },
};

export function interviewerConfirmationCopy(locale: Locale): InterviewerConfirmationCopy {
  return INTERVIEWER_CONFIRMATION[locale] ?? INTERVIEWER_CONFIRMATION.en;
}

/** "New document from {signer}: {filename}" sent to the employer when a
 *  DocuSign envelope signer uploads a requested document. */
export interface UploadNotifyEmployerCopy {
  subject: (signerName: string, filename: string) => string;
  uploadedLine: (signer: string, forWhat: string, documentName: string) => string;
  forWhatWithRequest: (requestName: string) => string;
  forWhatDefault: string;
  fileLabel: (filename: string) => string;
  openNote: string;
}

const UPLOAD_NOTIFY_EMPLOYER: Record<Locale, UploadNotifyEmployerCopy> = {
  en: {
    subject: (signerName, filename) => `New document from ${signerName}: ${filename}`,
    uploadedLine: (signer, forWhat, documentName) => `<strong>${signer}</strong> uploaded a document${forWhat} on the envelope <strong>${documentName}</strong>.`,
    forWhatWithRequest: (requestName) => ` (${requestName})`,
    forWhatDefault: "",
    fileLabel: (filename) => `File: <strong>${filename}</strong>`,
    openNote: "Open the E-Signatures page in your ResumeTailored employer dashboard to view and download it.",
  },
  zh: {
    subject: (signerName, filename) => `来自 ${signerName} 的新文档：${filename}`,
    uploadedLine: (signer, forWhat, documentName) => `<strong>${signer}</strong> 在信封<strong>${documentName}</strong>上上传了一份文档${forWhat}。`,
    forWhatWithRequest: (requestName) => `（${requestName}）`,
    forWhatDefault: "",
    fileLabel: (filename) => `文件：<strong>${filename}</strong>`,
    openNote: "打开您 ResumeTailored 雇主仪表盘中的“电子签名”页面以查看和下载。",
  },
  es: {
    subject: (signerName, filename) => `Nuevo documento de ${signerName}: ${filename}`,
    uploadedLine: (signer, forWhat, documentName) => `<strong>${signer}</strong> subió un documento${forWhat} en el sobre <strong>${documentName}</strong>.`,
    forWhatWithRequest: (requestName) => ` (${requestName})`,
    forWhatDefault: "",
    fileLabel: (filename) => `Archivo: <strong>${filename}</strong>`,
    openNote: "Abre la página de Firmas electrónicas en tu panel de empleador de ResumeTailored para verlo y descargarlo.",
  },
  hi: {
    subject: (signerName, filename) => `${signerName} से नया दस्तावेज़: ${filename}`,
    uploadedLine: (signer, forWhat, documentName) => `<strong>${signer}</strong> ने एनवलप <strong>${documentName}</strong> पर एक दस्तावेज़${forWhat} अपलोड किया।`,
    forWhatWithRequest: (requestName) => ` (${requestName})`,
    forWhatDefault: "",
    fileLabel: (filename) => `फ़ाइल: <strong>${filename}</strong>`,
    openNote: "इसे देखने और डाउनलोड करने के लिए अपने ResumeTailored एम्प्लॉयर डैशबोर्ड में E-Signatures पेज खोलें।",
  },
  fr: {
    subject: (signerName, filename) => `Nouveau document de ${signerName} : ${filename}`,
    uploadedLine: (signer, forWhat, documentName) => `<strong>${signer}</strong> a téléchargé un document${forWhat} sur l'enveloppe <strong>${documentName}</strong>.`,
    forWhatWithRequest: (requestName) => ` (${requestName})`,
    forWhatDefault: "",
    fileLabel: (filename) => `Fichier : <strong>${filename}</strong>`,
    openNote: "Ouvrez la page Signatures électroniques de votre tableau de bord employeur ResumeTailored pour le consulter et le télécharger.",
  },
};

export function uploadNotifyEmployerCopy(locale: Locale): UploadNotifyEmployerCopy {
  return UPLOAD_NOTIFY_EMPLOYER[locale] ?? UPLOAD_NOTIFY_EMPLOYER.en;
}

/** "New applicant for {jobTitle}" sent to the employer on a public job-board
 *  application. */
export interface NewApplicantCopy {
  subject: (jobTitle: string) => string;
  body: (applicantName: string, jobTitle: string) => string;
  reviewNote: (link: string) => string;
}

const NEW_APPLICANT: Record<Locale, NewApplicantCopy> = {
  en: {
    subject: (jobTitle) => `New applicant for ${jobTitle}`,
    body: (applicantName, jobTitle) => `<strong>${applicantName}</strong> applied for <strong>${jobTitle}</strong> via your public job board.`,
    reviewNote: (link) => `Review them in your <a href="${link}">Candidates dashboard</a>.`,
  },
  zh: {
    subject: (jobTitle) => `${jobTitle} 收到新申请`,
    body: (applicantName, jobTitle) => `<strong>${applicantName}</strong> 通过您的公开职位板申请了<strong>${jobTitle}</strong>。`,
    reviewNote: (link) => `请在您的<a href="${link}">候选人仪表盘</a>中查看。`,
  },
  es: {
    subject: (jobTitle) => `Nuevo candidato para ${jobTitle}`,
    body: (applicantName, jobTitle) => `<strong>${applicantName}</strong> aplicó para <strong>${jobTitle}</strong> a través de tu portal de empleo público.`,
    reviewNote: (link) => `Revísalo en tu <a href="${link}">panel de candidatos</a>.`,
  },
  hi: {
    subject: (jobTitle) => `${jobTitle} के लिए नया आवेदक`,
    body: (applicantName, jobTitle) => `<strong>${applicantName}</strong> ने आपके पब्लिक जॉब बोर्ड के माध्यम से <strong>${jobTitle}</strong> के लिए आवेदन किया।`,
    reviewNote: (link) => `उन्हें अपने <a href="${link}">कैंडिडेट्स डैशबोर्ड</a> में देखें।`,
  },
  fr: {
    subject: (jobTitle) => `Nouveau candidat pour ${jobTitle}`,
    body: (applicantName, jobTitle) => `<strong>${applicantName}</strong> a postulé pour <strong>${jobTitle}</strong> via votre offre d'emploi publique.`,
    reviewNote: (link) => `Consultez-le dans votre <a href="${link}">tableau de bord des candidats</a>.`,
  },
};

export function newApplicantCopy(locale: Locale): NewApplicantCopy {
  return NEW_APPLICANT[locale] ?? NEW_APPLICANT.en;
}

/** "New training assigned: {title}" sent to each pending assignee. */
export interface NewTrainingAssignedCopy {
  subject: (docTitle: string) => string;
  greeting: (firstName: string) => string;
  assignedLine: (docTitle: string) => string;
  openNoteQuiz: string;
  openNotePlain: string;
}

const NEW_TRAINING_ASSIGNED: Record<Locale, NewTrainingAssignedCopy> = {
  en: {
    subject: (docTitle) => `New training assigned: ${docTitle}`,
    greeting: (firstName) => `Hi ${firstName},`,
    assignedLine: (docTitle) => `You've been assigned a new training item: <strong>${docTitle}</strong>.`,
    openNoteQuiz: "Open your employee portal → My training to review it and take the short quiz.",
    openNotePlain: "Open your employee portal → My training to review it and mark it complete.",
  },
  zh: {
    subject: (docTitle) => `新分配的培训：${docTitle}`,
    greeting: (firstName) => `您好 ${firstName}，`,
    assignedLine: (docTitle) => `您被分配了一个新的培训项目：<strong>${docTitle}</strong>。`,
    openNoteQuiz: "打开您的员工门户 → 我的培训，查看并完成简短测验。",
    openNotePlain: "打开您的员工门户 → 我的培训，查看并标记为完成。",
  },
  es: {
    subject: (docTitle) => `Nueva capacitación asignada: ${docTitle}`,
    greeting: (firstName) => `Hola ${firstName},`,
    assignedLine: (docTitle) => `Se te ha asignado un nuevo elemento de capacitación: <strong>${docTitle}</strong>.`,
    openNoteQuiz: "Abre tu portal de empleado → Mi capacitación para revisarlo y hacer el breve cuestionario.",
    openNotePlain: "Abre tu portal de empleado → Mi capacitación para revisarlo y marcarlo como completado.",
  },
  hi: {
    subject: (docTitle) => `नया प्रशिक्षण असाइन किया गया: ${docTitle}`,
    greeting: (firstName) => `नमस्ते ${firstName},`,
    assignedLine: (docTitle) => `आपको एक नया प्रशिक्षण आइटम असाइन किया गया है: <strong>${docTitle}</strong>।`,
    openNoteQuiz: "इसे देखने और छोटी क्विज़ लेने के लिए अपना कर्मचारी पोर्टल → मेरा प्रशिक्षण खोलें।",
    openNotePlain: "इसे देखने और पूर्ण के रूप में चिह्नित करने के लिए अपना कर्मचारी पोर्टल → मेरा प्रशिक्षण खोलें।",
  },
  fr: {
    subject: (docTitle) => `Nouvelle formation assignée : ${docTitle}`,
    greeting: (firstName) => `Bonjour ${firstName},`,
    assignedLine: (docTitle) => `Un nouvel élément de formation vous a été assigné : <strong>${docTitle}</strong>.`,
    openNoteQuiz: "Ouvrez votre portail employé → Ma formation pour le consulter et passer le petit quiz.",
    openNotePlain: "Ouvrez votre portail employé → Ma formation pour le consulter et le marquer comme terminé.",
  },
};

export function newTrainingAssignedCopy(locale: Locale): NewTrainingAssignedCopy {
  return NEW_TRAINING_ASSIGNED[locale] ?? NEW_TRAINING_ASSIGNED.en;
}

const DOC_KIND_LABELS_I18N: Record<Locale, Record<DocKind, string>> = {
  en: { sop: "SOP", safety: "Safety", policy: "Policy", training: "Training" },
  zh: { sop: "标准操作程序", safety: "安全", policy: "政策", training: "培训" },
  es: { sop: "POE", safety: "Seguridad", policy: "Política", training: "Capacitación" },
  hi: { sop: "SOP", safety: "सुरक्षा", policy: "नीति", training: "प्रशिक्षण" },
  fr: { sop: "PON", safety: "Sécurité", policy: "Politique", training: "Formation" },
};

export function docKindLabel(locale: Locale, kind: DocKind): string {
  return DOC_KIND_LABELS_I18N[locale]?.[kind] ?? DOC_KIND_LABELS_I18N.en[kind];
}

/** "An employer wants to connect" sent to a candidate with a new Talent Pool
 *  contact request. Both parties here are always Clerk accounts (the
 *  candidate opted in; the employer is the one portal role that can see
 *  them), so this — unlike `notifyCandidateOfMessage` in
 *  lib/employer-notify.ts, whose "candidate" may be a plain public
 *  applicant with no account at all — is localized the same way the
 *  interviewer confirmation is. */
export interface TalentPoolNewRequestCopy {
  subject: (company: string) => string;
  greeting: (firstName: string) => string;
  body: (company: string) => string;
  reviewNote: (link: string) => string;
}

const TALENT_POOL_NEW_REQUEST: Record<Locale, TalentPoolNewRequestCopy> = {
  en: {
    subject: (company) => `${company} wants to connect — Talent Pool`,
    greeting: (firstName) => `Hi ${firstName},`,
    body: (company) => `<strong>${company}</strong> found your profile in the Talent Pool and sent you a contact request.`,
    reviewNote: (link) => `Review it and reply in your <a href="${link}">Get Found settings</a>.`,
  },
  zh: {
    subject: (company) => `${company} 想与您联系 —— 人才库`,
    greeting: (firstName) => `您好 ${firstName}，`,
    body: (company) => `<strong>${company}</strong> 在人才库中发现了您的资料，并向您发送了联系请求。`,
    reviewNote: (link) => `请在您的<a href="${link}">“被发现”设置</a>中查看并回复。`,
  },
  es: {
    subject: (company) => `${company} quiere conectar — Bolsa de Talento`,
    greeting: (firstName) => `Hola ${firstName},`,
    body: (company) => `<strong>${company}</strong> encontró tu perfil en la Bolsa de Talento y te envió una solicitud de contacto.`,
    reviewNote: (link) => `Revísala y responde en tu <a href="${link}">configuración de Visibilidad</a>.`,
  },
  hi: {
    subject: (company) => `${company} आपसे जुड़ना चाहता है —— टैलेंट पूल`,
    greeting: (firstName) => `नमस्ते ${firstName},`,
    body: (company) => `<strong>${company}</strong> ने टैलेंट पूल में आपकी प्रोफ़ाइल देखी और आपको एक संपर्क अनुरोध भेजा है।`,
    reviewNote: (link) => `इसे देखें और अपनी <a href="${link}">"खोजे जाएं" सेटिंग्स</a> में जवाब दें।`,
  },
  fr: {
    subject: (company) => `${company} souhaite entrer en contact — Vivier de talents`,
    greeting: (firstName) => `Bonjour ${firstName},`,
    body: (company) => `<strong>${company}</strong> a trouvé votre profil dans le Vivier de talents et vous a envoyé une demande de contact.`,
    reviewNote: (link) => `Consultez-la et répondez dans vos <a href="${link}">paramètres « Être trouvé »</a>.`,
  },
};

export function talentPoolNewRequestCopy(locale: Locale): TalentPoolNewRequestCopy {
  return TALENT_POOL_NEW_REQUEST[locale] ?? TALENT_POOL_NEW_REQUEST.en;
}

/** "{candidate} accepted/declined your request" sent to the employer who
 *  sent a Talent Pool contact request, once the candidate responds. */
export interface TalentPoolResponseCopy {
  subject: (candidateName: string, accepted: boolean) => string;
  acceptedBody: (candidateName: string) => string;
  declinedBody: (candidateName: string) => string;
  acceptedNote: (link: string) => string;
  declinedNote: string;
}

const TALENT_POOL_RESPONSE: Record<Locale, TalentPoolResponseCopy> = {
  en: {
    subject: (candidateName, accepted) => `${candidateName} ${accepted ? "accepted" : "declined"} your Talent Pool request`,
    acceptedBody: (candidateName) => `<strong>${candidateName}</strong> accepted your contact request — their contact details are now available.`,
    declinedBody: (candidateName) => `<strong>${candidateName}</strong> declined your contact request.`,
    acceptedNote: (link) => `View their details in your <a href="${link}">Talent Pool requests</a>.`,
    declinedNote: "You won't be able to send this candidate another request.",
  },
  zh: {
    subject: (candidateName, accepted) => `${candidateName} ${accepted ? "已接受" : "已拒绝"}您的人才库请求`,
    acceptedBody: (candidateName) => `<strong>${candidateName}</strong> 已接受您的联系请求 —— 现在可以查看其联系方式。`,
    declinedBody: (candidateName) => `<strong>${candidateName}</strong> 已拒绝您的联系请求。`,
    acceptedNote: (link) => `请在您的<a href="${link}">人才库请求</a>中查看其详细信息。`,
    declinedNote: "您将无法再向该候选人发送请求。",
  },
  es: {
    subject: (candidateName, accepted) => `${candidateName} ${accepted ? "aceptó" : "rechazó"} tu solicitud de la Bolsa de Talento`,
    acceptedBody: (candidateName) => `<strong>${candidateName}</strong> aceptó tu solicitud de contacto — ya puedes ver sus datos de contacto.`,
    declinedBody: (candidateName) => `<strong>${candidateName}</strong> rechazó tu solicitud de contacto.`,
    acceptedNote: (link) => `Ve sus datos en tus <a href="${link}">solicitudes de la Bolsa de Talento</a>.`,
    declinedNote: "No podrás enviarle otra solicitud a este candidato.",
  },
  hi: {
    subject: (candidateName, accepted) => `${candidateName} ने आपके टैलेंट पूल अनुरोध को ${accepted ? "स्वीकार" : "अस्वीकार"} कर दिया`,
    acceptedBody: (candidateName) => `<strong>${candidateName}</strong> ने आपका संपर्क अनुरोध स्वीकार कर लिया —— अब उनका संपर्क विवरण उपलब्ध है।`,
    declinedBody: (candidateName) => `<strong>${candidateName}</strong> ने आपका संपर्क अनुरोध अस्वीकार कर दिया।`,
    acceptedNote: (link) => `उनका विवरण अपने <a href="${link}">टैलेंट पूल अनुरोध</a> में देखें।`,
    declinedNote: "आप इस उम्मीदवार को दोबारा अनुरोध नहीं भेज सकेंगे।",
  },
  fr: {
    subject: (candidateName, accepted) => `${candidateName} a ${accepted ? "accepté" : "refusé"} votre demande du Vivier de talents`,
    acceptedBody: (candidateName) => `<strong>${candidateName}</strong> a accepté votre demande de contact — ses coordonnées sont maintenant disponibles.`,
    declinedBody: (candidateName) => `<strong>${candidateName}</strong> a refusé votre demande de contact.`,
    acceptedNote: (link) => `Consultez ses coordonnées dans vos <a href="${link}">demandes du Vivier de talents</a>.`,
    declinedNote: "Vous ne pourrez pas envoyer une autre demande à ce candidat.",
  },
};

export function talentPoolResponseCopy(locale: Locale): TalentPoolResponseCopy {
  return TALENT_POOL_RESPONSE[locale] ?? TALENT_POOL_RESPONSE.en;
}
