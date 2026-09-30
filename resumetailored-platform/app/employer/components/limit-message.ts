/** Structured 402 body the document / e-signature routes return when a tier
 *  cap is hit — see `checkDocumentAllowance` / `checkSendAllowance`. */
export interface LimitReachedBody {
  error?: string;
  code?: string;
  kind?: string;
  limit?: number;
  tier?: string;
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Render a `limit_reached` response in the viewer's language. `t` must be the
 *  `employerUi` translator. Falls back to the server's English `error` text
 *  when the body doesn't carry enough structure to build the sentence. */
export function limitReachedMessage(t: Translate, body: LimitReachedBody): string | null {
  if (body.code !== "limit_reached") return null;
  const { kind, tier, limit } = body;
  if ((kind === "documents" || kind === "esign") && (tier === "free" || tier === "portal" || tier === "scale") && typeof limit === "number") {
    return t(`limit.${kind}`, { limit, plan: t(`tierNames.${tier}`), next: t(`limit.next.${kind}.${tier}`) });
  }
  return body.error ?? null;
}
