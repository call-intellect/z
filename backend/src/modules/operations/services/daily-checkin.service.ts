import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  CreateCheckInInput,
  DailyCheckInDto,
} from '../dto/daily-check-in.dto';
import { getLocalDate } from '../utils/local-date';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

/**
 * SBA β-8 — DailyCheckInService.
 *
 * Главный сервис управления чек-инами:
 *   - `createOrUpsert` — manual create через `/me/check-ins POST` или из
 *     `CheckinResponseHandler` (после LLM-парсинга ответа).
 *   - `listMine` — список своих чек-инов с фильтром по date/kind.
 *   - `historyMine` — окно N дней назад.
 *   - `listForTenant` — admin/coo читают все чек-ины Org (для COO dashboard).
 *
 * Anti-spam: unique constraint `(tenantId, personId, kind, dateLocal)`. Все
 * upsert'ы через этот ключ; повторный create в тот же день — обновляет.
 *
 * `parseConfidence < 0.6` → `curatorReview=true`, raw текст в `rawResponseText`,
 * данные plans/dones/blockers могут остаться пустыми (LLM не уверен).
 */
@Injectable()
export class DailyCheckInService {
  private readonly logger = new Logger(DailyCheckInService.name);
  private static readonly MIN_CONFIDENCE = 0.6;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Optional()
    @Inject(EventEmitter2)
    private readonly eventEmitter?: EventEmitter2,
  ) {}

  /**
   * Найти Person'а текущего user'а в Org. Если нет — это «гость» и чек-ин
   * не разрешён (бросаем 403). Возвращает personId.
   */
  async resolveSelfPerson(args: {
    tenantId: string;
    userId: string;
  }): Promise<{ id: string; timezone: string | null }> {
    const person = await this.prisma.person.findFirst({
      where: {
        tenantId: args.tenantId,
        userId: args.userId,
        deletedAt: null,
      },
      select: { id: true, timezone: true },
    });
    if (!person) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'no_person',
          message:
            'У пользователя нет Person-записи в этой Org — чек-ины недоступны',
        },
      });
    }
    return person;
  }

  /**
   * Manual create / upsert чек-ина. Если запись на (person, kind, dateLocal)
   * уже есть — обновляем поля. parseConfidence не передаётся: manual вход
   * считается canonical (confidence=1.0).
   */
  async createOrUpsertManual(args: {
    tenantId: string;
    personId: string;
    input: CreateCheckInInput;
    personTimezone: string | null;
  }): Promise<DailyCheckInDto> {
    const now = new Date();
    const dateLocal =
      args.input.dateLocal ?? getLocalDate(now, args.personTimezone);

    const dto = await this.upsertInternal({
      tenantId: args.tenantId,
      personId: args.personId,
      kind: args.input.kind,
      dateLocal,
      plans: args.input.plans ?? null,
      dones: args.input.dones ?? null,
      blockers: args.input.blockers ?? null,
      notificationId: null,
      rawResponseText: args.input.rawText ?? null,
      parseConfidence: 1,
      curatorReview: false,
      completed: true,
      source: 'manual',
    });

    // SBA β-8.1 — эмитим событие, на которое подписан
    // CheckinSentimentAnalyzerWorker. Best-effort, ошибки не ломают flow.
    try {
      this.eventEmitter?.emit('checkin.created', {
        tenantId: args.tenantId,
        checkInId: dto.id,
        personId: args.personId,
        kind: args.input.kind,
        rawText: args.input.rawText ?? null,
      });
    } catch (err) {
      this.logger.warn(
        {
          checkInId: dto.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'createOrUpsertManual: EventEmitter.emit failed — продолжаю',
      );
    }

    return dto;
  }

  /**
   * Upsert из LLM-парсера ответа. parseConfidence < 0.6 → curatorReview=true.
   */
  async upsertFromParser(args: {
    tenantId: string;
    personId: string;
    kind: 'morning' | 'evening';
    dateLocal: string;
    plans: unknown[] | null;
    dones: unknown[] | null;
    blockers: unknown[] | null;
    notificationId: string | null;
    rawResponseText: string;
    parseConfidence: number;
    source: 'cron_prompted' | 'self_initiated' | 'manual';
  }): Promise<DailyCheckInDto> {
    const lowConfidence =
      args.parseConfidence < DailyCheckInService.MIN_CONFIDENCE;

    return this.upsertInternal({
      tenantId: args.tenantId,
      personId: args.personId,
      kind: args.kind,
      dateLocal: args.dateLocal,
      plans: lowConfidence ? null : args.plans,
      dones: lowConfidence ? null : args.dones,
      blockers: lowConfidence ? null : args.blockers,
      notificationId: args.notificationId,
      rawResponseText: args.rawResponseText,
      parseConfidence: args.parseConfidence,
      curatorReview: lowConfidence,
      completed: true,
      source: args.source,
    });
  }

  /**
   * Cron-плейсхолдер: создаём «пустой» чек-ин (если его ещё нет),
   * фиксируем notificationId и оставляем completedAt=null. После ответа
   * пользователя `upsertFromParser` заполнит данные.
   */
  async createPromptPlaceholder(args: {
    tenantId: string;
    personId: string;
    kind: 'morning' | 'evening';
    dateLocal: string;
    notificationId: string;
  }): Promise<DailyCheckInDto> {
    return this.upsertInternal({
      tenantId: args.tenantId,
      personId: args.personId,
      kind: args.kind,
      dateLocal: args.dateLocal,
      plans: null,
      dones: null,
      blockers: null,
      notificationId: args.notificationId,
      rawResponseText: null,
      parseConfidence: null,
      curatorReview: false,
      completed: false,
      onlyIfMissing: true,
      source: 'cron_prompted',
    });
  }

  /**
   * Проверить, есть ли уже completed-чек-ин на сегодня (anti-spam для cron).
   */
  async hasCompletedToday(args: {
    tenantId: string;
    personId: string;
    kind: 'morning' | 'evening';
    dateLocal: string;
  }): Promise<boolean> {
    const existing = await this.prisma.dailyCheckIn.findUnique({
      where: {
        tenantId_personId_kind_dateLocal: {
          tenantId: args.tenantId,
          personId: args.personId,
          kind: args.kind,
          dateLocal: args.dateLocal,
        },
      },
      select: { completedAt: true },
    });
    return existing?.completedAt != null;
  }

  /**
   * Получить мой чек-ин по дате/типу. Если нет — null.
   */
  async getMine(args: {
    tenantId: string;
    personId: string;
    dateLocal: string;
    kind: 'morning' | 'evening';
  }): Promise<DailyCheckInDto | null> {
    const row = await this.prisma.dailyCheckIn.findUnique({
      where: {
        tenantId_personId_kind_dateLocal: {
          tenantId: args.tenantId,
          personId: args.personId,
          kind: args.kind,
          dateLocal: args.dateLocal,
        },
      },
    });
    return row ? this.toDto(row) : null;
  }

  /**
   * Список моих чек-инов (с фильтром по date/kind).
   */
  async listMine(args: {
    tenantId: string;
    personId: string;
    date?: string;
    kind?: 'morning' | 'evening';
  }): Promise<DailyCheckInDto[]> {
    const where: Prisma.DailyCheckInWhereInput = {
      tenantId: args.tenantId,
      personId: args.personId,
    };
    if (args.date) where.dateLocal = args.date;
    if (args.kind) where.kind = args.kind;
    const rows = await this.prisma.dailyCheckIn.findMany({
      where,
      orderBy: [{ dateLocal: 'desc' }, { kind: 'asc' }],
      take: 100,
    });
    return rows.map((r) => this.toDto(r));
  }

  /**
   * Окно последних N дней (default 30).
   */
  async historyMine(args: {
    tenantId: string;
    personId: string;
    days: number;
  }): Promise<DailyCheckInDto[]> {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - args.days);
    const rows = await this.prisma.dailyCheckIn.findMany({
      where: {
        tenantId: args.tenantId,
        personId: args.personId,
        createdAt: { gte: since },
      },
      orderBy: [{ dateLocal: 'desc' }, { kind: 'asc' }],
      take: 200,
    });
    return rows.map((r) => this.toDto(r));
  }

  // ─────────────────────── private ────────────────────────────────────

  private async upsertInternal(args: {
    tenantId: string;
    personId: string;
    kind: 'morning' | 'evening';
    dateLocal: string;
    plans: unknown[] | null;
    dones: unknown[] | null;
    blockers: unknown[] | null;
    notificationId: string | null;
    rawResponseText: string | null;
    parseConfidence: number | null;
    curatorReview: boolean;
    completed: boolean;
    onlyIfMissing?: boolean;
    source: 'cron_prompted' | 'self_initiated' | 'manual';
  }): Promise<DailyCheckInDto> {
    if (args.kind !== 'morning' && args.kind !== 'evening') {
      throw new BadRequestException({
        ok: false,
        error: { code: 'invalid_kind', message: 'kind должен быть morning|evening' },
      });
    }

    const completedAt = args.completed ? new Date() : null;
    const upsertData = {
      plansJson: (args.plans ?? Prisma.JsonNull) as Prisma.InputJsonValue | typeof Prisma.JsonNull,
      donesJson: (args.dones ?? Prisma.JsonNull) as Prisma.InputJsonValue | typeof Prisma.JsonNull,
      blockersJson: (args.blockers ?? Prisma.JsonNull) as Prisma.InputJsonValue | typeof Prisma.JsonNull,
      notificationId: args.notificationId,
      rawResponseText: args.rawResponseText,
      parseConfidence: args.parseConfidence,
      curatorReview: args.curatorReview,
      completedAt,
      source: args.source,
    };

    if (args.onlyIfMissing) {
      const existing = await this.prisma.dailyCheckIn.findUnique({
        where: {
          tenantId_personId_kind_dateLocal: {
            tenantId: args.tenantId,
            personId: args.personId,
            kind: args.kind,
            dateLocal: args.dateLocal,
          },
        },
      });
      if (existing) {
        return this.toDto(existing);
      }
    }

    const row = await this.prisma.dailyCheckIn.upsert({
      where: {
        tenantId_personId_kind_dateLocal: {
          tenantId: args.tenantId,
          personId: args.personId,
          kind: args.kind,
          dateLocal: args.dateLocal,
        },
      },
      create: {
        tenantId: args.tenantId,
        personId: args.personId,
        kind: args.kind,
        dateLocal: args.dateLocal,
        ...upsertData,
      },
      update: upsertData,
    });

    if (args.completed) {
      this.metrics.incDailyCheckinCompleted({
        tenantTop: resolveOperationsTenantTop(args.tenantId),
        kind: args.kind,
      });
    }
    return this.toDto(row);
  }

  /**
   * Преобразует Prisma-row в DTO. Json-поля валидируются мягко (mapper в
   * DailyCheckInDto не падает на NULL — возвращает пустой массив).
   */
  private toDto(row: {
    id: string;
    tenantId: string;
    personId: string;
    kind: string;
    dateLocal: string;
    plansJson: unknown;
    donesJson: unknown;
    blockersJson: unknown;
    notificationId: string | null;
    parseConfidence: unknown;
    curatorReview: boolean;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    source?: string | null;
    sentiment?: string | null;
    sentimentRationale?: string | null;
    sentimentVersion?: string | null;
    sentimentDeterminedAt?: Date | null;
  }): DailyCheckInDto {
    const confidence =
      row.parseConfidence == null
        ? null
        : Number((row.parseConfidence as { toString(): string }).toString());
    const sentiment =
      row.sentiment === 'green' ||
      row.sentiment === 'yellow' ||
      row.sentiment === 'red'
        ? row.sentiment
        : null;
    const source: DailyCheckInDto['source'] =
      row.source === 'self_initiated' || row.source === 'manual'
        ? row.source
        : 'cron_prompted';
    return {
      id: row.id,
      tenantId: row.tenantId,
      personId: row.personId,
      kind: (row.kind === 'evening' ? 'evening' : 'morning'),
      dateLocal: row.dateLocal,
      source,
      plans: Array.isArray(row.plansJson) ? (row.plansJson as DailyCheckInDto['plans']) : [],
      dones: Array.isArray(row.donesJson) ? (row.donesJson as DailyCheckInDto['dones']) : [],
      blockers: Array.isArray(row.blockersJson)
        ? (row.blockersJson as DailyCheckInDto['blockers'])
        : [],
      notificationId: row.notificationId,
      parseConfidence: confidence,
      curatorReview: row.curatorReview,
      completedAt: row.completedAt ? row.completedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      sentiment,
      sentimentRationale: row.sentimentRationale ?? null,
      sentimentVersion: row.sentimentVersion ?? null,
      sentimentDeterminedAt: row.sentimentDeterminedAt
        ? row.sentimentDeterminedAt.toISOString()
        : null,
    };
  }
}

/** Удобный type-guard: бросает 404, если getMine вернул null. */
export function assertCheckIn<T>(value: T | null, code: string, message: string): T {
  if (value == null) {
    throw new NotFoundException({
      ok: false,
      error: { code, message },
    });
  }
  return value;
}
