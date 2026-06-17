import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { AnswerCacheService } from './answer-cache.service';
import { RetrievalCacheService } from './retrieval-cache.service';

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

  @OnEvent('card-version.created', { async: true })
  async onCardVersionCreated(event: CardVersionCreatedEvent): Promise<void> {
    await this.invalidateTenant(event.tenantId, 'card-version.created');
  }

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

  async invalidateUser(
    tenantId: string,
    userId: string,
  ): Promise<{ answerDeleted: number; retrievalDeleted: number }> {
    const [answerDeleted, retrievalDeleted] = await Promise.all([
      this.answerCache.invalidateUser(tenantId, userId),
      this.retrievalCache.invalidateTenant(tenantId),
    ]);
    this.logger.log(
      { tenantId, userId, answerDeleted, retrievalDeleted },
      'CacheInvalidation: flush user',
    );
    return { answerDeleted, retrievalDeleted };
  }
}
