import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { CommitmentReliabilityService } from '../../dashboard/services/commitment-reliability.service';

/**
 * PersonPulseService (Pulse Wave 3 §3.4 + §3.6 + §3.8).
 *
 * Read-only агрегат для карточки сотрудника `/persons/:id/pulse`. Собирает
 * данные нескольких источников:
 *   - Person.engagementScore / engagementScoreAt (Engagement-Scorer cron, §3.3).
 *   - Person.hrSuggestionsJson (HR-Recommender cron, §3.7).
 *   - DailyCheckIn за 30 дней (sentiment + qualityScore от Reflection-Quality-Scorer §3.5).
 *   - CommitmentReliabilityService (обещания за 14 дней, §1.1).
 *
 * Кэш — Redis с TTL 5 минут. Ошибки Redis не валят запрос — считаем live.
 */

/** Точка mood-trend графика (один DailyCheckIn за день). */
export interface PersonPulseMoodPointDto {
  /** YYYY-MM-DD (локальная дата чек-ина). */
  date: string;
  /** Настроение: 'green' | 'yellow' | 'red' | null если LLM не определил. */
  sentiment: 'green' | 'yellow' | 'red' | null;
  /** Качество рефлексии 0..1 (Reflection-Quality-Scorer). null до прогона. */
  qualityScore: number | null;
}

/** Одна HR-рекомендация (из `Person.hrSuggestionsJson.recommendations`). */
export interface PersonPulseHrSuggestionDto {
  type: 'praise' | 'compensation_review' | 'workload_check' | 'development' | 'urgent_talk';
  text: string;
  signals: string[];
  confidence: number;
}

/**
 * Pulse Wave 4 §4.5 — один активный risk-flag из `Person.riskFlagsJson.flags`.
 *
 * `type` — литерал строкой (см. список в `burnout-risk-detector.cron.ts`).
 * `baseline` / `current` — числа в шкале, специфичной для типа (проценты для
 * sentiment, абсолютные count'ы для остальных).
 */
export interface PersonPulseRiskFlagDto {
  type: string;
  severity: 'low' | 'medium' | 'high';
  baseline: number;
  current: number;
  explanation: string;
}

/** Главное DTO endpoint'а `GET /api/v1/persons/:id/pulse`. */
export interface PersonPulseDto {
  personId: string;
  personName: string;
  email: string;
  /**
   * User.id, к которому привязан Person (после accept'а приглашения). Используется
   * для фильтра ленты «Вопросы AI этому человеку» (`PersonProbeQuestionsSection`,
   * см. `activityFeedApi.list({viewedUserId})`). NULL — Person ещё не
   * зарегистрировался; вопросы AI отправляются только зарегистрированным.
   */
  viewedUserId: string | null;
  departmentName: string | null;
  /** true если этот Person — глава своего primaryDepartment'а. */
  isHead: boolean;
  /** @deprecated v1 placeholder — интеграция с calendar отложена (vNext). Всегда null, на UI не выводится. */
  lastOneOnOneAt: string | null;
  /** Engagement score 0..1 (Engagement-Scorer cron). null до первого прогона. */
  engagementScore: number | null;
  engagementScoreAt: string | null;
  /** HR Recommender suggestions (weekly). null до первого weekly-прогона. */
  hrSuggestions: PersonPulseHrSuggestionDto[] | null;
  hrSuggestionsGeneratedAt: string | null;
  /** Mood trend за 30 дней. */
  moodTrend30d: PersonPulseMoodPointDto[];
  /** Кол-во чек-инов за 30 дней (числитель регулярности). */
  checkInsTotal30d: number;
  /** Ожидаемое кол-во дней (30, знаменатель регулярности). */
  checkInsExpectedDays: number;
  /** Reliability обещаний адресованных этому человеку, 0..100%. */
  promisesReliabilityPercent: number;
  /** Дельта reliability vs предыдущее окно той же длины. null если знаменатель прошлого окна = 0. */
  promisesDelta14d: number | null;
  promisesKept14d: number;
  promisesBroken14d: number;
  promisesOverdue14d: number;
  /**
   * Pulse Wave 4 §4.5 — активные risk-флаги (Burnout-Risk-Detector cron).
   * Пустой массив если флагов нет; никогда не null (нет «не считалось» —
   * cron daily гарантирует свежесть). `riskFlagsGeneratedAt` = null до
   * первого прогона cron'а.
   */
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

