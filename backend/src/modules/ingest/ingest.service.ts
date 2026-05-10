import { createHash } from 'node:crypto';

import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  type DataClass,
  Prisma,
  type RawEvent,
  type SourceType,
} from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { CoreQueueService } from '../core-queue/core-queue.service';
import { S3Service } from '../recordings/s3.service';

/**
 * Размер payload, при превышении которого jsonb становится неудобным
 * (10 MiB — мягкий предел Postgres jsonb на нашей конфигурации). Выше —
 * payload уезжает в S3 (`payloadStorage = 's3'`), а в `RawEvent.payload`
 * пишется `null`.
 */
const PAYLOAD_INLINE_LIMIT_BYTES = 10 * 1024 * 1024;

/**
 * Внутренний contract: что должен передать любой адаптер источника
 * (meeting/chat/email/telegram/...).
 */
export interface IngestEventInput {
  tenantId: string;
  sourceId: string;
  /**
   * Внешний идентификатор события (telegram message_id, email Message-ID,
   * meetingId). Если null — дедуп идёт по checksum payload.
   */
  sourceExternalId?: string | null;
  occurredAt: Date;
  /** Сериализуемый JSON. */
  payload: unknown;
  /** Класс данных. По дефолту — `internal`. */
  dataClass?: DataClass;
}

/**
 * Результат ingest. `idempotent = true` — событие уже было ранее,
 * вернули существующий `RawEvent`.
 */
export interface IngestResult {
  rawEvent: RawEvent;
  idempotent: boolean;
}

/**
 * Универсальный приёмник входящих событий из любого источника.
 *
 *   - Любой адаптер (meeting/chat/email/telegram) вызывает `ingest(...)`.
 *   - Идемпотентность по `idempotencyKey = sha256(sourceId + ':' +
 *     (sourceExternalId ?? payloadChecksum) + ':' + occurredAtIso)`.
 *   - Большие payload (>10 MiB) уезжают в S3 (`raw-events/<tenantId>/<id>.json`).
 *   - После успешного create — публикуется job `core.raw-events`. Consumer
 *     (`block-ingest.worker`, Фаза 2) на Фазе 1 ещё не подключён —
 *     jobs накапливаются в Redis (нормально).
 */
@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(S3Service) private readonly s3: S3Service,
    @Inject(CoreQueueService) private readonly coreQueue: CoreQueueService,
  ) {}

  async ingest(input: IngestEventInput): Promise<IngestResult> {
    // 1. Проверка Source: тенант, активность.
    const source = await this.prisma.source.findUnique({
      where: { id: input.sourceId },
    });
    if (!source) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'source_not_found', message: `Source ${input.sourceId} не найден` },
      });
    }
    if (source.tenantId !== input.tenantId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'source_tenant_mismatch',
          message: 'Source принадлежит другому tenant',
        },
      });
    }
    if (!source.isActive) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'source_inactive', message: 'Source отключён' },
      });
    }

    // 2. Сериализация payload и расчёт checksum/size.
    let payloadJson: string;
    try {
      payloadJson = JSON.stringify(input.payload);
    } catch (err) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'payload_not_serializable',
          message: `payload не сериализуется в JSON: ${err instanceof Error ? err.message : String(err)}`,
        },
      });
    }
    if (payloadJson === undefined) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'payload_undefined', message: 'payload отсутствует или undefined' },
      });
    }
    const payloadChecksum = sha256Hex(payloadJson);
    const payloadSizeBytes = Buffer.byteLength(payloadJson, 'utf8');

    // 3. Расчёт idempotencyKey — детерминированный.
    const occurredAtIso = input.occurredAt.toISOString();
    const dedupBasis = input.sourceExternalId ?? payloadChecksum;
    const idempotencyKey = sha256Hex(
      `${input.sourceId}:${dedupBasis}:${occurredAtIso}`,
    );

    // 4. Идемпотентный возврат, если уже есть.
    const existing = await this.prisma.rawEvent.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      this.logger.debug(
        { rawEventId: existing.id, sourceId: input.sourceId, sourceExternalId: input.sourceExternalId ?? null },
        'ingest: идемпотентный возврат существующего RawEvent',
      );
      return { rawEvent: existing, idempotent: true };
    }

    // 5. Решение про inline / s3 storage. Если s3 — заранее выбираем cuid-подобный
    //    путь от `idempotencyKey`-префикса; реальный `id` назначит Prisma.
    const useS3 = payloadSizeBytes > PAYLOAD_INLINE_LIMIT_BYTES;
    const payloadS3Key = useS3
      ? `raw-events/${input.tenantId}/${idempotencyKey}.json`
      : null;
    if (useS3 && payloadS3Key) {
      // Кладём в S3 заранее; даже если БД-вставка упадёт, S3-объект безвреден
      // (никто на него не ссылается). Не используем транзакцию — S3-операция
      // вне Postgres.
      await this.s3.putJson(payloadS3Key, input.payload);
    }

    // 6. Создание RawEvent + enqueue в одной попытке. Если на этом
    //    идемпотентном ключе случилась гонка (P2002) — повторяем findUnique.
    try {
      const created = await this.prisma.rawEvent.create({
        data: {
          tenantId: input.tenantId,
          sourceId: source.id,
          sourceType: source.type as SourceType,
          sourceExternalId: input.sourceExternalId ?? null,
          idempotencyKey,
          occurredAt: input.occurredAt,
          payloadStorage: useS3 ? 's3' : 'inline',
          payload: useS3 ? Prisma.JsonNull : (input.payload as Prisma.InputJsonValue),
          payloadS3Key,
          payloadChecksum,
          payloadSizeBytes,
          dataClass: input.dataClass ?? source.dataClass,
          processingStatus: 'received',
        },
      });
      // Enqueue вне транзакции — если упадёт, RawEvent останется со
      // статусом `received` и его перепоставит ручная переподписка
      // (либо джоба cleanup'а в Фазе 2).
      await this.coreQueue.enqueueRawReceived(created.id).catch((err) => {
        this.logger.warn(
          { rawEventId: created.id, err: err instanceof Error ? err.message : String(err) },
          'ingest: enqueueRawReceived упал — RawEvent создан, job не поставлен',
        );
      });
      this.logger.log(
        {
          rawEventId: created.id,
          tenantId: created.tenantId,
          sourceType: created.sourceType,
          sourceId: created.sourceId,
          payloadStorage: created.payloadStorage,
          payloadSizeBytes: created.payloadSizeBytes,
        },
        'ingest: RawEvent создан',
      );
      return { rawEvent: created, idempotent: false };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Гонка по idempotencyKey — fallback на findUnique.
        const existed = await this.prisma.rawEvent.findUnique({
          where: { idempotencyKey },
        });
        if (existed) {
          this.logger.debug(
            { rawEventId: existed.id },
            'ingest: P2002 race — возвращаем существующий RawEvent',
          );
          return { rawEvent: existed, idempotent: true };
        }
      }
      throw err;
    }
  }
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
