/**
 * Whitelist валидных webhook-событий. Любое значение вне списка
 * → 400 при создании подписки и игнор при dispatch.
 */
export const WEBHOOK_EVENTS = [
  'meeting.completed',
  'meeting.regenerated',
  'meeting.deleted',
  'task.created',
  'task.updated',
  'task.deleted',
  'highlight.created',
  'highlight.rendered',
  'share.created',
  'share.viewed',
  'export.completed',
  'chat.completed',
  'card.created',
  'card.updated',
  'card.deleted',
  'meeting.linked_to_card',
  'meeting.unlinked_from_card',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function isValidEvent(name: string): name is WebhookEvent {
  return (WEBHOOK_EVENTS as readonly string[]).includes(name);
}
