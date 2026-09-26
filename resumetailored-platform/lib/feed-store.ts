import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isFeedAuthorKind, isFeedPostKind, type FeedPost, type FeedComment, type FeedAuthorKind, type FeedPostKind } from "./feed-hub";

/**
 * Team Feed persistence — employer_id-scoped, service-role, best-effort (same
 * contract as the other employer stores, e.g. cert-store.ts).
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

const POST_COLS = "id, author_kind, author_id, author_name, kind, body, pinned, resolved, created_at";
const COMMENT_COLS = "id, post_id, author_kind, author_id, author_name, body, created_at";

function mapPost(r: Record<string, unknown>, commentCount: number): FeedPost {
  return {
    id: r.id as number,
    authorKind: (isFeedAuthorKind(r.author_kind) ? r.author_kind : "employer") as FeedAuthorKind,
    authorId: (r.author_id as string) || "",
    authorName: (r.author_name as string) || "",
    kind: (isFeedPostKind(r.kind) ? r.kind : "post") as FeedPostKind,
    body: (r.body as string) || "",
    pinned: !!r.pinned,
    resolved: !!r.resolved,
    createdAt: (r.created_at as string) || "",
    commentCount,
  };
}

function mapComment(r: Record<string, unknown>): FeedComment {
  return {
    id: r.id as number,
    postId: r.post_id as number,
    authorKind: (isFeedAuthorKind(r.author_kind) ? r.author_kind : "employer") as FeedAuthorKind,
    authorId: (r.author_id as string) || "",
    authorName: (r.author_name as string) || "",
    body: (r.body as string) || "",
    createdAt: (r.created_at as string) || "",
  };
}

export interface FeedPostInput {
  authorKind: FeedAuthorKind;
  authorId: string;
  authorName: string;
  kind: FeedPostKind;
  body: string;
}

/** Pinned first, then newest first. Comment counts are fetched in one extra
 *  query (not a PostgREST embed) and joined in JS. */
export async function listFeedPosts(employerId: string, limit = 100): Promise<FeedPost[]> {
  const c = db();
  if (!c || !employerId) return [];
  try {
    const { data } = await c
      .from("feed_posts")
      .select(POST_COLS)
      .eq("employer_id", employerId)
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);
    const posts = data || [];
    if (!posts.length) return [];
    const ids = posts.map((p) => p.id as number);
    const { data: comments } = await c.from("feed_comments").select("post_id").eq("employer_id", employerId).in("post_id", ids);
    const counts = new Map<number, number>();
    for (const row of comments || []) {
      const id = row.post_id as number;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    return posts.map((p) => mapPost(p, counts.get(p.id as number) || 0));
  } catch {
    return [];
  }
}

export async function getFeedPost(employerId: string, id: number): Promise<FeedPost | null> {
  const c = db();
  if (!c || !employerId || !id) return null;
  try {
    const { data } = await c.from("feed_posts").select(POST_COLS).eq("employer_id", employerId).eq("id", id).maybeSingle();
    if (!data) return null;
    const { count } = await c
      .from("feed_comments")
      .select("id", { count: "exact", head: true })
      .eq("employer_id", employerId)
      .eq("post_id", id);
    return mapPost(data, count || 0);
  } catch {
    return null;
  }
}

export async function createFeedPost(employerId: string, input: FeedPostInput): Promise<FeedPost | null> {
  const c = db();
  if (!c || !employerId) return null;
  try {
    const { data, error } = await c
      .from("feed_posts")
      .insert({
        employer_id: employerId,
        author_kind: input.authorKind,
        author_id: input.authorId,
        author_name: input.authorName.slice(0, 200),
        kind: input.kind,
        body: input.body,
        // Employer posts land as pinned=false by default; pinning is a
        // separate, explicit employer-only action (PATCH).
      })
      .select(POST_COLS)
      .single();
    if (error || !data) {
      console.error("[createFeedPost]", error);
      return null;
    }
    return mapPost(data, 0);
  } catch (e) {
    console.error("[createFeedPost]", e);
    return null;
  }
}

export async function setFeedPostPinned(employerId: string, id: number, pinned: boolean): Promise<boolean> {
  const c = db();
  if (!c || !employerId || !id) return false;
  try {
    const { error } = await c.from("feed_posts").update({ pinned }).eq("employer_id", employerId).eq("id", id);
    return !error;
  } catch {
    return false;
  }
}

export async function setFeedPostResolved(employerId: string, id: number, resolved: boolean): Promise<boolean> {
  const c = db();
  if (!c || !employerId || !id) return false;
  try {
    const { error } = await c.from("feed_posts").update({ resolved }).eq("employer_id", employerId).eq("id", id);
    return !error;
  } catch {
    return false;
  }
}

export async function listFeedComments(employerId: string, postId: number): Promise<FeedComment[]> {
  const c = db();
  if (!c || !employerId || !postId) return [];
  try {
    const { data } = await c
      .from("feed_comments")
      .select(COMMENT_COLS)
      .eq("employer_id", employerId)
      .eq("post_id", postId)
      .order("created_at", { ascending: true });
    return (data || []).map(mapComment);
  } catch {
    return [];
  }
}

export interface FeedCommentInput {
  authorKind: FeedAuthorKind;
  authorId: string;
  authorName: string;
  body: string;
}

export async function createFeedComment(employerId: string, postId: number, input: FeedCommentInput): Promise<FeedComment | null> {
  const c = db();
  if (!c || !employerId || !postId) return null;
  try {
    const { data, error } = await c
      .from("feed_comments")
      .insert({
        employer_id: employerId,
        post_id: postId,
        author_kind: input.authorKind,
        author_id: input.authorId,
        author_name: input.authorName.slice(0, 200),
        body: input.body,
      })
      .select(COMMENT_COLS)
      .single();
    if (error || !data) {
      console.error("[createFeedComment]", error);
      return null;
    }
    return mapComment(data);
  } catch (e) {
    console.error("[createFeedComment]", e);
    return null;
  }
}
