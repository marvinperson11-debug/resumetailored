import type { Locale } from "@/i18n/locales";
import type { DocKind } from "./employee-hub";

/**
 * Localized copy for server-sent emails. Server-side sends have no request
 * (no cookie, no Accept-Language) — the recipient's language comes from
 * `getRecipientLocale()` (lib/locale-pref.ts), which reads their saved
 * Settings preference off Clerk `publicMetadata.locale`.
 *
 * This file is a proof of concept, not full coverage: it localizes the one
 * email wired to it (the training reminder, see training-notify.ts). Every
 * other sender in employer-notify.ts / esign-delivery.ts / cert-cron.ts still
 * sends English only — see the coverage audit for the full list of what's
 * left. The pattern here (one small copy object per email, keyed by Locale,
 * with the same shape and a `parity` test target) is meant to be repeated
 * for those, not reinvented per email.
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
