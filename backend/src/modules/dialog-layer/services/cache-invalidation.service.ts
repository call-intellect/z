import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { AnswerCacheService } from './answer-cache.service';
import { RetrievalCacheService } from './retrieval-cache.service';

/**
 * SBA α-5 dialog-layer — CacheInvalidationService.
 *
 * Слушает событие `card-version.created` (эмитится из CardVersionsService
 * при `CardVersion.create`). При получении — flush'ит RetrievalCache И
 * AnswerCache по prefix `*:{tenantId}:*`.
 *
 * Дизайн — pessimistic: при любом изменении карточки в Org мы инвалидируем
 * ВЕСЬ tenant-кэш. На α-5 это OK — Org с десятками тысяч активных кэш-ключей
 * редкость; точечный invalidate (только запросы, которые видели изменённую
 * card) — vNext.
 *
 * Также вызывается из ChatV2Controller.clearCache (admin/owner endpoint
 * `POST /chat-v2/conversations/:id/clear-cache`).
 */

export interface CardVersionCreatedEvent {
  tenantId: string;
  cardVersionId: string;
  resourceType: string;
  resourceId: string;
}

@Injectable()
export class CacheInvalidationService {
  private readonly logger = new Logger(CacheInvalidationService.name);

  constructor(
    @Inject(AnswerCacheService) private readonly answerCache: AnswerCacheService,
    @Inject(RetrievalCacheService)
    private readonly retrievalCache: RetrievalCacheService,
  ) {}

  /**
   * Подписка на событие `card-version.created`. Hook вызывается
   * CardVersionsService после `CardVersion.create()`.
   */
  @OnEvent('card-version.created', { async: true })
  async onCardVersionCreated(event: CardVersionCreatedEvent): Promise<void> {
    await this.invalidateTenant(event.tenantId, 'card-version.created');
  }

  /**
   * Pessimistic flush обоих кэшей по tenantId. Возвращает число удалённых
   * ключей (для observability).
   */
  async invalidateTenant(
    tenantId: string,
    reason: string,
  ): Promise<{ answerDeleted: number; retrievalDeleted: number }> {
    const [answerDeleted, retrievalDeleted] = await Promise.all([
      this.answerCache.invalidateTenant(tenantId),
      this.retrievalCache.invalidateTenant(tenantId),
    ]);
    this.logger.log(
      { tenantId, reason, answerDeleted, retrievalDeleted },
      `CacheInvalidation: flush tenant=${tenantId}`,
    );
    return { answerDeleted, retrievalDeleted };
  }

  /**
   * Точечная инвалидация по userId (используется clear-cache endpoint'ом
   * чат-диалога — там админ/owner просит сбросить кэш конкретного юзера).
   */
  async invalidateUser(
    tenantId: string,
    userId: string,
  ): Promise<{ answerDeleted: number; retrievalDeleted: number }> {
    const [answerDeleted, retrievalDeleted] = await Promise.all([
      this.answerCache.invalidateUser(tenantId, userId),
      // RetrievalCache не разделён по userId — но всё равно лучше flush'нуть
      // по всему tenant'у (consistency между AnswerCache.userId и RetrievalCache).
      this.retrievalCache.invalidateTenant(tenantId),
    ]);
    this.logger.log(
      { tenantId, userId, answerDeleted, retrievalDeleted },
      'CacheInvalidation: flush user',
    );
    return { answerDeleted, retrievalDeleted };
  }
}
