import type {
  Comment,
  CommentHistoryResponse,
  CommentsParams,
  FeedItem,
  GameOwner,
  Notification,
  PageParams,
  PaginatedResponse,
  Profile,
  SuggestedCreator,
  UnreadCount,
} from "@codply/contracts";
import type { ApiGateway } from "../gateway";

/** E16 social surface: engagement, comments, follows, profiles, notifications. */
export class SocialService {
  constructor(private readonly gateway: ApiGateway) {}

  like(gameId: string): Promise<void> {
    return this.gateway.client.like(gameId);
  }

  unlike(gameId: string): Promise<void> {
    return this.gateway.client.unlike(gameId);
  }

  save(gameId: string): Promise<void> {
    return this.gateway.client.saveGame(gameId);
  }

  unsave(gameId: string): Promise<void> {
    return this.gateway.client.unsaveGame(gameId);
  }

  /** Anonymous share ping (fire-and-forget; server dedupes per session). */
  share(gameId: string, sessionHash: string): Promise<void> {
    return this.gateway.client.share(gameId, { session_hash: sessionHash });
  }

  comments(gameId: string, params?: CommentsParams): Promise<PaginatedResponse<Comment>> {
    return this.gateway.client.comments(gameId, params);
  }

  createComment(gameId: string, body: string, parentCommentId?: string): Promise<Comment> {
    return this.gateway.client.createComment(gameId, {
      body,
      ...(parentCommentId ? { parent_comment_id: parentCommentId } : {}),
    });
  }

  deleteComment(commentId: string): Promise<void> {
    return this.gateway.client.deleteComment(commentId);
  }

  /** Edit your own comment (E39) — records the prior body + stamps edited_at. */
  editComment(commentId: string, body: string): Promise<Comment> {
    return this.gateway.client.editComment(commentId, { body });
  }

  /** Toggle a like on a comment (E39; idempotent 204s). */
  likeComment(commentId: string): Promise<void> {
    return this.gateway.client.likeComment(commentId);
  }

  unlikeComment(commentId: string): Promise<void> {
    return this.gateway.client.unlikeComment(commentId);
  }

  /** A comment's prior bodies, newest first (E39). */
  commentHistory(commentId: string): Promise<CommentHistoryResponse> {
    return this.gateway.client.commentHistory(commentId);
  }

  /** Who to follow (E21). */
  suggestedCreators(limit = 5): Promise<SuggestedCreator[]> {
    return this.gateway.client.suggestedCreators(limit);
  }

  follow(handle: string): Promise<void> {
    return this.gateway.client.follow(handle);
  }

  unfollow(handle: string): Promise<void> {
    return this.gateway.client.unfollow(handle);
  }

  profile(handle: string): Promise<Profile> {
    return this.gateway.client.profile(handle);
  }

  profileGames(handle: string, params?: PageParams): Promise<PaginatedResponse<FeedItem>> {
    return this.gateway.client.profileGames(handle, params);
  }

  followers(handle: string, params?: PageParams): Promise<PaginatedResponse<GameOwner>> {
    return this.gateway.client.followers(handle, params);
  }

  following(handle: string, params?: PageParams): Promise<PaginatedResponse<GameOwner>> {
    return this.gateway.client.following(handle, params);
  }

  notifications(params?: PageParams): Promise<PaginatedResponse<Notification>> {
    return this.gateway.client.notifications(params);
  }

  unreadCount(): Promise<UnreadCount> {
    return this.gateway.client.unreadCount();
  }

  markNotificationsRead(): Promise<void> {
    return this.gateway.client.markNotificationsRead();
  }

  mySaves(params?: PageParams): Promise<PaginatedResponse<FeedItem>> {
    return this.gateway.client.mySaves(params);
  }

  /** Games I liked (E36). */
  myLikes(params?: PageParams): Promise<PaginatedResponse<FeedItem>> {
    return this.gateway.client.myLikes(params);
  }

  /** Games I played, newest first (E36). */
  myHistory(params?: PageParams): Promise<PaginatedResponse<FeedItem>> {
    return this.gateway.client.myHistory(params);
  }
}
