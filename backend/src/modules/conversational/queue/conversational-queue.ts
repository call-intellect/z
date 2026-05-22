/**
 * BullMQ-очередь outbound-доставок для ConversationalModule.
 *
 * Хранится в Redis. Воркер (`ConversationalSendWorker`) обрабатывает job'ы
 * последовательно с `concurrency = cfg.conversational.outboundConcurrency`.
 *
 * jobId = `delivery_<deliveryId>` — идемпотентность по
 * `NotificationDelivery.id`. Повторный enqueue для той же доставки в
 * пределах окна BullMQ-дедупа не создаёт дубль.
 */

export const CONVERSATIONAL_SEND_QUEUE = 'conversational.send';

export interface ConversationalSendJobData {
  deliveryId: string;
  /** На какой попытке. 0 = первая. Worker инкрементирует на retry. */
  attempt: number;
}
