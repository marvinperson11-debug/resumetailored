#!/usr/bin/env node
/**
 * Deletes everything the smoke runs created for ONE dedicated test user and reports it.
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SMOKE_USER_ID=smoke_... node scripts/smoke-cleanup.cjs
 * Scope: rows whose user_id = SMOKE_USER_ID in vacancies / document_batches / document_batch_items, and
 * storage objects under "<SMOKE_USER_ID>/" in the generated-documents bucket. Nothing else is touched.
 * Refuses an id that does not start with "smoke_" so it can never be pointed at a real account.
 */
const { createClient } = require("@supabase/supabase-js");
const BUCKET = "generated-documents";

async function listAll(c, prefix) {
  const out = [];
  const { data, error } = await c.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error) throw new Error(`storage list ${prefix}: ${error.message}`);
  for (const e of data || []) {
    const p = `${prefix}/${e.name}`;
    if (e.id === null || e.id === undefined) out.push(...(await listAll(c, p))); // a folder
    else out.push(p);
  }
  return out;
}

async function cleanup(c, userId) {
  if (!/^smoke_/.test(userId)) throw new Error('SMOKE_USER_ID must start with "smoke_" — refusing.');
  const report = { items: 0, batches: 0, vacancies: 0, objects: 0, leftover: {} };
  // children first (also cascade from batches/vacancies, but count explicitly)
  let r = await c.from("document_batch_items").delete({ count: "exact" }).eq("user_id", userId); if (r.error) throw r.error; report.items = r.count || 0;
  r = await c.from("document_batches").delete({ count: "exact" }).eq("user_id", userId); if (r.error) throw r.error; report.batches = r.count || 0;
  r = await c.from("vacancies").delete({ count: "exact" }).eq("user_id", userId); if (r.error) throw r.error; report.vacancies = r.count || 0;
  const files = await listAll(c, userId);
  for (let i = 0; i < files.length; i += 100) {
    const rm = await c.storage.from(BUCKET).remove(files.slice(i, i + 100));
    if (rm.error) throw new Error(`storage remove: ${rm.error.message}`);
  }
  report.objects = files.length;
  report.deletedPaths = files;
  // verify nothing is left
  for (const t of ["vacancies", "document_batches", "document_batch_items"]) {
    const { count } = await c.from(t).select("id", { count: "exact", head: true }).eq("user_id", userId);
    report.leftover[t] = count || 0;
  }
  report.leftover.objects = (await listAll(c, userId)).length;
  return report;
}
module.exports = { cleanup };

if (require.main === module) {
  const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key, SMOKE_USER_ID: uid } = process.env;
  if (!url || !key || !uid) { console.error("NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and SMOKE_USER_ID are required"); process.exit(2); }
  cleanup(createClient(url, key, { auth: { persistSession: false } }), uid)
    .then((r) => { console.log(JSON.stringify(r, null, 2)); const left = Object.values(r.leftover).reduce((a, b) => a + b, 0); process.exit(left ? 1 : 0); })
    .catch((e) => { console.error(e.message || e); process.exit(1); });
}
