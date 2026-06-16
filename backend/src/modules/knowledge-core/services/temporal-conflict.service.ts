import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  type EntityLink,
  type EntityLinkType,
  type IdeaBlockLink,
  type IdeaBlockLinkType,
} from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

import { ACTIVE_LINK_FILTER } from './link-read-filter';

/**
 * Agents v2 Фаза A1 (2026-05-30) — Bi-temporal edges.
 *
 * `TemporalConflictService.onNewLink(...)` вызывается после `upsert` свежей
 * связи (block↔block или entity↔entity). Логика:
 *   1. Ищет existing открытые links (`validUntil IS NULL`) того же
 *      source+target, у которых `relationType` явно противоречит новому
 *      (см. `CONTRADICTING_BLOCK_LINK_PAIRS` / `CONTRADICTING_ENTITY_LINK_PAIRS`).
 *   2. Старый link не удаляется — ему проставляется `validUntil = NOW()`
 *      (закрытый интервал). Аудит в графе сохраняется.
 *   3. Если у нового link'а `validFrom` ещё не задан — он выставляется в
 *      `NOW()` (новая связь начала действовать).
 *   4. Метрика `temporal_edges_invalidated_total{relationType}` инкрементится
 *      по каждому закрытому old-link'у.
 *
 * Сервис — синглтон, side-effects идемпотентны (повторный вызов на тот же
 * новый link не закроет тот же old второй раз — `validUntil IS NULL`-фильтр).
 *
 * Источник: plans/tz/2026-05-29-agents-v2-umbrella.md §A1.
 */
