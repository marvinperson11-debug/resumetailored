import { ShareableLinks } from "./shareable-links";

// Real page (replaces the old catch-all "Coming Soon"). Surfaces the user's
// published public link(s).
export const dynamic = "force-dynamic";

export default function ShareableLinksPage() {
  return <ShareableLinks />;
}
