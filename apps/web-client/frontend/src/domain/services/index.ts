"use client";

import { getBrowserGateway } from "../gateway";
import { AccountService } from "./AccountService";
import { AuthService } from "./AuthService";
import { GameService } from "./GameService";
import { JobService } from "./JobService";
import { SearchService } from "./SearchService";
import { SocialService } from "./SocialService";

export { AccountService } from "./AccountService";
export { AuthService } from "./AuthService";
export { GameService } from "./GameService";
export { JobService } from "./JobService";
export { SearchService } from "./SearchService";
export { SocialService } from "./SocialService";

interface Services {
  account: AccountService;
  auth: AuthService;
  games: GameService;
  jobs: JobService;
  search: SearchService;
  social: SocialService;
}

let services: Services | null = null;

/** Browser-side service singletons (constructed over the BFF gateway). */
export function getServices(): Services {
  if (services === null) {
    const gateway = getBrowserGateway();
    services = {
      account: new AccountService(gateway),
      auth: new AuthService(gateway),
      games: new GameService(gateway),
      jobs: new JobService(gateway),
      search: new SearchService(gateway),
      social: new SocialService(gateway),
    };
  }
  return services;
}
