import { useTranslations } from "next-intl";
import {
  Sparkles,
  PenTool,
  ScanLine,
  FileSearch,
  MessageSquare,
  Contact,
  Briefcase,
  Compass,
  Video,
  Globe,
  FolderOpen,
  Link2,
  LifeBuoy,
  Mail,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";

/**
 * Help centre for the candidate app: FAQ, a guide per tool, and a contact button.
 * Visible to every plan (nothing here is gated). Pure server component — the accordion is
 * native <details>, so it works without client JS. All copy lives under the `help` messages.
 */
export const dynamic = "force-dynamic";

const SUPPORT_MAILTO = "mailto:support@resumetailored.com?subject=ResumeTailored%20support%20request";

type Availability = "free" | "pro" | "mixed";

// One entry per candidate tool. `steps` = number of "how to use it" steps in the messages.
const TOOLS: { id: string; icon: LucideIcon; plan: Availability; steps: number }[] = [
  { id: "resume", icon: Sparkles, plan: "mixed", steps: 5 },
  { id: "cover", icon: PenTool, plan: "free", steps: 4 },
  { id: "ats", icon: ScanLine, plan: "free", steps: 4 },
  { id: "decoder", icon: FileSearch, plan: "mixed", steps: 4 },
  { id: "interview", icon: MessageSquare, plan: "mixed", steps: 4 },
  { id: "linkedin", icon: Contact, plan: "mixed", steps: 4 },
  { id: "jobs", icon: Briefcase, plan: "mixed", steps: 4 },
  { id: "career", icon: Compass, plan: "mixed", steps: 4 },
  { id: "video", icon: Video, plan: "pro", steps: 4 },
  { id: "website", icon: Globe, plan: "pro", steps: 4 },
  { id: "resumes", icon: FolderOpen, plan: "free", steps: 4 },
  { id: "shareable", icon: Link2, plan: "free", steps: 4 },
];

const FAQ_COUNT = 12;

const card = "rounded-2xl border border-border-gold bg-white/[0.03]";
const BADGE_STYLE: Record<Availability, string> = {
  free: "border-teal/40 bg-teal/10 text-teal",
  pro: "border-gold/50 bg-gold/10 text-gold",
  mixed: "border-violet/40 bg-violet/10 text-violet",
};

export default function HelpPage() {
  const t = useTranslations("help");

  const contact = (
    <a
      href={SUPPORT_MAILTO}
      className="inline-flex items-center gap-2 rounded-xl bg-violet px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet/90"
    >
      <Mail className="h-4 w-4" aria-hidden="true" /> {t("contactCta")}
    </a>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 font-serif text-2xl font-medium text-cream">
            <LifeBuoy className="h-6 w-6 text-gold" aria-hidden="true" /> {t("title")}
          </h1>
          <p className="mt-1 text-sm text-white/60">{t("subtitle")}</p>
          <nav aria-label={t("jumpTo")} className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <a href="#faq" className="text-gold underline-offset-2 hover:underline">{t("faqTitle")}</a>
            <a href="#tools" className="text-gold underline-offset-2 hover:underline">{t("toolsTitle")}</a>
          </nav>
        </div>
        {contact}
      </header>

      {/* FAQ */}
      <section id="faq" aria-labelledby="faq-title" className="scroll-mt-24">
        <h2 id="faq-title" className="text-sm font-semibold text-cream">{t("faqTitle")}</h2>
        <p className="mb-3 mt-1 text-xs text-white/50">{t("faqSub")}</p>
        <div className="space-y-2">
          {Array.from({ length: FAQ_COUNT }, (_, i) => i + 1).map((n) => (
            <details key={n} className={`${card} group px-4 py-3`}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium text-cream [&::-webkit-details-marker]:hidden">
                {t(`faq.q${n}.q`)}
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-cream transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-white/70">{t(`faq.q${n}.a`)}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Tool guides */}
      <section id="tools" aria-labelledby="tools-title" className="scroll-mt-24">
        <h2 id="tools-title" className="text-sm font-semibold text-cream">{t("toolsTitle")}</h2>
        <p className="mb-3 mt-1 text-xs text-white/50">{t("toolsSub")}</p>
        <div className="space-y-2">
          {TOOLS.map(({ id, icon: Icon, plan, steps }) => (
            <details key={id} className={`${card} group px-4 py-3`}>
              <summary className="flex cursor-pointer list-none items-center gap-3 text-sm font-medium text-cream [&::-webkit-details-marker]:hidden">
                <Icon className="h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
                <span className="min-w-0 flex-1">{t(`tools.${id}.name`)}</span>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${BADGE_STYLE[plan]}`}>
                  {t(`badge.${plan}`)}
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-cream transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-white/70">{t(`tools.${id}.desc`)}</p>
              <h3 className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-white/50">{t("howTo")}</h3>
              <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed text-white/70 marker:text-gold">
                {Array.from({ length: steps }, (_, i) => i + 1).map((s) => (
                  <li key={s}>{t(`tools.${id}.s${s}`)}</li>
                ))}
              </ol>
            </details>
          ))}
        </div>
      </section>

      {/* Contact */}
      <section aria-labelledby="contact-title" className={`${card} flex flex-wrap items-center justify-between gap-4 p-6`}>
        <div className="min-w-0">
          <h2 id="contact-title" className="text-sm font-semibold text-cream">{t("contactTitle")}</h2>
          <p className="mt-1 text-xs text-white/55">{t("contactBody")}</p>
        </div>
        {contact}
      </section>
    </div>
  );
}
