import type { Quota } from "@codply/contracts";

export function quotaRemaining(quota: Quota): number {
  return Math.max(0, quota.daily_limit - quota.used_today);
}

/** Daily quotas reset at UTC midnight (Redis key `quota:{user}:{YYYYMMDD}`). */
export function msUntilQuotaReset(now: Date = new Date()): number {
  const reset = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return reset - now.getTime();
}

/** "4h 12m" / "12m" / "<1m" until the UTC-midnight quota reset. */
export function formatQuotaResetCountdown(now: Date = new Date()): string {
  const totalMinutes = Math.floor(msUntilQuotaReset(now) / 60_000);
  if (totalMinutes < 1) return "<1m";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}
