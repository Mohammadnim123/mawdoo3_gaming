"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type {
  Comment,
  CommentHistoryResponse,
  PaginatedResponse,
} from "@codply/contracts";
import { getServices } from "@/domain/services";
import { patchGameCaches } from "./useSocial";

/** Top-level comments (newest first) live under `["comments", gameId]`. */
export const commentsKey = (gameId: string) => ["comments", gameId] as const;
/** A comment's replies (oldest first) — a DISTINCT infinite cache per parent. */
export const commentRepliesKey = (gameId: string, parentId: string) =>
  ["comments", gameId, "replies", parentId] as const;
/** A comment's prior-bodies history — fetched lazily by the history dialog. */
export const commentHistoryKey = (commentId: string) =>
  ["comment-history", commentId] as const;

const PAGE_SIZE = 20;

/** The `useInfiniteQuery` cache shape for a paginated comment list. */
type InfiniteComments = {
  pages: PaginatedResponse<Comment>[];
  pageParams: unknown[];
};

// ── cache surgery (shared by every comment mutation — the DEDUPE lives here) ──

/**
 * Patch one comment wherever it is cached for this game — the top-level list
 * AND every replies sub-list share the `["comments", gameId, …]` prefix, so a
 * single predicate reaches both. Used by like / edit / delete.
 */
function patchCommentInCaches(
  queryClient: QueryClient,
  gameId: string,
  commentId: string,
  update: (comment: Comment) => Comment,
): void {
  queryClient.setQueriesData<InfiniteComments>(
    {
      predicate: (query) =>
        query.queryKey[0] === "comments" && query.queryKey[1] === gameId,
    },
    (data) =>
      data?.pages
        ? {
            ...data,
            pages: data.pages.map((page) => ({
              ...page,
              items: page.items.map((c) => (c.id === commentId ? update(c) : c)),
            })),
          }
        : data,
  );
}

/**
 * Insert a freshly-created comment into its list, DEDUPED by server id so an
 * optimistic insert can never render twice (the double-render bug). Top-level
 * comments prepend (newest first); replies append (oldest first).
 */
function insertComment(
  queryClient: QueryClient,
  key: readonly unknown[],
  comment: Comment,
  position: "prepend" | "append",
): void {
  queryClient.setQueryData<InfiniteComments>(key, (data) => {
    // No page cached yet (list never opened): seed one so the author sees
    // their comment immediately; a later fetch REPLACES this with server truth
    // (which already contains the row exactly once — never a duplicate).
    if (!data || data.pages.length === 0) {
      return { pages: [{ items: [comment], next_cursor: null }], pageParams: [undefined] };
    }
    // Already present (a refetch beat us to it) → leave the cache untouched.
    if (data.pages.some((page) => page.items.some((c) => c.id === comment.id))) {
      return data;
    }
    const targetIndex = position === "prepend" ? 0 : data.pages.length - 1;
    return {
      ...data,
      pages: data.pages.map((page, index) =>
        index === targetIndex
          ? {
              ...page,
              items:
                position === "prepend"
                  ? [comment, ...page.items]
                  : [...page.items, comment],
            }
          : page,
      ),
    };
  });
}

// ── queries ──────────────────────────────────────────────────────────────

