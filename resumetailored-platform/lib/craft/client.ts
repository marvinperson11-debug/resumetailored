import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { craftEndpoint } from "./config";

/**
 * The one way the app talks to the Craft sidecar. Every call sends the shared secret and a fresh nonce, and a
 * response only counts if it carries `x-craft-proof = HMAC(secret, nonce)` — so a wrong CRAFT_BASE_URL (or
 * anything else answering on it) is "untrusted", never data. Never throws: callers get either the sidecar's
 * answer (`reached`, any status) or `unavailable` with a reason, and degrade (503 / LibreOffice) on the latter.
 */
export type CraftUnavailable = "unconfigured" | "unreachable" | "timeout" | "untrusted";
export type CraftResult =
  | { kind: "reached"; status: number; code?: string; body: Buffer; headers: Headers }
  | { kind: "unavailable"; reason: CraftUnavailable; detail?: string };

export async function craftPost(
  path: string,
  file: Buffer,
  opts: { filename: string; mime: string; query?: Record<string, string>; timeoutMs?: number } = { filename: "upload", mime: "application/octet-stream" }
): Promise<CraftResult> {
  const ep = craftEndpoint();
  if (!ep) return { kind: "unavailable", reason: "unconfigured" };
  const url = new URL(ep.baseUrl + path);
  for (const [k, v] of Object.entries(opts.query || {})) url.searchParams.set(k, v);
  const nonce = randomBytes(16).toString("hex");
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(file)], { type: opts.mime }), opts.filename);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "x-craft-secret": ep.secret, "x-craft-nonce": nonce },
      body: form,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { kind: "unavailable", reason: timeout ? "timeout" : "unreachable", detail: e instanceof Error ? e.name : typeof e };
  }
  const proof = res.headers.get("x-craft-proof") || "";
  const want = createHmac("sha256", ep.secret).update(nonce).digest("hex");
  if (proof.length !== want.length || !timingSafeEqual(Buffer.from(proof), Buffer.from(want))) {
    await res.body?.cancel().catch(() => {});
    return { kind: "unavailable", reason: "untrusted", detail: `status ${res.status}` };
  }
  const body = Buffer.from(await res.arrayBuffer());
  let code: string | undefined;
  if (res.status >= 400) {
    try { code = (JSON.parse(body.toString("utf8")) as { error?: string }).error; } catch { /* not JSON */ }
  }
  return { kind: "reached", status: res.status, code, body, headers: res.headers };
}
