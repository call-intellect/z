import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { CommitmentReliabilityService } from '../../dashboard/services/commitment-reliability.service';

export interface PersonPulseMoodPointDto {
  date: string;
  sentiment: 'green' | 'yellow' | 'red' | null;
  qualityScore: number | null;
}

export interface PersonPulseHrSuggestionDto {
  type: 'praise' | 'compensation_review' | 'workload_check' | 'development' | 'urgent_talk';
  text: string;
  signals: string[];
  confidence: number;
}

export interface PersonPulseRiskFlagDto {
  type: string;
  severity: 'low' | 'medium' | 'high';
  baseline: number;
  current: number;
  explanation: string;
}

export interface PersonPulseDto {
  personId: string;
  personName: string;
  email: string;
  viewedUserId: string | null;
  departmentName: string | null;
  isHead: boolean;
  lastOneOnOneAt: string | null;
  engagementScore: number | null;
  engagementScoreAt: string | null;
  hrSuggestions: PersonPulseHrSuggestionDto[] | null;
  hrSuggestionsGeneratedAt: string | null;
  moodTrend30d: PersonPulseMoodPointDto[];
  checkInsTotal30d: number;
  checkInsExpectedDays: number;
  promisesReliabilityPercent: number;
  promisesDelta14d: number | null;
  promisesKept14d: number;
  promisesBroken14d: number;
  promisesOverdue14d: number;
  riskFlags: PersonPulseRiskFlagDto[];
  riskFlagsGeneratedAt: string | null;
}

