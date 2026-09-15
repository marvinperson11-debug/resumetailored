import { DocusignClient } from "./docusign-client";

export const dynamic = "force-dynamic";

export default function DocusignPage({ searchParams }: { searchParams: { connected?: string; error?: string } }) {
  return <DocusignClient connected={searchParams?.connected === "1"} error={searchParams?.error} />;
}