@Injectable()
export class TemporalConflictService {
  private readonly logger = new Logger(TemporalConflictService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  /**
   * Обработать новую/обновлённую связь блок↔блок: закрыть противоречащие
   * existing open-links (validUntil = NOW), при необходимости проставить
   * validFrom на свежей связи.
   */
  async onNewBlockLink(link: IdeaBlockLink): Promise<{ invalidated: number }> {
    if (link.status !== 'active') return { invalidated: 0 };

    const conflicting = CONTRADICTING_BLOCK_LINK_PAIRS.get(link.relationType);
    if (!conflicting || conflicting.length === 0) return { invalidated: 0 };

    const now = new Date();
    const existing = await this.prisma.ideaBlockLink.findMany({
      where: {
        tenantId: link.tenantId,
        fromBlockId: link.fromBlockId,
        toBlockId: link.toBlockId,
        relationType: { in: conflicting },
        ...ACTIVE_LINK_FILTER,
        validUntil: null,
        // Исключаем сам новый link — на случай если по какой-то причине
        // relationType совпал (теоретически не должно: пары disjoint).
        NOT: { id: link.id },
      },
      select: { id: true, relationType: true },
    });

    if (existing.length === 0) {
      // Просто проставим validFrom если он пуст.
      await this.ensureValidFrom('block', link.id, link.validFrom, now);
      return { invalidated: 0 };
    }

    // Закрываем все противоречащие.
    let invalidated = 0;
    for (const old of existing) {
      const res = await this.prisma.ideaBlockLink.updateMany({
        where: { id: old.id, validUntil: null },
        data: { validUntil: now },
      });
      if (res.count > 0) {
        invalidated += res.count;
        this.metrics?.incTemporalEdgesInvalidated({
          relationType: old.relationType,
        });
        this.logger.log(
          {
            tenantId: link.tenantId,
            newLinkId: link.id,
            newType: link.relationType,
            invalidatedLinkId: old.id,
            invalidatedType: old.relationType,
          },
          'temporal-conflict: closed old IdeaBlockLink',
        );
      }
    }

    await this.ensureValidFrom('block', link.id, link.validFrom, now);
    return { invalidated };
  }

  /**
   * Обработать новую/обновлённую связь entity↔entity: закрыть противоречащие
   * existing open-links того же source+target+(fromType,toType).
   */
  async onNewEntityLink(link: EntityLink): Promise<{ invalidated: number }> {
    if (link.status !== 'active') return { invalidated: 0 };

    const conflicting = CONTRADICTING_ENTITY_LINK_PAIRS.get(link.relationType);
    if (!conflicting || conflicting.length === 0) return { invalidated: 0 };

    const now = new Date();
    const existing = await this.prisma.entityLink.findMany({
      where: {
        tenantId: link.tenantId,
        fromEntityId: link.fromEntityId,
        toEntityId: link.toEntityId,
        fromType: link.fromType,
        toType: link.toType,
        relationType: { in: conflicting },
        ...ACTIVE_LINK_FILTER,
        validUntil: null,
        NOT: { id: link.id },
      },
      select: { id: true, relationType: true },
    });

    if (existing.length === 0) {
      await this.ensureValidFrom('entity', link.id, link.validFrom, now);
      return { invalidated: 0 };
    }

    let invalidated = 0;
    for (const old of existing) {
      const res = await this.prisma.entityLink.updateMany({
        where: { id: old.id, validUntil: null },
        data: { validUntil: now },
      });
      if (res.count > 0) {
        invalidated += res.count;
        this.metrics?.incTemporalEdgesInvalidated({
          relationType: old.relationType,
        });
        this.logger.log(
          {
            tenantId: link.tenantId,
            newLinkId: link.id,
            newType: link.relationType,
            invalidatedLinkId: old.id,
            invalidatedType: old.relationType,
          },
          'temporal-conflict: closed old EntityLink',
        );
      }
    }

    await this.ensureValidFrom('entity', link.id, link.validFrom, now);
    return { invalidated };
  }

  private async ensureValidFrom(
    kind: 'block' | 'entity',
    id: string,
    currentValidFrom: Date | null,
    now: Date,
  ): Promise<void> {
    if (currentValidFrom) return;
    if (kind === 'block') {
      // IdeaBlockLink.validFrom — nullable (Agents v2 A1).
      await this.prisma.ideaBlockLink.updateMany({
        where: { id, validFrom: null },
        data: { validFrom: now },
      });
    }
    // EntityLink.validFrom — required с @default(now()), null невозможен;
    // ensureValidFrom для 'entity' = no-op (значение уже валидное).
  }
}

/**
 * Список «противоречащих пар» для IdeaBlockLink. Если детектируется новая
 * связь типа X, существующие открытые связи типа Y (где Y ∈ map[X]) с тем
 * же (from,to) — закрываются.
 *
 * Симметрия: если X → [Y], то Y → [X] (чтобы порядок появления не имел
 * значения).
 */
const CONTRADICTING_BLOCK_LINK_PAIRS = new Map<
  IdeaBlockLinkType,
  IdeaBlockLinkType[]
>([
  // develops vs contradicts — содержательное противоречие.
  ['develops', ['contradicts']],
  ['contradicts', ['develops']],
  // supersedes — новая версия факта заменяет старую; develops/causes на
  // старом блоке логически закрываются вместе с самим блоком, но здесь
  // мы трогаем только зеркальные «один источник, один тип факта»-пары.
  // Пока добавляем только develops↔contradicts (ясный кейс из ТЗ §A1).
]);

/**
 * Список «противоречащих пар» для EntityLink. Аналогичная симметрия.
 *
 * Базовые пары (из ТЗ §A1):
 *   - works_at ↔ opposes (если детектируется явная конфронтация, прошлая
 *     принадлежность закрывается).
 *
 * NB: legacy enum EntityLinkType НЕ содержит `left_company` (ТЗ привёл его
 * как иллюстрацию — в проекте такого типа нет). Реальные противопоставления
 * сейчас:
 *   - works_at ↔ opposes  (вышел из компании / стал конкурентом).
 *   - mentors ↔ conflicted_with (наставничество vs зафиксированный конфликт).
 *   - manages ↔ reports_to (направление не должно одновременно быть и
 *     управлением и подчинением — обычно это одна и та же связь, инвертированная,
 *     но если LLM ошибся — старая закрывается).
 *
 * Расширять только после явного решения в second-brain/02_architecture/.
 */
const CONTRADICTING_ENTITY_LINK_PAIRS = new Map<
  EntityLinkType,
  EntityLinkType[]
>([
  ['works_at', ['opposes']],
  ['opposes', ['works_at']],
  ['mentors', ['conflicted_with']],
  ['conflicted_with', ['mentors']],
]);
