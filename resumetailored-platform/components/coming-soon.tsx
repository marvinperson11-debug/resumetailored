import Link from "next/link";
import { useTranslations } from "next-intl";

/**
 * Full-page "Coming Soon" placeholder for features that don't have a screen yet.
 * Centered dark-teal card on the navy page: Playfair heading, muted subtext,
 * and a gold "Go Back to Dashboard" button.
 */
export function FeaturePlaceholder({
  feature,
  backHref,
}: {
  feature: string;
  backHref: string;
}) {
  const ts = useTranslations("shell");
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-3xl items-center justify-center">
      <div className="glass w-full px-8 py-14 text-center">
        <h1 className="font-serif text-3xl font-medium text-white sm:text-4xl">
          {ts("comingSoonTitle", { feature })}
        </h1>
        <p className="mx-auto mt-4 max-w-md text-base text-white/70">
          {ts("comingSoonBody")}
        </p>
        <Link
          href={backHref}
          className="mt-8 inline-block rounded-xl bg-violet px-6 py-3 text-sm font-semibold text-white shadow-[0_0_20px_rgba(194,135,11,0.3)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_0_28px_rgba(194,135,11,0.45)]"
        >
          {ts("backToDashboard")}
        </Link>
      </div>
    </div>
  );
}

/** Fallback: turn a URL slug into a readable title, e.g. "job-matches" → "Job Matches". */
export function titleFromSlug(slug: string[] | undefined): string {
  const last = slug?.[slug.length - 1] ?? "Section";
  return last
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