/** Top-level comments for a game (cursor pagination — Load more). */
export function useComments(
  gameId: string,
  opts?: { enabled?: boolean },
): UseInfiniteQueryResult<InfiniteComments, Error> {
  return useInfiniteQuery({
    queryKey: commentsKey(gameId),
    queryFn: ({ pageParam }) =>
      getServices().social.comments(gameId, { cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: opts?.enabled ?? true,
  });
}

/** A comment's replies — lazy: only fetched once `enabled` (the toggle opens). */
export function useCommentReplies(
  gameId: string,
  parentId: string,
  enabled: boolean,
): UseInfiniteQueryResult<InfiniteComments, Error> {
  return useInfiniteQuery({
    queryKey: commentRepliesKey(gameId, parentId),
    queryFn: ({ pageParam }) =>
      getServices().social.comments(gameId, {
        parent: parentId,
        cursor: pageParam,
        limit: PAGE_SIZE,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled,
  });
}

/** A comment's edit history — fetched only while the history dialog is open. */
export function useCommentHistory(
  commentId: string,
  enabled: boolean,
): UseQueryResult<CommentHistoryResponse, Error> {
  return useQuery({
    queryKey: commentHistoryKey(commentId),
    queryFn: () => getServices().social.commentHistory(commentId),
    enabled,
  });
}

// ── mutations ────────────────────────────────────────────────────────────

interface CreateCommentVars {
  body: string;
  /** Set → this is a reply attached to that top-level comment. */
  parentId?: string;
}

/**
 * Create a comment or reply. The cache update is DEDUPED and does NOT refetch
 * the list, so a new row renders exactly once (fixes the double-render bug):
 *  - top-level → prepend to the list, bump the game's comment_count;
 *  - reply     → append to the parent's replies list + bump its reply_count.
 */
export function useCreateComment(
  gameId: string,
): UseMutationResult<Comment, Error, CreateCommentVars> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ body, parentId }: CreateCommentVars) =>
      getServices().social.createComment(gameId, body, parentId),
    onSuccess: (comment, { parentId }) => {
      if (parentId) {
        insertComment(queryClient, commentRepliesKey(gameId, parentId), comment, "append");
        patchCommentInCaches(queryClient, gameId, parentId, (c) => ({
          ...c,
          reply_count: c.reply_count + 1,
        }));
      } else {
        insertComment(queryClient, commentsKey(gameId), comment, "prepend");
      }
      patchGameCaches(queryClient, gameId, { commentDelta: 1 });
    },
  });
}

interface EditCommentVars {
  commentId: string;
  body: string;
}

/** Edit a comment — patches the body + edited_at in place (no refetch). */
export function useEditComment(
  gameId: string,
): UseMutationResult<Comment, Error, EditCommentVars> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ commentId, body }: EditCommentVars) =>
      getServices().social.editComment(commentId, body),
    onSuccess: (updated) => {
      patchCommentInCaches(queryClient, gameId, updated.id, (c) => ({
        ...c,
        body: updated.body,
        edited_at: updated.edited_at,
      }));
    },
  });
}

/**
 * Delete a comment — turns the row into a tombstone (deleted + empty body) so
 * the thread keeps its shape and any replies stay visible; no refetch.
 */
export function useDeleteComment(
  gameId: string,
): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) => getServices().social.deleteComment(commentId),
    onSuccess: (_void, commentId) => {
      patchCommentInCaches(queryClient, gameId, commentId, (c) => ({
        ...c,
        deleted: true,
        body: "",
      }));
      patchGameCaches(queryClient, gameId, { commentDelta: -1 });
    },
  });
}

interface ToggleLikeVars {
  commentId: string;
  /** The desired next state — `true` = like, `false` = unlike. */
  next: boolean;
}

/** Optimistic comment-like toggle (rolls back the count + state on error). */
export function useToggleCommentLike(
  gameId: string,
): UseMutationResult<void, Error, ToggleLikeVars> {
  const queryClient = useQueryClient();
  const applied = (next: boolean) => (c: Comment) => ({
    ...c,
    viewer_liked: next,
    like_count: Math.max(0, c.like_count + (next ? 1 : -1)),
  });
  return useMutation({
    mutationFn: ({ commentId, next }: ToggleLikeVars) =>
      next
        ? getServices().social.likeComment(commentId)
        : getServices().social.unlikeComment(commentId),
    onMutate: ({ commentId, next }) => {
      patchCommentInCaches(queryClient, gameId, commentId, applied(next));
    },
    onError: (_error, { commentId, next }) => {
      // Reverse the optimistic patch.
      patchCommentInCaches(queryClient, gameId, commentId, applied(!next));
    },
  });
}
