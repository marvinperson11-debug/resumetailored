import { getTranslations } from "next-intl/server";
import type { Access } from "@/lib/plan";

/**
 * Shown at the top of every employer / candidate view while an admin plan preview
 * is active (`access.preview`, set only by lib/plan.ts for the real admin), so the
 * sample data on screen is never mistaken for a real account. Renders nothing
 * outside preview mode.
 */
export async function PreviewDataBanner({ access, side }: { access: Access; side: "employer" | "candidate" }) {
  if (!access.preview || access.preview.side !== side) return null;
  const t = await getTranslations("planPreview");
  return (
    <div
      role="status"
      data-testid="preview-data-banner"
      className="mb-4 rounded-lg border border-amber-400/60 bg-amber-400/15 px-4 py-2 text-center text-sm font-semibold text-amber-200"
    >
      {t("dataBanner")}
    </div>
  );
}