@Injectable()
export class PersonPulseService {
  private readonly logger = new Logger(PersonPulseService.name);
  private static readonly CACHE_TTL_SEC = 5 * 60;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(CommitmentReliabilityService)
    private readonly commits: CommitmentReliabilityService,
  ) {}

  async getPulse(args: {
    tenantId: string;
    personId: string;
    forSelf?: boolean;
  }): Promise<PersonPulseDto> {
    const cacheKey = `person_pulse:${args.tenantId}:${args.personId}:${
      args.forSelf ? 'self' : 'mgr'
    }`;
    const cached = await this.tryReadCache(cacheKey);
    if (cached) return cached;

    const person = await this.prisma.person.findFirst({
      where: { id: args.personId, tenantId: args.tenantId, deletedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        userId: true,
        engagementScore: true,
        engagementScoreAt: true,
        hrSuggestionsJson: true,
        riskFlagsJson: true,
        primaryDepartment: {
          select: { id: true, name: true, headPersonId: true },
        },
      },
    });
    if (!person) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'person_not_found', message: 'Сотрудник не найден' },
      });
    }

    const now = new Date();
    const since30d = new Date(now.getTime() - 30 * 24 * 3600 * 1000);

    const [checkIns30d, promisesRes] = await Promise.all([
      this.prisma.dailyCheckIn.findMany({
        where: {
          tenantId: args.tenantId,
          personId: person.id,
          createdAt: { gte: since30d },
        },
        select: {
          createdAt: true,
          dateLocal: true,
          sentiment: true,
          qualityScore: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.commits.getReliability({
        tenantId: args.tenantId,
        scope: 'person',
        scopeId: person.id,
        windowDays: 14,
      }),
    ]);

    const moodTrend30d: PersonPulseMoodPointDto[] = checkIns30d.map((c) => ({
      date: c.dateLocal ?? c.createdAt.toISOString().slice(0, 10),
      sentiment: this.normalizeSentiment(c.sentiment),
      qualityScore: c.qualityScore === null ? null : Number(c.qualityScore),
    }));

    const parsedHr = this.parseHrSuggestions(person.hrSuggestionsJson);
    const hrSuggestions = args.forSelf ? null : parsedHr.hrSuggestions;
    const hrSuggestionsGeneratedAt = args.forSelf ? null : parsedHr.hrSuggestionsGeneratedAt;
    const { riskFlags, riskFlagsGeneratedAt } = this.parseRiskFlags(person.riskFlagsJson);

    const result: PersonPulseDto = {
      personId: person.id,
      personName: person.name,
      email: person.email,
      viewedUserId: person.userId ?? null,
      departmentName: person.primaryDepartment?.name ?? null,
      isHead:
        person.primaryDepartment !== null && person.primaryDepartment.headPersonId === person.id,
      lastOneOnOneAt: null,
      engagementScore: person.engagementScore === null ? null : Number(person.engagementScore),
      engagementScoreAt: person.engagementScoreAt?.toISOString() ?? null,
      hrSuggestions,
      hrSuggestionsGeneratedAt,
      moodTrend30d,
      checkInsTotal30d: checkIns30d.length,
      checkInsExpectedDays: 30,
      promisesReliabilityPercent: promisesRes.reliabilityPercent,
      promisesDelta14d: promisesRes.delta14d,
      promisesKept14d: promisesRes.kept,
      promisesBroken14d: promisesRes.broken,
      promisesOverdue14d: promisesRes.overdue,
      riskFlags,
      riskFlagsGeneratedAt,
    };

    await this.tryWriteCache(cacheKey, result);
    return result;
  }

  private normalizeSentiment(raw: string | null): 'green' | 'yellow' | 'red' | null {
    if (raw === 'green' || raw === 'yellow' || raw === 'red') return raw;
    return null;
  }

  private parseHrSuggestions(raw: unknown): {
    hrSuggestions: PersonPulseHrSuggestionDto[] | null;
    hrSuggestionsGeneratedAt: string | null;
  } {
    if (!raw || typeof raw !== 'object') {
      return { hrSuggestions: null, hrSuggestionsGeneratedAt: null };
    }
    const obj = raw as {
      recommendations?: unknown;
      generatedAt?: unknown;
    };
    const generatedAt = typeof obj.generatedAt === 'string' ? obj.generatedAt : null;
    if (!Array.isArray(obj.recommendations)) {
      return { hrSuggestions: null, hrSuggestionsGeneratedAt: generatedAt };
    }
    const result: PersonPulseHrSuggestionDto[] = [];
    for (const item of obj.recommendations) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      const type = r.type;
      if (
        type !== 'praise' &&
        type !== 'compensation_review' &&
        type !== 'workload_check' &&
        type !== 'development' &&
        type !== 'urgent_talk'
      ) {
        continue;
      }
      const text = typeof r.text === 'string' ? r.text : '';
      const signals = Array.isArray(r.signals)
        ? r.signals.filter((s): s is string => typeof s === 'string')
        : [];
      const confidence =
        typeof r.confidence === 'number' && Number.isFinite(r.confidence) ? r.confidence : 0;
      result.push({ type, text, signals, confidence });
    }
    return {
      hrSuggestions: result.length > 0 ? result : null,
      hrSuggestionsGeneratedAt: generatedAt,
    };
  }

  private parseRiskFlags(raw: unknown): {
    riskFlags: PersonPulseRiskFlagDto[];
    riskFlagsGeneratedAt: string | null;
  } {
    if (!raw || typeof raw !== 'object') {
      return { riskFlags: [], riskFlagsGeneratedAt: null };
    }
    const obj = raw as { flags?: unknown; generatedAt?: unknown };
    const generatedAt = typeof obj.generatedAt === 'string' ? obj.generatedAt : null;
    if (!Array.isArray(obj.flags)) {
      return { riskFlags: [], riskFlagsGeneratedAt: generatedAt };
    }
    const result: PersonPulseRiskFlagDto[] = [];
    for (const item of obj.flags) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      const type = typeof r.type === 'string' ? r.type : null;
      const sev = r.severity;
      const severity = sev === 'low' || sev === 'medium' || sev === 'high' ? sev : null;
      const baseline =
        typeof r.baseline === 'number' && Number.isFinite(r.baseline) ? r.baseline : null;
      const current =
        typeof r.current === 'number' && Number.isFinite(r.current) ? r.current : null;
      const explanation = typeof r.explanation === 'string' ? r.explanation : null;
      if (!type || !severity || baseline === null || current === null || !explanation) {
        continue;
      }
      result.push({ type, severity, baseline, current, explanation });
    }
    return { riskFlags: result, riskFlagsGeneratedAt: generatedAt };
  }

  private async tryReadCache(key: string): Promise<PersonPulseDto | null> {
    try {
      const raw = await this.redis.client.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as PersonPulseDto;
    } catch (err) {
      this.logger.warn(
        `Redis get failed for ${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private async tryWriteCache(key: string, dto: PersonPulseDto): Promise<void> {
    try {
      await this.redis.client.set(key, JSON.stringify(dto), 'EX', PersonPulseService.CACHE_TTL_SEC);
    } catch (err) {
      this.logger.warn(
        `Redis set failed for ${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
