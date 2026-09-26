/**
 * Team Feed — shared types and pure helpers (no DB, no network). Mirrors the
 * `cert-hub.ts` / `employee-hub.ts` convention.
 */

export type FeedAuthorKind = "employer" | "employee";
export const isFeedAuthorKind = (v: unknown): v is FeedAuthorKind => v === "employer" || v === "employee";

export type FeedPostKind = "post" | "issue" | "win";
export const isFeedPostKind = (v: unknown): v is FeedPostKind => v === "post" || v === "issue" || v === "win";

export interface FeedPost {
  id: number;
  authorKind: FeedAuthorKind;
  authorId: string;
  authorName: string;
  kind: FeedPostKind;
  body: string;
  pinned: boolean;
  resolved: boolean;
  createdAt: string;
  commentCount: number;
}

export interface FeedComment {
  id: number;
  postId: number;
  authorKind: FeedAuthorKind;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export const MAX_FEED_BODY = 4000;
export const MAX_COMMENT_BODY = 2000;

export function normalizeFeedBody(body: unknown, max: number = MAX_FEED_BODY): string | null {
  const s = typeof body === "string" ? body.trim() : "";
  if (!s) return null;
  return s.slice(0, max);
}

/** Only the employer, or the post's own author, may resolve/unresolve it — the
 *  same "employer or original poster" rule the spec calls for. */
export function canResolveFeedPost(
  post: Pick<FeedPost, "authorKind" | "authorId">,
  viewer: { kind: FeedAuthorKind; id: string }
): boolean {
  if (viewer.kind === "employer") return true;
  return post.authorKind === viewer.kind && post.authorId === viewer.id;
}

export const FEED_KIND_LABELS: Record<FeedPostKind, string> = {
  post: "Post",
  issue: "Issue",
  win: "Win",
};
