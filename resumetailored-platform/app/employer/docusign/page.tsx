import { getAccess } from "@/lib/plan";
import { DocusignClient } from "./docusign-client";

export const dynamic = "force-dynamic";

export default async function DocusignPage({ searchParams }: { searchParams: { connected?: string; error?: string } }) {
  const access = await getAccess();
  return (
    <DocusignClient
      connected={searchParams?.connected === "1"}
      error={searchParams?.error}
      isAdmin={!!access.isAdmin}
    />
  );
}
