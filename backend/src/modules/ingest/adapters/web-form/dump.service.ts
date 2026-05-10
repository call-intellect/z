import { randomUUID } from 'node:crypto';

import {
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { DataClass, Source } from '@prisma/client';

import { TypedConfigService } from '../../../../common/config/index';
import { PrismaService } from '../../../../common/prisma/prisma.service';
import { AuditLogService } from '../../../audit/audit-log.service';
import { AUDIT } from '../../../audit/audit.types';
import { QuotaService } from '../../../quotas/quota.service';
import { IngestService } from '../../ingest.service';

/**
 * Сервис web-form адаптера (Фаза 10 knowledge-core, Шаг 7).
 *
 *   - lazy-upsert `Source(tenantId, type='web_form', name='Дамп мысли')`.
 *   - Применяет квоту `dump_per_day_per_user` (default 30/день).
 *   - sourceExternalId = `web:<userId>:<nonce>` (idempotency).
 *   - Audit `dump.created` с длиной текста и dataClass.
 */
@Injectable()
export class DumpService {
  private readonly logger = new Logger(DumpService.name);

  /** Канонический name дефолтного web_form-Source для Org. */
  static readonly SOURCE_NAME = 'Дамп мысли';

  /** Квота — в день (24 часа), 30 дампов на юзера. */
  private static readonly QUOTA_NAME = 'dump_per_day_per_user';
  private static readonly QUOTA_MAX = 30;
  private static readonly QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IngestService) private readonly ingest: IngestService,
    @Inject(QuotaService) private readonly quota: QuotaService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async createDump(input: {
    tenantId: string;
    userId: string;
    userName: string | null;
    text: string;
    occurredAt?: Date;
    dataClass?: DataClass;
    nonce?: string;
  }): Promise<{ rawEventId: string; idempotent: boolean }> {
    // 1. Квота.
    await this.quota.checkAndIncrement({
      userId: input.userId,
      quotaName: DumpService.QUOTA_NAME,
      max: DumpService.QUOTA_MAX,
      windowMs: DumpService.QUOTA_WINDOW_MS,
    });

    // 2. Source — lazy upsert (один на Org).
    const source = await this.upsertWebFormSource(input.tenantId);

    // 3. Идемпотентность через nonce — если фронт не сгенерил, делаем server-side
    //    UUID, тогда повторный вызов будет считаться новым событием (что
    //    приемлемо для server-issued nonce).
    const nonce = input.nonce ?? randomUUID();
    const sourceExternalId = `web:${input.userId}:${nonce}`;
    const occurredAt = input.occurredAt ?? new Date();
    const dataClass = input.dataClass ?? source.dataClass;

    const payload = {
      text: input.text,
      authorUserId: input.userId,
      authorName: input.userName,
    };

    const result = await this.ingest.ingest({
      tenantId: input.tenantId,
      sourceId: source.id,
      sourceExternalId,
      occurredAt,
      payload,
      dataClass,
    });

    await this.audit.log({
      userId: input.userId,
      action: AUDIT.DUMP_CREATED,
      resourceId: result.rawEvent.id,
      metadata: { length: input.text.length, dataClass },
    });

    this.logger.log(
      {
        tenantId: input.tenantId,
        userId: input.userId,
        rawEventId: result.rawEvent.id,
        idempotent: result.idempotent,
      },
      'dump: создан',
    );

    return { rawEventId: result.rawEvent.id, idempotent: result.idempotent };
  }

  private async upsertWebFormSource(tenantId: string): Promise<Source> {
    const existing = await this.prisma.source.findUnique({
      where: {
        tenantId_type_name: {
          tenantId,
          type: 'web_form',
          name: DumpService.SOURCE_NAME,
        },
      },
    });
    if (existing) return existing;
    try {
      return await this.prisma.source.create({
        data: {
          tenantId,
          type: 'web_form',
          name: DumpService.SOURCE_NAME,
          dataClass: 'internal',
          isActive: true,
        },
      });
    } catch {
      const retry = await this.prisma.source.findUnique({
        where: {
          tenantId_type_name: {
            tenantId,
            type: 'web_form',
            name: DumpService.SOURCE_NAME,
          },
        },
      });
      if (retry) return retry;
      throw new Error('DumpService: не удалось upsert web_form Source');
    }
  }
}
