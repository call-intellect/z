export const CHANNEL_CLARIFY_TTL_SECONDS = 600;

export function channelClarifyKey(channelBindingId: string): string {
  return `concierge:clarify:${channelBindingId}`;
}
