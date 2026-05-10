import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditLogService } from '../audit/audit-log.service';
import { AUDIT } from '../audit/audit.types';
import { S3Service } from '../recordings/s3.service';

/**
 * Сводка операции `eraseEntity`. Поля не агрегируются — caller рендерит
 * пользователю «Удалено: 3 источника, 5 свидетельств, 2 связи; 1 блок
 * архивирован».
 */
export interface EraseReport {
  /** Сколько RawEvent'ов удалено (источники, в которых упомянута персона). */
  erasedRawEvents: number;
  /** Сколько `IdeaBlockEvidence` удалено каскадом. */
  deletedEvidences: number;
  /** Сколько блоков (без оставшихся evidence) переведено в archived. */
  archivedBlocks: number;
  /** Сколько `EntityLink` (входящих или исходящих) удалено. */
  deletedEntityLinks: number;
  /** Идемпотентный повтор: персона уже была обезличена ранее. */
  alreadyErased?: boolean;
}

const ERASED_NAME = '[удалено по запросу]';

interface EraseInput {
  entityId: string;
  tenantId: string;
  /** userId инициатора удаления (для audit log). */
  requestedBy: string;
  /** Причина удаления (compliance / GDPR / 152-ФЗ запрос). */
  reason: string;
}

/**
 * PersonalDataDeletionService — реализация «права на удаление личных
 * данных» (152-ФЗ, GDPR-style). Фаза 11 knowledge-core.
 *
 * Подход — каскадный по `Entity(type='person')`:
 *
 *   1. Найти RawEvent'ы, упомянутые в evidence блоков, где персона является
 *      одной из сущностей. Удалить их (cascade удаляет evidence).
 *      → S3-payload по `payloadS3Key` чистится отдельно (fire-and-forget).
 *   2. Удалить `IdeaBlockEntity(personEntityId)` — связь блок↔персона.
 *   3. Перевести в `archived` блоки, у которых после удаления evidence
 *      `evidenceCount=0` (см. RetentionService.autoArchiveOrphanBlocks
 *      для аналогичной логики).
 *   4. Удалить `EntityLink` (где персона — from или to).
 *   5. Обезличить `Entity`: canonicalName='[удалено по запросу]', aliases=[],
 *      metadata={erasedAt, requestedBy, reason}.
 *   6. AuditLog `PERSON_DATA_ERASED` + метрика
 *      `core_personal_data_erasures_total`.
 *
 * Идемпотентность: повторный вызов на уже обезличенной персоне возвращает
 * `{...все нули, alreadyErased: true}` без побочных эффектов.
 *
 * NB: текст исторических LLM-сводок (где упоминалось имя персоны) — НЕ
 * переписываем. Это намеренный компромисс: 100%-удаление через LLM-rewrite
 * дорогое и ненадёжное (см. plans/2026-05-10-phase-11-execution.md §3).
 */
@Injectable()
export class PersonalDataDeletionService {
  private readonly logger = new Logger(PersonalDataDeletionService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
  ) {}

