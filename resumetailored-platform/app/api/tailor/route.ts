import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { auth, currentUser } from "@clerk/nextjs/server";
import { getAnthropic, buildTailorPrompts, CLAUDE_MODEL, isProviderUnavailable, VARIANT_KEYS, VARIANT_LABELS, type VariantKey } from "@/lib/ai";
import { getAccess, canUseIndividualPro } from "@/lib/plan";
import { allTemplatesFree, PRO_TEMPLATE_MESSAGE } from "@/lib/template-gate";
import { recordGeneration } from "@/lib/generations";
import { cleanInstructions, CUSTOM_INSTRUCTIONS_MAX, CUSTOM_INSTRUCTIONS_MAX_PRO } from "@/lib/instructions";
import { getCustomInstructions } from "@/lib/user-prefs-store";
import { isLifetimeAccount, variantUsage, recordVariantGeneration, LIFETIME_CAP_MESSAGE, LIFETIME_VARIANT_MONTHLY_CAP } from "@/lib/tailor-variants";
import type { Mode } from "@/lib/resume-templates";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Tailors a resume and/or cover letter to a job posting. Ported from the old
 * site's `/api/tailor`: same prompts, same model (claude-sonnet-4-6). Requires
 * a signed-in Clerk user (the account, not a daily quota, guards the AI budget).
 * Tailoring itself is free + unlimited for signed-in users.
 *
 * Pro extras: `variants: true` returns three takes on the same facts (conservative /
 * balanced / bold) from parallel calls with different stances. Monthly Pro is unlimited
 * (fair-use rate limited); Lifetime is capped at LIFETIME_VARIANT_MONTHLY_CAP sets per
 * calendar month. Free callers ignore `variants` and get the single output.
 */
export async function POST(req: Request) {
  const limited = rateLimit(req, "tailor");
  if (limited) return limited;
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "not_signed_in", message: "Your session expired. Please refresh and sign in again." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { resume?: string; jobPosting?: string; mode?: Mode; customInstructions?: unknown; templateId?: unknown; variants?: unknown };

  const access = await getAccess();
  const pro = canUseIndividualPro(access);

  // Server-side template gate (mirrors Legacy FREE_TPL_SIGS): a free account may only
  // use the free template ids; anything else is Pro.
  if (body.templateId !== undefined && !allTemplatesFree([body.templateId]) && !pro) {
    return NextResponse.json({ error: "pro_template", message: PRO_TEMPLATE_MESSAGE }, { status: 402 });
  }

  const { resume, jobPosting, mode } = body;

  if (!mode || !["resume", "cover_letter", "both"].includes(mode)) {
    return NextResponse.json({ error: "Invalid mode." }, { status: 400 });
  }
  if (!jobPosting || typeof jobPosting !== "string") {
    return NextResponse.json({ error: "Job posting is required." }, { status: 400 });
  }
  if (mode !== "cover_letter" && (!resume || typeof resume !== "string")) {
    return NextResponse.json({ error: "Resume is required." }, { status: 400 });
  }
  // Cost floor: cap request size (a few thousand words is realistic).
  if (jobPosting.length > 50000 || (resume && resume.length > 50000)) {
    return NextResponse.json({ error: "Text is too long. Please paste the resume/job posting text only." }, { status: 400 });
  }

  const anthropic = getAnthropic();
  if (!anthropic) {
    return NextResponse.json({ error: "not_configured", message: "AI is not configured. Set ANTHROPIC_API_KEY." }, { status: 501 });
  }

  // Standing writing preferences: an explicit per-run string wins (it is what the
  // user sees in the panel, including unsaved edits); otherwise the saved ones apply.
  // Free keeps 2,000 characters; Pro is effectively unlimited.
  const ciMax = pro ? CUSTOM_INSTRUCTIONS_MAX_PRO : CUSTOM_INSTRUCTIONS_MAX;
  const customInstructions =
    typeof body.customInstructions === "string" ? cleanInstructions(body.customInstructions, ciMax) : (await getCustomInstructions(userId, ciMax)).instructions;

  // Pro variants + the Lifetime monthly cap (checked BEFORE spending any AI calls).
  const wantVariants = body.variants === true && pro;
  let lifetime = false;
  if (wantVariants) {
    const email = access.isAdmin || typeof access.lifetime === "boolean" ? null : (await currentUser())?.emailAddresses?.[0]?.emailAddress ?? null;
    lifetime = await isLifetimeAccount(access, userId, email);
    const usage = await variantUsage(userId, lifetime);
    if (usage.limit !== null && usage.used >= usage.limit) {
      return NextResponse.json(
        { error: "variant_cap", message: LIFETIME_CAP_MESSAGE, used: usage.used, limit: usage.limit, upgrade: "monthly" },
        { status: 402 }
      );
    }
  }

  const generate = async (stance?: VariantKey): Promise<string> => {
    const { system, user: userPrompt } = buildTailorPrompts({ resume, jobPosting, mode, customInstructions, stance });
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 8192,
      system,
      messages: [{ role: "user", content: userPrompt }],
    });
    const block = message.content[0];
    return block && block.type === "text" ? block.text : "";
  };

  try {
    if (wantVariants) {
      const texts = await Promise.all(VARIANT_KEYS.map((k) => generate(k)));
      const variants = VARIANT_KEYS.map((key, i) => ({ key, label: VARIANT_LABELS[key], text: texts[i] }));
      if (variants.some((v) => !v.text.trim())) throw new Error("empty variant");
      const balanced = variants.find((v) => v.key === "balanced")!.text;
      // Persist for the dashboard (both = a resume + a cover letter in one call).
      await recordGeneration(userId, mode === "cover_letter" ? "cover_letter" : "resume", { text: balanced, mode });
      const used = await recordVariantGeneration(userId);
      return NextResponse.json({
        result: balanced,
        variants,
        usage: { used: used ?? null, limit: lifetime ? LIFETIME_VARIANT_MONTHLY_CAP : null, lifetime },
      });
    }

    const text = await generate();
    // Persist for the dashboard (both = a resume + a cover letter in one call).
    await recordGeneration(userId, mode === "cover_letter" ? "cover_letter" : "resume", { text, mode });
    return NextResponse.json({ result: text });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    console.error("Claude API error:", e?.status, e?.message || err);
    let userMessage = "AI processing failed. Please try again.";
    if (e?.status === 401) userMessage = "AI service authentication error. Please contact support.";
    else if (e?.status === 429) userMessage = "AI is rate limited. Please wait a moment and try again.";
    else if (isProviderUnavailable(err)) userMessage = "AI service is temporarily busy. Please try again in 30 seconds.";
    return NextResponse.json({ error: userMessage }, { status: 500 });
  }
}
