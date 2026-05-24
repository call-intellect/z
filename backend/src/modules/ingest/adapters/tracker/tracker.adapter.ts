import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { SignalType, Source } from '@prisma/client';

import { BusinessMetricsService } from '../../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { IngestService } from '../../ingest.service';

/**
 * Структура события, которое публикует `TrackerEmitterService`
 * (`tracker/services/tracker-emitter.service.ts`). Дублируем интерфейс
 * структурно (а не импортом из tracker'а), чтобы НЕ создать циклическую
 * зависимость IngestModule ↔ TrackerModule.
 */
interface TrackerEventPayloadShape {
  type:
    | 'issue.created'
    | 'issue.status_changed'
    | 'issue.status_changed_to_blocked'
    | 'issue.status_changed_to_done'
    | 'issue.overdue_detected'
    | 'issue.assignee_changed'
    | 'comment.created'
    | 'mention.created';
  tenantId: string;
  occurredAt: string;
  issue: {
    id: string;
    identifier: string;
    title: string;
    description?: string | null;
    projectId: string;
    stateId?: string | null;
    dueDate?: string | null;
  };
  actor: {
    userId: string | null;
    actorType: 'user' | 'ai_agent' | 'system';
  };
  meta?: Record<string, unknown>;
}

/**
 * Маппинг типа события трекера → SignalType IdeaBlock.
 *
 * NB: `issue.status_changed` (generic) — попадает только если новая категория
 * НЕ blocked/completed (иначе TrackerEmitterService дублирует событие как
 * status_changed_to_blocked / status_changed_to_done — выигрывает специфичный).
 */
const SIGNAL_TYPE_MAP: Record<
  TrackerEventPayloadShape['type'],
  SignalType
> = {
  'issue.created': 'task_created',
  'issue.status_changed': 'task_status_changed',
  'issue.status_changed_to_blocked': 'task_blocked',
  'issue.status_changed_to_done': 'task_completed',
  'issue.overdue_detected': 'task_overdue',
  'issue.assignee_changed': 'task_reassigned',
  'comment.created': 'task_comment',
  'mention.created': 'task_mention',
};

/**
 * TrackerAdapter (Sprint 3 B1-3.1, 2026-05-24).
 *
 * Слушает события `tracker.event_occurred` (публикует `TrackerEmitterService`
 * через `@nestjs/event-emitter`) и создаёт `RawEvent` через `IngestService`.
 * Дальше — стандартный knowledge-core pipeline (block-ingest worker → IdeaBlock
 * → Entity → IdeaBlockLink → Theme).
 *
 * Принципы:
 *   1. **Идемпотентность**: `sourceExternalId = tracker:issue:<id>:<type>:<iso>`,
 *      IngestService дедуплицирует по этому ключу + sourceId + occurredAt.
 *   2. **Контекст для AI**: payload содержит минимально необходимое для LLM
 *      извлечения (title, description, actor, eventSpecific). Для
 *      `task_comment` и `task_created` — дополнительно `payload.fullText`
 *      (полный текст), чтобы LLM выделил commitments/decisions/ideas.
 *   3. **signalTypeHint**: проставляется в `payload.signalTypeHint` —
 *      `BlockIngestWorker` предпочитает его LLM-определению (см.
 *      block-ingest.worker.ts §"signalTypeHint override").
 *   4. **Lazy Source upsert**: один `Source(type=tracker_event, name='Трекер Z')`
 *      на Org, создаётся при первом событии (как meeting/telegram адаптеры).
 *   5. **Best-effort**: любая ошибка логируется (warn), но НЕ выбрасывается —
 *      бизнес-транзакция Tracker'а не должна падать из-за ingest'а.
 *
 * См. `plans/tz/2026-05-23-tracker-phase-1-models-api.md` (§ Ingest в
 * knowledge-core), `second-brain/01_projects/tracker.md`.
 */
