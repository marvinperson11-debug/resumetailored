import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Best-effort fetch of a public LinkedIn URL → plain text for the analyzer.
 *  LinkedIn usually login-walls profiles, so this frequently returns little —
 *  the UI falls back to "paste your profile instead". Scoped to linkedin.com
 *  hosts only (no arbitrary server-side fetch / SSRF). */
export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { url?: string };
  let url: URL;
  try {
    url = new URL(String(body.url || "").trim());
  } catch {
    return NextResponse.json({ error: "Enter a valid URL." }, { status: 400 });
  }
  const host = url.hostname.replace(/^www\./, "");
  if (url.protocol !== "https:" || !(host === "linkedin.com" || host.endsWith(".linkedin.com"))) {
    return NextResponse.json({ error: "Enter a public https LinkedIn profile URL, or just paste your profile text." }, { status: 400 });
  }

  try {
    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ResumeTailoredBot/1.0; +https://resumetailored.com)",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(12000),
      redirect: "follow",
    });
    if (!res.ok) {
      return NextResponse.json({ error: "LinkedIn blocked the request. Paste your profile text instead.", blocked: true }, { status: 502 });
    }
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/gi, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 15000);
    if (text.length < 200 || /sign in|join now|log in to linkedin/i.test(text.slice(0, 400))) {
      return NextResponse.json({ error: "Couldn't read much (LinkedIn login wall). Paste your profile text instead.", blocked: true }, { status: 200 });
    }
    return NextResponse.json({ text });
  } catch {
    return NextResponse.json({ error: "Couldn't reach that URL. Paste your profile text instead.", blocked: true }, { status: 502 });
  }
}
