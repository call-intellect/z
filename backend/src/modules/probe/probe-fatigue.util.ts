export const PROBE_LOW_ENGAGEMENT_THRESHOLD = 0.2;

export const PROBE_LOW_ENGAGEMENT_BUDGET_FACTOR = 0.5;

export const PROBE_ENGAGEMENT_TTL_SEC = 7 * 24 * 3600;

export function probeEngagementRedisKey(userId: string): string {
  return `probe:engagement:${userId}`;
}

export function probeTopicCooldownRedisKey(tenantId: string, contentHash: string): string {
  return `probe:cooldown:${tenantId}:${contentHash}`;
}
