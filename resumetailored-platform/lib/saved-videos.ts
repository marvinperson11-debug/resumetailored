/**
 * Saved Resume Videos — the rules, kept pure and backend-agnostic so they can be tested with an in-memory
 * backend. Every rendered video is stored (MP4 + the script as a .txt) and listed next to "Resumes built".
 *
 *  - Owner-only: every read/delete goes through the owner id, and the rows/paths that come back are checked
 *    again here, so a backend that ever returned someone else's row still could not leak it.
 *  - Retention: the most recent MAX_SAVED_VIDEOS per user; saving one more evicts the oldest (files + row).
 *  - Never overwrites: every render is inserted as a NEW row with a fresh id. Editing a saved video only
 *    pre-fills the creator; the original is only ever removed by an explicit delete or by the cap.
 */
import { cleanVideoSettings, MAX_OPENER_CHARS, MAX_CLOSER_CHARS, type VideoSettings } from "./video-settings";
import { VIDEO_TEMPLATES, scriptToDownloadText } from "./video-ai";

export const SAVED_VIDEOS_BUCKET = "resume-videos";
/**
 * 10 most recent per user. An MP4 here is a few MB (a ~35 s, 1080×1920 clip), so 10 keeps a user well under
 * ~100 MB of private storage while still covering "a version per recipient" for a typical job search; the
 * oldest is dropped (with its script file) when an 11th is saved, and users can delete any earlier.
 */
export const MAX_SAVED_VIDEOS = 10;
export const MAX_SAVED_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_SCRIPT_CHARS = 2500; // matches the voiceover route
export const MAX_RESUME_CHARS = 20_000;
export const MAX_TO_WHOM_CHARS = 80;

export type ScriptSource = "ai" | "written";

/** The metadata the creator needs to rebuild a video's setup exactly (everything but the files). */
export interface SavedVideoMeta {
  title: string;
  script: string;
  scriptSource: ScriptSource;
  /** An AI script the user changed by hand before rendering. */
  scriptEdited: boolean;
  toWhom: string;
  opener: string;
  closer: string;
  template: string;
  resumeText: string;
  /** voice, backgroundColor, headshot (+ position), everySlide. The user's saved opener/closer lists are never stored here. */
  settings: VideoSettings;
}

export interface SavedVideoRow extends SavedVideoMeta {
  id: string;
  userId: string;
  videoPath: string;
  scriptPath: string;
  sizeBytes: number;
  createdAt: string;
}

/** What GET /api/resume-video/saved/[id] returns — a saved video's setup, used to pre-fill the creator. */
export interface SavedVideoDetail extends SavedVideoMeta {
  id: string;
  createdAt: string;
}

/** What a storage + database backend must provide. Every call is scoped by the owner id. */
export interface VideoBackend {
  insertRow(row: SavedVideoRow): Promise<boolean>;
  /** Newest first. */
  listRows(userId: string): Promise<SavedVideoRow[]>;
  getRow(userId: string, id: string): Promise<SavedVideoRow | null>;
  deleteRow(userId: string, id: string): Promise<boolean>;
  putFile(path: string, bytes: Uint8Array, contentType: string): Promise<boolean>;
  removeFiles(paths: string[]): Promise<void>;
  getFile(path: string): Promise<Uint8Array | null>;
  /** A short-lived URL to stream or download a stored file; `downloadAs` makes the browser save it under that name. */
  signedUrl(path: string, expiresInSeconds: number, downloadAs?: string): Promise<string | null>;
}

const clip = (v: unknown, max: number) =>
  // eslint-disable-next-line no-control-regex
  (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim() : "").slice(0, max);

