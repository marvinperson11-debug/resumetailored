import Link from "next/link";
import { SectionHeading } from "@/components/dashboard-ui";

/** Inline "coming soon" panel used by the catch-all section routes. */
export function ComingSoon({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <SectionHeading>{title}</SectionHeading>
      <div className="rounded-lg border border-border-gold bg-teal p-10 text-center">
        <p className="text-lg font-medium text-cream">{title}</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-cream">
          This section is part of the demo shell. The layout, navigation and
          design system are live — detailed screens land here next.
        </p>
      </div>
    </div>
  );
}

/**
 * Full-page placeholder for named features that don't have a screen yet.
 * Heading, subtext, and a gold "Go Back to Dashboard" button.
 */
export function FeaturePlaceholder({
  feature,
  backHref,
}: {
  feature: string;
  backHref: string;
}) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center text-center">
      <h1 className="font-serif text-3xl font-medium text-cream sm:text-4xl">
        {feature} — Coming Soon
      </h1>
      <p className="mt-4 max-w-md text-base text-muted-cream">
        We&rsquo;re building this for you. Check back next week.
      </p>
      <Link
        href={backHref}
        className="mt-8 rounded-md bg-gold px-6 py-3 text-sm font-semibold text-navy transition-all duration-200 hover:scale-[1.01] hover:bg-[#d4b884]"
      >
        Go Back to Dashboard
      </Link>
    </div>
  );
}

/** Turn a URL slug segment into a readable title, e.g. "job-matches" → "Job Matches". */
export function titleFromSlug(slug: string[] | undefined): string {
  const last = slug?.[slug.length - 1] ?? "Section";
  return last
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
