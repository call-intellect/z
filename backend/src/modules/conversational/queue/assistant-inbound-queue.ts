import type { InboundMessage } from '../types/channel.types';

/** Очередь раннего ACK: тяжёлая обработка inbound уходит в фон (Ф1). */
export const ASSISTANT_INBOUND_QUEUE = 'assistant.inbound';

/** Параллелизм воркера: concierge.process тяжёлый (LLM tool-loop) — держим небольшим. */
export const ASSISTANT_INBOUND_CONCURRENCY = 4;

export interface AssistantInboundJobData {
  /** Готовый нормализованный inbound (из adapter.ingestUpdate) — воркер зовёт dispatchInbound(inbound). */
  inbound: InboundMessage;
}
