/**
 * SBA β-5 — Layer 6 (Probe-Agent) — общие типы.
 */

import type { DataClass } from '@prisma/client';

/**
 * Payload probe-события — что хочет передать специалист. Семантически
 * близок к `SpecialistProbePayloadSchema` (event-payload.registry.ts), но
 * расширен полями context*.
 */
export interface ProbeSuggestPayload {
  /** Готовое сообщение от специалиста (контекст того, что нашли). */
  message?: string;
  /** Подсказки действий (UI рендерит как кнопки). */
  suggestedActions?: readonly string[];
  /** Контекстный IdeaBlock (для citations). */
  contextBlockId?: string;
  /** Контекстная карточка (Idea/Decision/Insight/Regulation/...). */
  contextCardId?: string;
  /** Тип контекстной карточки. */
  contextCardKind?: string;
  /** Title контекстной карточки (для probe-formulate). */
  contextCardTitle?: string;
  /** Готовый вопрос (fallback, если LLM probe-formulate упал). */
  suggestedQuestion?: string;
  // 2026-05-30 (Agents v2 Фаза 0.2): suggestedOptions удалены — probe без кнопок.
  // Ответ всегда свободным текстом или голосом. suggestedActions выше остаются
  // как семантический контекст для LLM probe-formulate (не показываются пользователю).
  /** dataClass — для маршрутизации каналов. */
  dataClass?: DataClass;
  /** actionUrl для UI. */
  actionUrl?: string;
  /** Дополнительные id для contentHash (помимо contextBlockId / contextCardId). */
  contextIds?: readonly string[];
  /** Произвольные ключи payload'а — попадут в Notification.payload без валидации. */
  [key: string]: unknown;
}

/**
 * Input для `ProbeService.suggest`. Главный контракт для специалистов Слоя 3.
 */
export interface ProbeSuggestInput {
  tenantId: string;
  /** Имя специалиста-эмиттера (например, '3-1-regulations'). */
  emittedByService: string;
  /** Машинно-читаемый reason ('regulation.missing_owner', ...). */
  reason: string;
  payload: ProbeSuggestPayload;
  /** Кандидаты-получатели (userId). ProbeDispatcher выберет одного. */
  recipientCandidates: readonly string[];
  /**
   * Hint для priority (0..1; severity_weight в формуле §6). Default 0.4
   * (medium). 'critical' → 1.0, 'high' → 0.7, 'low' → 0.2.
   */
  priorityHint?: number;
  /** Опц. dataClass для маршрутизации (default 'internal'). */
  dataClass?: DataClass;
}

/**
 * Результат `ProbeService.suggest`.
 *  - На успех — created ProbeEvent.
 *  - На дедуп / rate-limit / cold-start / гейт ценности — { dropped, ... }.
 *
 * W2 autonomy (2026-06-12): `low_value` — priority ниже крутилки
 * `probe.minValuePriority` (audit-запись status='dropped_low_value').
 * NUDGE-reason (`routed_to_digest`) возвращает `{ ok: true }` — probe создан
 * и будет доставлен дайджестом.
 */
export type ProbeSuggestResult =
  | { ok: true; probeEventId: string }
  | { dropped: 'dedup' | 'rate_limit' | 'cold_start' | 'low_value' };

export interface NotificationRespondedPayload {
  tenantId: string;
  notificationId: string;
  recipientUserId: string;
  eventType: string;
  payload: Record<string, unknown>;
  contextBlockId: string | null;
  contextCardId: string | null;
}
