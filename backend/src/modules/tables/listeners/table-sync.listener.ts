import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import {
  ENTITY_ARCHIVED,
  ENTITY_CREATED,
  ENTITY_UPDATED,
  type EntitySyncEventPayload,
} from '../events/entity-sync.events';
import type { TableSyncEventType } from '../queues';
import { TableSyncQueueService } from '../services/table-sync-queue.service';

@Injectable()
export class TableSyncListener {
  private readonly logger = new Logger(TableSyncListener.name);

  constructor(
    @Inject(TableSyncQueueService)
    private readonly queue: TableSyncQueueService,
  ) {}

  @OnEvent(ENTITY_CREATED, { async: true })
  async onCreated(payload: EntitySyncEventPayload): Promise<void> {
    await this.enqueue(payload, 'created');
  }

  @OnEvent(ENTITY_UPDATED, { async: true })
  async onUpdated(payload: EntitySyncEventPayload): Promise<void> {
    await this.enqueue(payload, 'updated');
  }

  @OnEvent(ENTITY_ARCHIVED, { async: true })
  async onArchived(payload: EntitySyncEventPayload): Promise<void> {
    await this.enqueue(payload, 'archived');
  }

  private async enqueue(
    payload: EntitySyncEventPayload,
    eventType: TableSyncEventType,
  ): Promise<void> {
    if (!payload?.tenantId || !payload?.entityId || !payload?.entityType) {
      return;
    }
    try {
      await this.queue.enqueueEntityEvent({
        tenantId: payload.tenantId,
        entityId: payload.entityId,
        entityType: payload.entityType,
        eventType,
      });
    } catch (err) {
      this.logger.warn(
        {
          eventType,
          entityId: payload.entityId,
          err: err instanceof Error ? err.message : String(err),
        },
        'table-sync listener: enqueue не удался — пропускаем (best-effort)',
      );
    }
  }
}
