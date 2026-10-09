import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SAVED_VIDEOS_BUCKET, type SavedVideoRow, type VideoBackend } from "./saved-videos";
import { cleanVideoSettings } from "./video-settings";

/**
 * Supabase implementation of the saved-videos backend (table saved_resume_videos + the private
 * `resume-videos` bucket, migration 0047). Service-role access; every query is scoped by user_id.
 */
let cached: SupabaseClient | null = null;
function db(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

const TABLE = "saved_resume_videos";

interface DbRow {
  id: string; user_id: string; title: string; script: string; script_source: string; script_edited: boolean;
  to_whom: string; opener: string; closer: string; template: string; resume_text: string; settings: unknown;
  video_path: string; script_path: string; size_bytes: number | string; created_at: string;
}

function fromDb(r: DbRow): SavedVideoRow {
  return {
    id: r.id,
    userId: r.user_id,
    title: r.title,
    script: r.script,
    scriptSource: r.script_source === "written" ? "written" : "ai",
    scriptEdited: !!r.script_edited,
    toWhom: r.to_whom,
    opener: r.opener,
    closer: r.closer,
    template: r.template,
    resumeText: r.resume_text,
    settings: { ...cleanVideoSettings(r.settings), customOpeners: [], customClosers: [] },
    videoPath: r.video_path,
    scriptPath: r.script_path,
    sizeBytes: Number(r.size_bytes) || 0,
    createdAt: r.created_at,
  };
}

export function supabaseVideoBackend(): VideoBackend | null {
  const c = db();
  if (!c) return null;
  return {
    async insertRow(r) {
      const { error } = await c.from(TABLE).insert({
        id: r.id, user_id: r.userId, title: r.title, script: r.script, script_source: r.scriptSource,
        script_edited: r.scriptEdited, to_whom: r.toWhom, opener: r.opener, closer: r.closer, template: r.template,
        resume_text: r.resumeText, settings: r.settings, video_path: r.videoPath, script_path: r.scriptPath,
        size_bytes: r.sizeBytes, created_at: r.createdAt,
      });
      if (error) console.error("[saved-videos] insert", error.message);
      return !error;
    },
    async listRows(userId) {
      const { data, error } = await c.from(TABLE).select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(100);
      if (error || !data) return [];
      return (data as DbRow[]).map(fromDb);
    },
    async getRow(userId, id) {
      const { data, error } = await c.from(TABLE).select("*").eq("user_id", userId).eq("id", id).maybeSingle();
      return error || !data ? null : fromDb(data as DbRow);
    },
    async deleteRow(userId, id) {
      const { error } = await c.from(TABLE).delete().eq("user_id", userId).eq("id", id);
      return !error;
    },
    async putFile(path, bytes, contentType) {
      const { error } = await c.storage.from(SAVED_VIDEOS_BUCKET).upload(path, bytes, { contentType, upsert: false });
      if (error) console.error("[saved-videos] upload", error.message);
      return !error;
    },
    async removeFiles(paths) {
      if (!paths.length) return;
      const { error } = await c.storage.from(SAVED_VIDEOS_BUCKET).remove(paths);
      if (error) console.error("[saved-videos] remove", error.message);
    },
    async getFile(path) {
      const { data, error } = await c.storage.from(SAVED_VIDEOS_BUCKET).download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async signedUrl(path, expiresInSeconds, downloadAs) {
      const { data, error } = await c.storage.from(SAVED_VIDEOS_BUCKET).createSignedUrl(path, expiresInSeconds, downloadAs ? { download: downloadAs } : undefined);
      return error || !data ? null : data.signedUrl;
    },
  };
}

/** How many saved videos a user has — counted toward "Resumes built" on the dashboard. */
export async function countSavedVideos(userId: string): Promise<number> {
  const c = db();
  if (!c || !userId) return 0;
  try {
    const { count, error } = await c.from(TABLE).select("id", { count: "exact", head: true }).eq("user_id", userId);
    return error ? 0 : count || 0;
  } catch {
    return 0;
  }
}