  async eraseEntity(input: EraseInput): Promise<EraseReport> {
    const entity = await this.prisma.entity.findUnique({
      where: { id: input.entityId },
    });
    if (!entity) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'entity_not_found', message: 'Сущность не найдена' },
      });
    }
    if (entity.tenantId !== input.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'entity_not_found', message: 'Сущность не найдена' },
      });
    }
    if (entity.type !== 'person') {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'entity_not_person',
          message: 'Удаление личных данных применимо только к Entity(type=person)',
        },
      });
    }

    // Идемпотентность: уже обезличена.
    if (entity.canonicalName === ERASED_NAME) {
      return {
        erasedRawEvents: 0,
        deletedEvidences: 0,
        archivedBlocks: 0,
        deletedEntityLinks: 0,
        alreadyErased: true,
      };
    }

    // 1. Собрать кандидатов на удаление: blockIds (по IdeaBlockEntity)
    //    → rawEventIds (по IdeaBlockEvidence).
    const blockMentions = await this.prisma.ideaBlockEntity.findMany({
      where: { entityId: entity.id },
      select: { blockId: true },
    });
    const blockIds = Array.from(new Set(blockMentions.map((m) => m.blockId)));

    const rawEventIds = blockIds.length
      ? await this.collectRawEventIds(blockIds)
      : [];

    // S3-ключи payload'ов — соберём ДО удаления RawEvent.
    const s3Keys = rawEventIds.length
      ? await this.collectS3Keys(rawEventIds)
      : [];

    // Подсчёт удалённых evidence — заранее (до cascade), чтобы в отчёте
    // показать пользователю «X свидетельств».
    const deletedEvidences = rawEventIds.length
      ? await this.prisma.ideaBlockEvidence.count({
          where: { rawEventId: { in: rawEventIds } },
        })
      : 0;

    // 2-5. Транзакция: RawEvent.delete (cascade) → IdeaBlockEntity.delete
    //      → archive orphan блоков → EntityLink.delete → Entity.update.
    const txResult = await this.prisma.$transaction(async (tx) => {
      let erasedRawEvents = 0;
      if (rawEventIds.length > 0) {
        const r = await tx.rawEvent.deleteMany({
          where: { id: { in: rawEventIds } },
        });
        erasedRawEvents = r.count;
      }

      // M:M IdeaBlockEntity — отвязать персону от блоков.
      await tx.ideaBlockEntity.deleteMany({ where: { entityId: entity.id } });

      // Архивируем «осиротевшие» блоки (где после удаления evidence стало 0).
      let archivedCount = 0;
      for (const blockId of blockIds) {
        const evCount = await tx.ideaBlockEvidence.count({
          where: { blockId },
        });
        if (evCount === 0) {
          const block = await tx.ideaBlock.findUnique({
            where: { id: blockId },
            select: { status: true },
          });
          if (
            block &&
            block.status !== 'archived' &&
            block.status !== 'merged_into'
          ) {
            await tx.ideaBlock.update({
              where: { id: blockId },
              data: { status: 'archived', evidenceCount: 0 },
            });
            archivedCount += 1;
          }
        } else {
          // Обновим evidenceCount на актуальное значение.
          await tx.ideaBlock.update({
            where: { id: blockId },
            data: { evidenceCount: evCount },
          });
        }
      }

      // 4. EntityLink — удалить все, где персона является from или to.
      const linkRes = await tx.entityLink.deleteMany({
        where: {
          OR: [{ fromEntityId: entity.id }, { toEntityId: entity.id }],
        },
      });

      // 5. Обезличить Entity.
      const erasedMeta: Prisma.InputJsonValue = {
        erasedAt: new Date().toISOString(),
        requestedBy: input.requestedBy,
        reason: input.reason,
      };
      await tx.entity.update({
        where: { id: entity.id },
        data: {
          canonicalName: ERASED_NAME,
          aliases: [],
          metadata: erasedMeta,
        },
      });

      return {
        erasedRawEvents,
        archivedCount,
        deletedEntityLinks: linkRes.count,
      };
    });

    // 6. AuditLog — действие super-уровня, ipHash/userAgent caller проставит
    //    при необходимости (через расширенный API).
    void this.audit.log({
      userId: input.requestedBy,
      action: AUDIT.PERSON_DATA_ERASED,
      resourceId: entity.id,
      metadata: {
        tenantId: entity.tenantId,
        reason: input.reason,
        erasedRawEvents: txResult.erasedRawEvents,
        deletedEvidences,
        archivedBlocks: txResult.archivedCount,
        deletedEntityLinks: txResult.deletedEntityLinks,
      },
    });

    // 7. Метрика — каждый успешный erase инкрементит счётчик.
    this.metrics.incCorePersonalDataErasure();

    // 8. S3-payload'ы чистим вне транзакции (fire-and-forget с лог).
    if (s3Keys.length > 0) {
      void this.s3.delete(s3Keys).catch((err) => {
        this.logger.warn(
          {
            entityId: entity.id,
            keys: s3Keys.length,
            err: err instanceof Error ? err.message : String(err),
          },
          'eraseEntity: S3 delete failed (БД-удаление выполнено, payload остался — потребуется ручная очистка)',
        );
      });
    }

    return {
      erasedRawEvents: txResult.erasedRawEvents,
      deletedEvidences,
      archivedBlocks: txResult.archivedCount,
      deletedEntityLinks: txResult.deletedEntityLinks,
    };
  }

  // ────────────────────────── helpers ──────────────────────────────────

  /**
   * Собирает уникальные rawEventId, на которые ссылаются evidence
   * указанных блоков. Возвращает массив (может быть пустым).
   */
  private async collectRawEventIds(blockIds: string[]): Promise<string[]> {
    const evidence = await this.prisma.ideaBlockEvidence.findMany({
      where: { blockId: { in: blockIds } },
      select: { rawEventId: true },
    });
    return Array.from(new Set(evidence.map((e) => e.rawEventId)));
  }

  /**
   * Собирает payloadS3Key для всех RawEvent с payloadStorage='s3'.
   */
  private async collectS3Keys(rawEventIds: string[]): Promise<string[]> {
    const events = await this.prisma.rawEvent.findMany({
      where: {
        id: { in: rawEventIds },
        payloadStorage: 's3',
        payloadS3Key: { not: null },
      },
      select: { payloadS3Key: true },
    });
    return events
      .map((e) => e.payloadS3Key)
      .filter((k): k is string => typeof k === 'string' && k.length > 0);
  }
}
