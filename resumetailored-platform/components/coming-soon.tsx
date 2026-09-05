import { SectionHeading } from "@/components/dashboard-ui";

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

/** Turn a URL slug segment into a readable title, e.g. "job-matches" → "Job Matches". */
export function titleFromSlug(slug: string[] | undefined): string {
  const last = slug?.[slug.length - 1] ?? "Section";
  return last
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
