import { SignClient } from "./sign-client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Upload documents — ResumeTailored",
  robots: { index: false, follow: false },
};

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
