import type {
  CheckoutResponse,
  ClaimDailyResponse,
  CreatorOverview,
  CreditsResponse,
  Me,
  PageParams,
  PayoutsResponse,
  SubscriptionInterval,
  SubscriptionResponse,
} from "@codply/contracts";
import type { ApiGateway } from "../gateway";

/** E29 credits + subscription surface behind one domain service. */
export class AccountService {
  constructor(private readonly gateway: ApiGateway) {}

  /** Upload a new avatar image (E36) — responds with the refreshed Me. */
  uploadAvatar(data_base64: string): Promise<Me> {
    return this.gateway.client.uploadAvatar({ data_base64 });
  }

  /** Lifetime creator stats + earnings + program standing (E36). */
  creatorOverview(): Promise<CreatorOverview> {
    return this.gateway.client.creatorOverview();
  }

  /** Payout balance, gating and request history (E36) — history pages by cursor. */
  creatorPayouts(cursor?: string): Promise<PayoutsResponse> {
    return this.gateway.client.creatorPayouts({ cursor });
  }

  /** Request a payout — 400 below minimum, 409 when one is already pending. */
  requestPayout(idempotencyKey?: string): Promise<PayoutsResponse> {
    return this.gateway.client.requestPayout({ idempotencyKey });
  }

  /** Balance + the newest-first ledger page (`GET /me/credits`). */
  credits(params?: PageParams): Promise<CreditsResponse> {
    return this.gateway.client.myCredits(params);
  }

  /** The free plan's daily grant — 409 `conflict` (details.next_claim_at)
   * when already claimed today; 400 for plans without a daily claim. */
  claimDaily(): Promise<ClaimDailyResponse> {
    return this.gateway.client.claimDailyCredits();
  }

  /** Current plan card + period credit stats (`GET /me/subscription`). */
  subscription(): Promise<SubscriptionResponse> {
    return this.gateway.client.mySubscription();
  }

  /** Start a plan checkout. In dev the fake provider activates instantly and
   * the returned url points back at `/account/billing?checkout=success…`. */
  checkout(plan: string, interval: SubscriptionInterval): Promise<CheckoutResponse> {
    return this.gateway.client.subscriptionCheckout({ plan, interval });
  }
}
