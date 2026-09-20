import { getAccess, isEmployer } from "@/lib/plan";
import { DocumentsClient } from "./documents-client";

export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const access = await getAccess();
  return <DocumentsClient canManage={isEmployer(access)} />;
}
