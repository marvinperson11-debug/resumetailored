import { getTranslations } from "next-intl/server";
import { SignClient } from "./sign-client";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("publicSign");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

/**
 * Public, login-less signer upload page: /sign/{envelopeId}?key={token}.
 * The token in the link is the only credential — validated server-side by the
 * /api/sign routes. No Clerk session is required (this path is not a protected
 * route in middleware.ts).
 */
export default function SignPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { key?: string };
}) {
  return <SignClient envelopeId={params.id} token={searchParams?.key || ""} />;
}
