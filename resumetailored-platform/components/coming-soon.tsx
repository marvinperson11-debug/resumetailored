import Link from "next/link";

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
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-3xl items-center justify-center">
      <div className="w-full rounded-lg border border-border-gold bg-teal px-8 py-14 text-center">
        <h1 className="font-serif text-3xl font-medium text-cream sm:text-4xl">
          {feature} — Coming Soon
        </h1>
        <p className="mx-auto mt-4 max-w-md text-base text-muted-cream">
          We&rsquo;re building this for you. Check back next week.
        </p>
        <Link
          href={backHref}
          className="mt-8 inline-block rounded-md bg-gold px-6 py-3 text-sm font-semibold text-navy transition-all duration-200 hover:scale-[1.01] hover:bg-[#d4b884]"
        >
          Go Back to Dashboard
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
