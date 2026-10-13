import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "crypto";
import { CLAUDE_MODEL, getAnthropic } from "../ai";
import { runVacancyPackage, type Llm, type PackageResult } from "./pipeline";
import { DOCX_MIME } from "./docx-render";
import { buildBatchZip } from "./zip";
import { docsDb, getFile, getVacancy, latestProfileText, otherEmployers, putFile, signedUrl } from "./store";
import type { Vacancy } from "./types";

/** Wires the pipeline to Anthropic + Supabase. The pipeline itself (pipeline.ts) is pure and tested offline. */

export function anthropicLlm(client: Anthropic | null = getAnthropic()): Llm | null {
  if (!client) return null;
  return async ({ system, user, maxTokens }) => {
    const m = await client.messages.create({ model: CLAUDE_MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] });
    const b = m.content[0];
    return b && b.type === "text" ? b.text : "";
  };
}

/** ONE run for ONE vacancy id: fresh DB read → pipeline → files in Storage. Used by the single route and the batch worker. */
export async function runStoredVacancy(a: {
  userId: string; vacancyId: string; profileText: string; llm: Llm; kinds?: ("resume" | "cover_letter")[]; prefs?: string;
}): Promise<{ vacancy: Vacancy; result: PackageResult; paths: { resume?: string; coverLetter?: string } } | null> {
  const vacancy = await getVacancy(a.userId, a.vacancyId); // fresh fetch — never conversation history or a prior run
  if (!vacancy) return null;
  const others = await otherEmployers(a.userId, vacancy.id);
  const result = await runVacancyPackage({ vacancy, profileText: a.profileText, llm: a.llm, otherEmployers: others, prefs: a.prefs, kinds: a.kinds });
  const paths: { resume?: string; coverLetter?: string } = {};
  const run = randomUUID();
  // A resume with unverified details is NOT exported; the caller gets the flags instead.
  if (result.resume && !result.resume.flags.length) {
    const p = `${a.userId}/${vacancy.id}/${run}/Resume.docx`;
    if (await putFile(p, result.resume.docx, DOCX_MIME)) paths.resume = p;
  }
  if (result.coverLetter) {
    const p = `${a.userId}/${vacancy.id}/${run}/CoverLetter.docx`;
    if (await putFile(p, result.coverLetter.docx, DOCX_MIME)) paths.coverLetter = p;
  }
  return { vacancy, result, paths };
}

export async function resolveProfile(userId: string, supplied: unknown): Promise<string> {
  if (typeof supplied === "string" && supplied.trim()) return supplied.trim().slice(0, 50000);
  return latestProfileText(userId);
}

/* ─────────────── Batch queue ─────────────── */

const running = new Set<string>();
const STALE_MS = 5 * 60_000;
const CONCURRENCY = 2;

type ItemRow = { id: string; vacancy_id: string; position: number; status: string; resume_path: string | null; cover_path: string | null; flags: unknown; errors: unknown };

/** Claim one pending (or stale-running) item atomically: the UPDATE only matches while it is still claimable. */
async function claim(batchId: string): Promise<ItemRow | null> {
  const c = docsDb();
  if (!c) return null;
  const stale = new Date(Date.now() - STALE_MS).toISOString();
  const { data: candidates } = await c
    .from("document_batch_items")
    .select("id")
    .eq("batch_id", batchId)
    .or(`status.eq.pending,and(status.eq.running,claimed_at.lt.${stale})`)
    .order("position", { ascending: true })
    .limit(1);
  const id = (candidates?.[0] as { id: string } | undefined)?.id;
  if (!id) return null;
  const { data } = await c
    .from("document_batch_items")
    .update({ status: "running", claimed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .or(`status.eq.pending,and(status.eq.running,claimed_at.lt.${stale})`)
    .select("id, vacancy_id, position, status, resume_path, cover_path, flags, errors");
  return (data?.[0] as ItemRow | undefined) || null;
}

/** Process every claimable item of a batch, then assemble the ZIP. Idempotent; safe to call again after a restart. */
export async function processBatch(batchId: string): Promise<void> {
  const c = docsDb();
  if (!c || running.has(batchId)) return;
  running.add(batchId);
  try {
    const { data: batch } = await c.from("document_batches").select("id, user_id, profile_text, status").eq("id", batchId).maybeSingle();
    if (!batch) return;
    const b = batch as { id: string; user_id: string; profile_text: string; status: string };
    const llm = anthropicLlm();
    if (!llm) { await c.from("document_batches").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", batchId); return; }
    await c.from("document_batches").update({ status: "running", updated_at: new Date().toISOString() }).eq("id", batchId);

    const worker = async () => {
      for (;;) {
        const item = await claim(batchId);
        if (!item) return;
        let patch: Record<string, unknown>;
        try {
          const r = await runStoredVacancy({ userId: b.user_id, vacancyId: item.vacancy_id, profileText: b.profile_text, llm });
          if (!r) patch = { status: "failed", errors: [{ kind: "vacancy", code: "not_found", message: "Vacancy not found." }] };
          else {
            const flags = r.result.resume?.flags || [];
            const ok = !!r.paths.resume || !!r.paths.coverLetter;
            patch = {
              status: flags.length ? "needs_review" : ok ? "done" : "failed",
              resume_path: r.paths.resume || null,
              cover_path: r.paths.coverLetter || null,
              flags,
              errors: r.result.errors,
            };
          }
        } catch (e) {
          patch = { status: "failed", errors: [{ kind: "run", code: "exception", message: e instanceof Error ? e.message : "failed" }] };
        }
        await c.from("document_batch_items").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", item.id);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    const { data: items } = await c.from("document_batch_items").select("*").eq("batch_id", batchId).order("position", { ascending: true });
    const rows = (items || []) as (ItemRow & { vacancy_id: string })[];
    if (rows.some((r) => r.status === "pending" || r.status === "running")) return; // another worker still has some
    const zipItems = [];
    const notes: string[] = [];
    for (const r of rows) {
      const v = await getVacancy(b.user_id, r.vacancy_id);
      if (!v) continue;
      const resume = r.resume_path ? await getFile(r.resume_path) : null;
      const cover = r.cover_path ? await getFile(r.cover_path) : null;
      zipItems.push({ employer: v.employer, position: v.position, resume: resume || undefined, coverLetter: cover || undefined });
      const flags = (r.flags as { message: string }[]) || [];
      if (flags.length) notes.push(`${v.employer} — ${v.position}: resume withheld. ${flags.map((f) => f.message).join(" ")}`);
      for (const e of (r.errors as { kind: string; message: string }[]) || []) notes.push(`${v.employer} — ${v.position}: ${e.kind} not produced. ${e.message}`);
    }
    const zip = await buildBatchZip(zipItems, notes);
    const zipPath = `${b.user_id}/batches/${batchId}.zip`;
    const stored = await putFile(zipPath, zip, "application/zip");
    await c.from("document_batches").update({ status: stored ? "done" : "failed", zip_path: stored ? zipPath : null, updated_at: new Date().toISOString() }).eq("id", batchId);
  } finally {
    running.delete(batchId);
  }
}

export { signedUrl };
