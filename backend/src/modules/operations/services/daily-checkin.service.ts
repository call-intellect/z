import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DailyCheckInSource, Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { CreateCheckInInput, DailyCheckInDto } from '../dto/daily-check-in.dto';
import { getLocalDate } from '../utils/local-date';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

function sourceRank(s: string): number {
  if (s === 'self_initiated' || s === 'manual' || s === 'cron_prompted') return 4;
  if (s === 'meeting') return 3;
  if (s === 'bitrix' || s === 'chatbox') return 2;
  if (s === 'email' || s === 'phone_call') return 1;
  return 0;
}

function normText(t: string): string {
  return t.trim().toLowerCase();
}

function mergeByText<T extends { text: string }>(existing: T[], incoming: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of [...existing, ...incoming]) {
    const key = normText(item.text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function computeReportCompleteness(
  args: {
    qualityScore: number | null;
    dones: unknown[];
    notDone: unknown[];
    blockers: unknown[];
    ideas: unknown[];
  },
  threshold: number,
): 'draft' | 'full' {
  const partsFilled = [args.dones, args.notDone, args.blockers, args.ideas].filter(
    (p) => Array.isArray(p) && p.length > 0,
  ).length;
  const qualityOk = args.qualityScore != null && args.qualityScore >= threshold;
  return qualityOk && partsFilled >= 3 ? 'full' : 'draft';
}

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
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg: TypedConfigService | null = null,
  ) {}

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
          message: 'У пользователя нет Person-записи в этой Org — чек-ины недоступны',
        },
      });
    }
    return person;
  }

  async createOrUpsertManual(args: {
    tenantId: string;
    personId: string;
    input: CreateCheckInInput;
    personTimezone: string | null;
  }): Promise<DailyCheckInDto> {
    const now = new Date();
    const dateLocal = args.input.dateLocal ?? getLocalDate(now, args.personTimezone);

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
    const lowConfidence = args.parseConfidence < DailyCheckInService.MIN_CONFIDENCE;

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

  async upsertFromDaySignal(args: {
    tenantId: string;
    personId: string;
    kind: 'morning' | 'evening';
    dateLocal: string;
    items: Array<{ text: string; priority?: number }>;
    dones: Array<{ text: string }>;
    blockers: Array<{ text: string; severity?: 'low' | 'medium' | 'high' }>;
    ideas?: Array<{ text: string; sourceBlockId?: string }>;
    notDone?: Array<{ text: string; sourcePlanText?: string; verdictConfidence?: number }>;
    rawResponseText: string;
    parseConfidence: number;
    source: 'meeting' | 'bitrix' | 'chatbox' | 'email' | 'phone_call' | 'self_initiated';
    now?: Date;
  }): Promise<DailyCheckInDto> {
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

    const existingPlans = Array.isArray(existing?.plansJson)
      ? (existing!.plansJson as Array<{ text: string; priority?: number }>)
      : [];
    const existingDones = Array.isArray(existing?.donesJson)
      ? (existing!.donesJson as Array<{ text: string }>)
      : [];
    const existingBlockers = Array.isArray(existing?.blockersJson)
      ? (existing!.blockersJson as Array<{ text: string; severity?: 'low' | 'medium' | 'high' }>)
      : [];
    const existingIdeas = Array.isArray(existing?.ideasJson)
      ? (existing!.ideasJson as Array<{ text: string; sourceBlockId?: string }>)
      : [];
    const existingNotDone = Array.isArray(existing?.notDoneJson)
      ? (existing!.notDoneJson as Array<{
          text: string;
          sourcePlanText?: string;
          verdictConfidence?: number;
        }>)
      : [];

    const plans =
      args.kind === 'morning' ? mergeByText(existingPlans, args.items) : existingPlans;
    const dones =
      args.kind === 'evening' ? mergeByText(existingDones, args.dones) : existingDones;
    const blockers =
      args.kind === 'evening' ? mergeByText(existingBlockers, args.blockers) : existingBlockers;
    const ideas = args.kind === 'evening' ? mergeByText(existingIdeas, args.ideas ?? []) : existingIdeas;
    const notDone =
      args.kind === 'evening' && args.notDone !== undefined ? args.notDone : existingNotDone;

    const existingRank = existing ? sourceRank(existing.source) : -1;
    const newRank = sourceRank(args.source);
    const newWins = newRank > existingRank;
    const winnerSource: DailyCheckInSource = newWins
      ? args.source
      : (existing!.source as DailyCheckInSource);

    const rawResponseText = newWins
      ? args.rawResponseText
      : (existing!.rawResponseText ?? args.rawResponseText);
    const parseConfidence = newWins
      ? args.parseConfidence
      : Number(existing!.parseConfidence ?? args.parseConfidence);

    const at = (args.now ?? new Date()).toISOString();
    const prevContribs = Array.isArray(existing?.sourceContributions)
      ? (existing!.sourceContributions as unknown[])
      : [];
    const contributions = [...prevContribs, { source: args.source, at, rank: newRank }];

    const dto = await this.upsertInternal({
      tenantId: args.tenantId,
      personId: args.personId,
      kind: args.kind,
      dateLocal: args.dateLocal,
      plans,
      dones,
      blockers,
      notificationId: null,
      rawResponseText,
      parseConfidence,
      curatorReview: false,
      completed: true,
      source: winnerSource,
      sourceContributions: contributions as Prisma.InputJsonValue,
      notDone,
      ideas,
    });

    try {
      this.eventEmitter?.emit('checkin.created', {
        tenantId: args.tenantId,
        checkInId: dto.id,
        personId: args.personId,
        kind: args.kind,
        rawText: args.rawResponseText,
      });
    } catch (err) {
      this.logger.warn(
        {
          checkInId: dto.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'upsertFromDaySignal: EventEmitter.emit failed — продолжаю',
      );
    }

    return dto;
  }

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
    source: DailyCheckInSource;
    sourceContributions?: Prisma.InputJsonValue | null;
    notDone?: Array<{ text: string; sourcePlanText?: string; verdictConfidence?: number }>;
    ideas?: Array<{ text: string; sourceBlockId?: string }>;
    reportCompleteness?: 'draft' | 'full' | null;
  }): Promise<DailyCheckInDto> {
    if (args.kind !== 'morning' && args.kind !== 'evening') {
      throw new BadRequestException({
        ok: false,
        error: { code: 'invalid_kind', message: 'kind должен быть morning|evening' },
      });
    }

    const completedAt = args.completed ? new Date() : null;
    const sourceContributionsPatch =
      args.sourceContributions !== undefined
        ? {
            sourceContributions: (args.sourceContributions ?? Prisma.JsonNull) as
              | Prisma.InputJsonValue
              | typeof Prisma.JsonNull,
          }
        : {};
    const notDonePatch =
      args.notDone !== undefined
        ? { notDoneJson: (args.notDone ?? Prisma.JsonNull) as Prisma.InputJsonValue | typeof Prisma.JsonNull }
        : {};
    const ideasPatch =
      args.ideas !== undefined
        ? { ideasJson: (args.ideas ?? Prisma.JsonNull) as Prisma.InputJsonValue | typeof Prisma.JsonNull }
        : {};
    const reportCompletenessPatch =
      args.reportCompleteness !== undefined ? { reportCompleteness: args.reportCompleteness } : {};
    const upsertData = {
      plansJson: (args.plans ?? Prisma.JsonNull) as Prisma.InputJsonValue | typeof Prisma.JsonNull,
      donesJson: (args.dones ?? Prisma.JsonNull) as Prisma.InputJsonValue | typeof Prisma.JsonNull,
      blockersJson: (args.blockers ?? Prisma.JsonNull) as
        | Prisma.InputJsonValue
        | typeof Prisma.JsonNull,
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
        ...sourceContributionsPatch,
        ...notDonePatch,
        ...ideasPatch,
        ...reportCompletenessPatch,
      },
      update: {
        ...upsertData,
        ...sourceContributionsPatch,
        ...notDonePatch,
        ...ideasPatch,
        ...reportCompletenessPatch,
      },
    });

    if (args.completed) {
      this.metrics.incDailyCheckinCompleted({
        tenantTop: resolveOperationsTenantTop(args.tenantId),
        kind: args.kind,
      });
    }
    return this.toDto(row);
  }

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
    sourceContributions?: unknown;
    notDoneJson?: unknown;
    ideasJson?: unknown;
    qualityScore?: unknown;
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
      row.sentiment === 'green' || row.sentiment === 'yellow' || row.sentiment === 'red'
        ? row.sentiment
        : null;
    const VALID_SOURCES = [
      'cron_prompted',
      'self_initiated',
      'manual',
      'meeting',
      'bitrix',
      'chatbox',
      'email',
      'phone_call',
    ] as const;
    const source: DailyCheckInDto['source'] = (VALID_SOURCES as readonly string[]).includes(
      row.source ?? '',
    )
      ? (row.source as DailyCheckInDto['source'])
      : 'cron_prompted';
    const dones = Array.isArray(row.donesJson) ? (row.donesJson as DailyCheckInDto['dones']) : [];
    const blockers = Array.isArray(row.blockersJson)
      ? (row.blockersJson as DailyCheckInDto['blockers'])
      : [];
    const notDone = Array.isArray(row.notDoneJson)
      ? (row.notDoneJson as DailyCheckInDto['notDone'])
      : [];
    const ideas = Array.isArray(row.ideasJson) ? (row.ideasJson as DailyCheckInDto['ideas']) : [];
    const qualityScore =
      row.qualityScore == null
        ? null
        : Number((row.qualityScore as { toString(): string }).toString());
    const threshold =
      this.cfg?.resolveSync<number>('dayReport.completenessQualityThreshold', undefined, 0.5) ?? 0.5;
    const reportCompleteness =
      row.kind === 'evening'
        ? computeReportCompleteness({ qualityScore, dones, notDone, blockers, ideas }, threshold)
        : null;
    return {
      id: row.id,
      tenantId: row.tenantId,
      personId: row.personId,
      kind: row.kind === 'evening' ? 'evening' : 'morning',
      dateLocal: row.dateLocal,
      source,
      plans: Array.isArray(row.plansJson) ? (row.plansJson as DailyCheckInDto['plans']) : [],
      dones,
      blockers,
      notDone,
      ideas,
      reportCompleteness,
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