@Injectable()
export class TrackerAdapter {
  private readonly logger = new Logger(TrackerAdapter.name);

  /** Канонический name дефолтного tracker-Source для каждой Org. */
  static readonly DEFAULT_SOURCE_NAME = 'Трекер Z';

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IngestService) private readonly ingest: IngestService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @OnEvent('tracker.event_occurred', { async: true })
  async handleTrackerEvent(payload: TrackerEventPayloadShape): Promise<void> {
    try {
      await this.processEvent(payload);
    } catch (err) {
      // Strict best-effort: бизнес-транзакция трекера уже зафиксирована,
      // ingest — отложенный шаг; падать наружу нельзя.
      this.logger.warn(
        {
          type: payload?.type,
          issueId: payload?.issue?.id,
          tenantId: payload?.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'tracker-adapter: ingest упал — событие пропущено',
      );
    }
  }

  private async processEvent(payload: TrackerEventPayloadShape): Promise<void> {
    if (!payload || typeof payload !== 'object') {
      this.logger.warn('tracker-adapter: пустой/некорректный payload — skip');
      return;
    }
    if (!payload.tenantId || !payload.issue?.id) {
      this.logger.warn(
        { type: payload.type },
        'tracker-adapter: payload без tenantId/issue.id — skip',
      );
      return;
    }
    const signalType = SIGNAL_TYPE_MAP[payload.type];
    if (!signalType) {
      this.logger.warn(
        { type: payload.type },
        'tracker-adapter: неизвестный type события — skip',
      );
      return;
    }

    const occurredAt = this.parseOccurredAt(payload.occurredAt);
    const source = await this.upsertDefaultTrackerSource(payload.tenantId);

    // Детерминированный sourceExternalId — для идемпотентности.
    // Включаем checksum payload.meta, чтобы два разных события одного типа
    // на одной задаче в одну секунду (например, два разных комментария)
    // имели РАЗНЫЕ ключи. Для самой задачи (issue:id) — порядок:
    //   tracker:issue:<issueId>:<type>:<occurredAtIso>[:<metaShortHash>]
    const metaShortHash = this.shortHash(payload.meta);
    const sourceExternalId = [
      'tracker',
      'issue',
      payload.issue.id,
      payload.type,
      occurredAt.toISOString(),
      metaShortHash,
    ].join(':');

    // Собираем компактный payload, который пойдёт в RawEvent.payload (jsonb).
    // Включаем signalTypeHint — block-ingest.worker предпочтёт его LLM-определению.
    const rawEventPayload = this.buildPayload({
      payload,
      signalType,
      occurredAt,
    });

    const result = await this.ingest.ingest({
      tenantId: payload.tenantId,
      sourceId: source.id,
      sourceExternalId,
      occurredAt,
      payload: rawEventPayload,
      dataClass: 'internal',
    });

    this.metrics.incTrackerEventToKnowledgeCore({
      tenant: payload.tenantId,
      type: payload.type,
    });

    this.logger.log(
      {
        rawEventId: result.rawEvent.id,
        type: payload.type,
        signalType,
        issueId: payload.issue.id,
        tenantId: payload.tenantId,
        idempotent: result.idempotent,
      },
      'tracker-adapter: ingest завершён',
    );
  }

  /**
   * Собирает payload для RawEvent. Формат един для всех типов событий, но
   * `fullText` присутствует только там, где есть смысловой контент для LLM
   * (issue.created / comment.created).
   */
  private buildPayload(args: {
    payload: TrackerEventPayloadShape;
    signalType: SignalType;
    occurredAt: Date;
  }): Record<string, unknown> {
    const { payload, signalType, occurredAt } = args;
    const base: Record<string, unknown> = {
      // signalTypeHint — block-ingest worker предпочтёт его LLM-определению.
      // См. block-ingest.worker.ts §"signalTypeHint override".
      signalTypeHint: signalType,
      eventType: payload.type,
      tenantId: payload.tenantId,
      occurredAt: occurredAt.toISOString(),
      issue: payload.issue,
      actor: payload.actor,
      meta: payload.meta ?? {},
    };

    // Контейнер для богатого текста (для LLM-извлечения). Заполняется только
    // там, где есть осмысленный текст.
    const fullText = this.extractFullText(payload);
    if (fullText) {
      base['fullText'] = fullText;
    }

    return base;
  }

  /**
   * Полный текст для LLM. По типам:
   *   - issue.created → `${title}\n\n${description}` (description может быть rich-text JSON).
   *   - comment.created → текст комментария (preferred contentStripped, fallback content).
   *   - остальные → null (для status_changed / overdue / assignee — заголовок
   *     задачи и meta дают AI достаточно контекста, тело не нужно).
   */
  private extractFullText(payload: TrackerEventPayloadShape): string | null {
    if (payload.type === 'issue.created') {
      const parts: string[] = [payload.issue.title];
      const description = payload.issue.description;
      if (description && description.trim().length > 0) {
        parts.push('');
        parts.push(description);
      }
      return parts.join('\n');
    }
    if (payload.type === 'comment.created') {
      const meta = payload.meta ?? {};
      const stripped =
        typeof meta['commentStripped'] === 'string'
          ? (meta['commentStripped'] as string)
          : null;
      const content =
        typeof meta['commentContent'] === 'string'
          ? (meta['commentContent'] as string)
          : null;
      const transcript =
        typeof meta['voiceTranscript'] === 'string'
          ? (meta['voiceTranscript'] as string)
          : null;
      const text = stripped ?? content ?? transcript;
      if (text && text.trim().length > 0) {
        return `${payload.issue.title}\n\n${text}`;
      }
      return null;
    }
    if (payload.type === 'mention.created') {
      // Контекст упоминания (если передан).
      const meta = payload.meta ?? {};
      const ctx =
        typeof meta['contextText'] === 'string'
          ? (meta['contextText'] as string)
          : null;
      if (ctx && ctx.trim().length > 0) {
        return `${payload.issue.title}\n\n${ctx}`;
      }
      return null;
    }
    return null;
  }

  /**
   * Lazy upsert дефолтного `Source(type=tracker_event)` для tenant'а.
   * Конкурентно-безопасен (try/catch на P2002 — повторный findUnique).
   */
  async upsertDefaultTrackerSource(tenantId: string): Promise<Source> {
    const existing = await this.prisma.source.findUnique({
      where: {
        tenantId_type_name: {
          tenantId,
          type: 'tracker_event',
          name: TrackerAdapter.DEFAULT_SOURCE_NAME,
        },
      },
    });
    if (existing) return existing;
    try {
      return await this.prisma.source.create({
        data: {
          tenantId,
          type: 'tracker_event',
          name: TrackerAdapter.DEFAULT_SOURCE_NAME,
          dataClass: 'internal',
          isActive: true,
        },
      });
    } catch (err) {
      // Гонка: между findUnique и create кто-то создал — повторим find.
      const retry = await this.prisma.source.findUnique({
        where: {
          tenantId_type_name: {
            tenantId,
            type: 'tracker_event',
            name: TrackerAdapter.DEFAULT_SOURCE_NAME,
          },
        },
      });
      if (retry) return retry;
      throw err;
    }
  }

  private parseOccurredAt(input: string): Date {
    if (!input) return new Date();
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }

  /**
   * Короткий (8 hex) хэш от meta — для различения двух событий одного типа
   * в одну секунду (два комментария подряд и т.п.). Если meta нет — '0'.
   */
  private shortHash(meta: Record<string, unknown> | undefined): string {
    if (!meta || Object.keys(meta).length === 0) return '0';
    try {
      const json = JSON.stringify(meta);
      return createHash('sha256').update(json, 'utf8').digest('hex').slice(0, 8);
    } catch {
      return '0';
    }
  }
}