/** Validate whatever the browser sent into a SavedVideoMeta. Never trusts a field as sent. */
export function cleanSavedMeta(raw: unknown): SavedVideoMeta | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const script = clip(r.script, MAX_SCRIPT_CHARS);
  if (script.length < 10) return null;
  const source: ScriptSource = r.scriptSource === "written" ? "written" : "ai";
  const toWhom = clip(r.toWhom, MAX_TO_WHOM_CHARS);
  const template = VIDEO_TEMPLATES.some((t) => t.id === r.template) ? (r.template as string) : VIDEO_TEMPLATES[0].id;
  // The video's own look only: the user's reusable opener/closer lists belong to their account settings.
  const settings = { ...cleanVideoSettings(r.settings), customOpeners: [], customClosers: [] };
  return {
    title: toWhom ? `Resume video for ${toWhom}` : "Resume video",
    script,
    scriptSource: source,
    scriptEdited: source === "ai" && r.scriptEdited === true,
    toWhom,
    opener: clip(r.opener, MAX_OPENER_CHARS),
    closer: clip(r.closer, MAX_CLOSER_CHARS),
    template,
    resumeText: clip(r.resumeText, MAX_RESUME_CHARS),
    settings,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isVideoId = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

export const videoPathFor = (userId: string, id: string) => `${userId}/${id}.mp4`;
export const scriptPathFor = (userId: string, id: string) => `${userId}/${id}.txt`;

/** True only for a row that belongs to `userId`, with both files inside that user's own folder. */
function owns(userId: string, r: SavedVideoRow | null): r is SavedVideoRow {
  return !!r && !!userId && r.userId === userId && r.videoPath.startsWith(`${userId}/`) && r.scriptPath.startsWith(`${userId}/`);
}

/** Rows to remove so that at most `cap` remain: everything after the newest `cap` (rows are newest first). */
export function videosToEvict<T extends { createdAt: string }>(rowsNewestFirst: T[], cap = MAX_SAVED_VIDEOS): T[] {
  const sorted = [...rowsNewestFirst].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return sorted.slice(cap);
}

/** The slug used in download file names: "resume-video-for-sarah-johnson". */
export function downloadBaseName(meta: Pick<SavedVideoMeta, "toWhom">): string {
  const slug = meta.toWhom.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return slug ? `resume-video-for-${slug}` : "resume-video";
}

/**
 * Store a finished render as a NEW saved video. Files go in first; the row is inserted last, and if that
 * fails the files are removed again — so there is never a row without its files or files without a row.
 * Then the oldest videos beyond the cap are evicted. Returns null on any storage failure (the caller still
 * has the rendered video; saving is best-effort and never blocks it).
 */
export async function saveVideo(
  be: VideoBackend,
  userId: string,
  meta: SavedVideoMeta,
  mp4: Uint8Array,
  opts: { id?: string; now?: () => Date } = {}
): Promise<SavedVideoRow | null> {
  if (!userId || !mp4.length || mp4.length > MAX_SAVED_VIDEO_BYTES) return null;
  const id = opts.id || crypto.randomUUID();
  const row: SavedVideoRow = {
    ...meta,
    id,
    userId,
    videoPath: videoPathFor(userId, id),
    scriptPath: scriptPathFor(userId, id),
    sizeBytes: mp4.length,
    createdAt: (opts.now ? opts.now() : new Date()).toISOString(),
  };
  const txt = new TextEncoder().encode(scriptToDownloadText(meta.script));
  if (!(await be.putFile(row.videoPath, mp4, "video/mp4"))) return null;
  if (!(await be.putFile(row.scriptPath, txt, "text/plain; charset=utf-8"))) {
    await be.removeFiles([row.videoPath]);
    return null;
  }
  if (!(await be.insertRow(row))) {
    await be.removeFiles([row.videoPath, row.scriptPath]);
    return null;
  }
  // Retention: keep the newest MAX_SAVED_VIDEOS, drop the rest (files first, then the row).
  const all = (await be.listRows(userId)).filter((r) => owns(userId, r));
  for (const old of videosToEvict(all)) {
    await be.removeFiles([old.videoPath, old.scriptPath]);
    await be.deleteRow(userId, old.id);
  }
  return row;
}

export async function listSavedVideos(be: VideoBackend, userId: string): Promise<SavedVideoRow[]> {
  if (!userId) return [];
  return (await be.listRows(userId)).filter((r) => owns(userId, r)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** One saved video, only if it is the caller's. Anyone else's id reads exactly like a missing one. */
export async function getSavedVideo(be: VideoBackend, userId: string, id: string): Promise<SavedVideoRow | null> {
  if (!userId || !isVideoId(id)) return null;
  const row = await be.getRow(userId, id);
  return owns(userId, row) && row.id === id ? row : null;
}

/** Delete a saved video: the stored files, then the row. False when it isn't the caller's. */
export async function deleteSavedVideo(be: VideoBackend, userId: string, id: string): Promise<boolean> {
  const row = await getSavedVideo(be, userId, id);
  if (!row) return false;
  await be.removeFiles([row.videoPath, row.scriptPath]);
  return be.deleteRow(userId, id);
}

/** The video URL for playback (long enough to watch) or download (short, saved under a friendly name). */
export async function videoUrlFor(be: VideoBackend, userId: string, id: string, download: boolean): Promise<string | null> {
  const row = await getSavedVideo(be, userId, id);
  if (!row) return null;
  return download ? be.signedUrl(row.videoPath, 120, `${downloadBaseName(row)}.mp4`) : be.signedUrl(row.videoPath, 3600);
}

/** The script .txt bytes, only for the owner. */
export async function scriptFileFor(be: VideoBackend, userId: string, id: string): Promise<{ bytes: Uint8Array; filename: string } | null> {
  const row = await getSavedVideo(be, userId, id);
  if (!row) return null;
  const bytes = await be.getFile(row.scriptPath);
  return bytes ? { bytes, filename: `${downloadBaseName(row)}-script.txt` } : null;
}