  /**
   * Главный публичный метод. Кэш на 5 минут per (tenantId, personId).
   * Бросает NotFoundException если Person не существует / не в tenant'е /
   * soft-deleted.
   */
  async getPulse(args: {
    tenantId: string;
    personId: string;
  }): Promise<PersonPulseDto> {
    const cacheKey = `person_pulse:${args.tenantId}:${args.personId}`;
    const cached = await this.tryReadCache(cacheKey);
    if (cached) return cached;

    const person = await this.prisma.person.findFirst({
      where: { id: args.personId, tenantId: args.tenantId, deletedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        // User.id, к которому привязан Person (после accept'а приглашения).
        // Нужен для фильтра ленты «Вопросы AI этому человеку» на карточке.
        userId: true,
        engagementScore: true,
        engagementScoreAt: true,
        hrSuggestionsJson: true,
        // Pulse Wave 4 §4.5 — активные risk-флаги (Burnout-Risk-Detector cron).
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

    const { hrSuggestions, hrSuggestionsGeneratedAt } =
      this.parseHrSuggestions(person.hrSuggestionsJson);
    const { riskFlags, riskFlagsGeneratedAt } = this.parseRiskFlags(
      person.riskFlagsJson,
    );

    const result: PersonPulseDto = {
      personId: person.id,
      personName: person.name,
      email: person.email,
      viewedUserId: person.userId ?? null,
      departmentName: person.primaryDepartment?.name ?? null,
      isHead:
        person.primaryDepartment !== null &&
        person.primaryDepartment.headPersonId === person.id,
      /** @deprecated v1 placeholder — интеграция с calendar отложена (vNext). Всегда null, на UI не выводится. */
      lastOneOnOneAt: null,
      engagementScore:
        person.engagementScore === null ? null : Number(person.engagementScore),
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

  // ─────────────────────────── private ──────────────────────────────

  private normalizeSentiment(
    raw: string | null,
  ): 'green' | 'yellow' | 'red' | null {
    if (raw === 'green' || raw === 'yellow' || raw === 'red') return raw;
    return null;
  }

  /**
   * Парсит `Person.hrSuggestionsJson`. Терпим к мусору — если структура
   * сломана, возвращаем null. Формат — см. `HrRecommenderCron`.
   */
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
    const generatedAt =
      typeof obj.generatedAt === 'string' ? obj.generatedAt : null;
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
        typeof r.confidence === 'number' && Number.isFinite(r.confidence)
          ? r.confidence
          : 0;
      result.push({ type, text, signals, confidence });
    }
    return {
      hrSuggestions: result.length > 0 ? result : null,
      hrSuggestionsGeneratedAt: generatedAt,
    };
  }

  /**
   * Парсит `Person.riskFlagsJson`. Терпим к мусору — если структура сломана,
   * возвращаем пустой массив. Формат — см. `BurnoutRiskDetectorCron`.
   */
  private parseRiskFlags(raw: unknown): {
    riskFlags: PersonPulseRiskFlagDto[];
    riskFlagsGeneratedAt: string | null;
  } {
    if (!raw || typeof raw !== 'object') {
      return { riskFlags: [], riskFlagsGeneratedAt: null };
    }
    const obj = raw as { flags?: unknown; generatedAt?: unknown };
    const generatedAt =
      typeof obj.generatedAt === 'string' ? obj.generatedAt : null;
    if (!Array.isArray(obj.flags)) {
      return { riskFlags: [], riskFlagsGeneratedAt: generatedAt };
    }
    const result: PersonPulseRiskFlagDto[] = [];
    for (const item of obj.flags) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      const type = typeof r.type === 'string' ? r.type : null;
      const sev = r.severity;
      const severity =
        sev === 'low' || sev === 'medium' || sev === 'high' ? sev : null;
      const baseline =
        typeof r.baseline === 'number' && Number.isFinite(r.baseline)
          ? r.baseline
          : null;
      const current =
        typeof r.current === 'number' && Number.isFinite(r.current)
          ? r.current
          : null;
      const explanation =
        typeof r.explanation === 'string' ? r.explanation : null;
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

  private async tryWriteCache(
    key: string,
    dto: PersonPulseDto,
  ): Promise<void> {
    try {
      await this.redis.client.set(
        key,
        JSON.stringify(dto),
        'EX',
        PersonPulseService.CACHE_TTL_SEC,
      );
    } catch (err) {
      this.logger.warn(
        `Redis set failed for ${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
