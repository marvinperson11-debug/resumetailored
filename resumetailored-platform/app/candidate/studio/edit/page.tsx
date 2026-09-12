import { redirect } from "next/navigation";
import { getAccess, canUseIndividualPro } from "@/lib/plan";
import { StudioEditor } from "./studio-editor";

// Full-screen WYSIWYG website editor. Pro-only (Resume Video / Web Studio tier):
// free users are bounced to the upgrade flow before the editor ever mounts.
export const dynamic = "force-dynamic";

export default async function StudioEditPage() {
  const access = await getAccess();
  if (!canUseIndividualPro(access)) redirect("/candidate?upgrade=pro");
  return <StudioEditor />;
}
