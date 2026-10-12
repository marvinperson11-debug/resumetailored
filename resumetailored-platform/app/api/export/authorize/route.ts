import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isIndividualPro } from "@/lib/plan";
import { allTemplatesFree, PRO_TEMPLATE_MESSAGE } from "@/lib/template-gate";

export const runtime = "nodejs";

/**
 * Export authorization. PDF/DOCX/TXT are rendered in the browser, so the server
 * is the one that decides (a) whether the chosen template(s) are allowed for
 * this account and (b) whether the export carries the free-tier watermark.
 * Pro (and employees, via canUseIndividualPro) get every template, no watermark.
 *
 * Signed-out visitors are allowed: the download is part of the free taste. They are
 * always free-tier here (free templates only, watermark on). The export itself is rendered
 * in the browser, so this costs nothing and takes no guest quota.
 */
export async function POST(req: Request) {
  const { userId } = await auth();
  const body = (await req.json().catch(() => ({}))) as { tplIds?: unknown };
  const tplIds = Array.isArray(body.tplIds) ? body.tplIds.slice(0, 4) : [];
  const pro = userId ? await isIndividualPro() : false;
  if (!pro && !allTemplatesFree(tplIds)) {
    return NextResponse.json({ error: "pro_template", message: PRO_TEMPLATE_MESSAGE }, { status: 402 });
  }
  return NextResponse.json({ ok: true, watermark: !pro, pro, ...(userId ? {} : { guest: true }) });
}
