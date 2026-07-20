import type { FeedItem } from "@codply/contracts";
import type { ApiGateway } from "../gateway";

/**
 * Game search behind one domain service (keeps screens free of raw client
 * calls). It is a thin wrapper over the feed's trigram title search
 * (`GET /games?q=`, CONVENTIONS §3 v0.7) — the same endpoint the discovery
 * feed already uses, just with the query term and a small page.
 */
export class SearchService {
  constructor(private readonly gateway: ApiGateway) {}

  /** Games whose title matches `q` (trigram), most-relevant first. */
  async searchGames(q: string, limit = 6): Promise<FeedItem[]> {
    const page = await this.gateway.client.feed({ q, limit });
    return page.items;
  }
}
