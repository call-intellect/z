import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import {
  type PeopleAtRiskItem,
  type PeopleAtRiskResponse,
} from '../dto/people-at-risk.dto';

import { CommitmentReliabilityService } from './commitment-reliability.service';

const CACHE_TTL_SECONDS = 5 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;
const RED_MOOD_WINDOW_DAYS = 30;
const RELIABILITY_WINDOW_DAYS = 14;

/**
 * Человекочитаемые причины по типам risk-флагов (`Person.riskFlagsJson.flags`,
 * пишет `BurnoutRiskDetectorCron`). Если тип флага неизвестен — падаем на общий
 * fallback причины (см. `computeTopReason`).
 */
const RISK_REASON_RU: Record<string, string> = {
  sentiment_dip: 'Настроение падает — стоит спросить, как дела',
  reply_latency_rise: 'Реже отвечает в чатах — возможно, перегружен',
  missed_checkins: 'Пропускает чек-ины — предложите поддержку',
  broken_promises: 'Не успевает по обещаниям — помогите с приоритетами',
  workload_overload: 'Признаки перегрузки — обсудите нагрузку',
  meeting_noshows: 'Пропускает встречи — уточните, что мешает',
  conflict_mentions: 'Упоминания напряжения — стоит поговорить 1:1',
};

const SEVERITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

/** Пороги расчёта (читаются из AdminSetting с code-fallback). */
export interface PeopleAtRiskThresholds {
  overduePenaltyPerItem: number;
  overduePenaltyCap: number;
  redMoodShareThreshold: number;
  redMoodPenalty: number;
  riskThreshold: number;
}

/** Вход чистой функции `computePulseScore` — детерминированный, без БД. */
export interface PulseScoreInput {
  engagementScore: number | null;
  overdue14d: number;
  redShare30d: number;
}

/** Вход чистой функции `computeTopReason`. */
export interface TopReasonInput {
  riskFlagsJson: unknown;
  overdue14d: number;
  penOverdue: number;
  penMood: number;
}

interface RiskFlagParsed {
  type: string;
  severity: string;
}

function clamp(min: number, max: number, value: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Терпимый парсер `Person.riskFlagsJson`. Ожидаемая структура —
 * `{ flags: Array<{type, severity}> }`. Всё, что не подходит, → `[]`.
 * Флаги в массиве считаются АКТИВНЫМИ: cron перезаписывает массив целиком,
 * неактивных сигналов там нет.
 */
export function parseRiskFlags(raw: unknown): RiskFlagParsed[] {
  if (!raw || typeof raw !== 'object') return [];
  const flags = (raw as { flags?: unknown }).flags;
  if (!Array.isArray(flags)) return [];
  const result: RiskFlagParsed[] = [];
  for (const f of flags) {
    if (!f || typeof f !== 'object') continue;
    const type = (f as { type?: unknown }).type;
    const severity = (f as { severity?: unknown }).severity;
    if (typeof type !== 'string' || type.length === 0) continue;
    result.push({
      type,
      severity: typeof severity === 'string' ? severity : 'low',
    });
  }
  return result;
}

/**
 * Чистый расчёт штрафа за просрочки: `min(cap, overdue14d * perItem)`.
 */
export function computeOverduePenalty(
  overdue14d: number,
  thresholds: Pick<
    PeopleAtRiskThresholds,
    'overduePenaltyPerItem' | 'overduePenaltyCap'
  >,
): number {
  return Math.min(
    thresholds.overduePenaltyCap,
    overdue14d * thresholds.overduePenaltyPerItem,
  );
}

/**
 * Чистый расчёт штрафа за настроение: `redMoodPenalty`, если доля «красных»
 * чек-инов за 30 дней >= порога; иначе 0.
 */
export function computeMoodPenalty(
  redShare30d: number,
  thresholds: Pick<
    PeopleAtRiskThresholds,
    'redMoodShareThreshold' | 'redMoodPenalty'
  >,
): number {
  return redShare30d >= thresholds.redMoodShareThreshold
    ? thresholds.redMoodPenalty
    : 0;
}

/**
 * Чистая формула `pulseScore` (0..100). База — engagementScore×100 (или 50,
 * если null), минус штрафы за просрочки и настроение, зажато в [0,100].
 */
export function computePulseScore(
  input: PulseScoreInput,
  thresholds: PeopleAtRiskThresholds,
): number {
  const base =
    input.engagementScore == null
      ? 50
      : Math.round(Number(input.engagementScore) * 100);
  const penOverdue = computeOverduePenalty(input.overdue14d, thresholds);
  const penMood = computeMoodPenalty(input.redShare30d, thresholds);
  return Math.floor(clamp(0, 100, base - penOverdue - penMood));
}

/**
 * Чистый выбор человекочитаемой причины риска (приоритет сверху вниз):
 *   1) активный risk-флаг высшей severity → RISK_REASON_RU[type]
 *      (неизвестный type → шаг 4);
 *   2) есть штраф за просрочки → «N просроченных обещаний…»;
 *   3) есть штраф за настроение → «Настроение проседает…»;
 *   4) иначе → общий fallback про вовлечённость.
 */
export function computeTopReason(input: TopReasonInput): string {
  const flags = parseRiskFlags(input.riskFlagsJson);
  const top = [...flags].sort(
    (a, b) =>
      (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0),
  )[0];
  if (top) {
    const reason = RISK_REASON_RU[top.type];
    if (reason) return reason;
  }
  if (input.penOverdue > 0) {
    return `${input.overdue14d} просроченных обещаний — помогите расставить приоритеты`;
  }
  if (input.penMood > 0) {
    return 'Настроение проседает — стоит спросить, как дела';
  }
  return 'Вовлечённость ниже обычного — повод для короткого 1:1';
}

interface EmployeeRow {
  id: string;
  name: string;
  engagementScore: unknown;
  engagementScoreAt: Date | null;
  riskFlagsJson: unknown;
  primaryDepartmentId: string | null;
}

/**
 * PeopleAtRiskService (ТЗ-G Фаза 1).
 *
 * Read-only ранжирование «Сотрудники под риском» для главной директора.
 * Только `relationship='employee'`, без финансов, всё с tenantId.
 *
 * Кэш — Redis TTL 5 минут (паттерн `commitment-reliability.service.ts`); на
 * ошибки Redis сервис не падает, а считает live. Просрочки берёт из
 * `CommitmentReliabilityService.computeReliability` (поле `overdue`), доля
 * «красных» чек-инов — батчем по всем сотрудникам (без N+1).
 */
@Injectable()
export class PeopleAtRiskService {
  private readonly logger = new Logger(PeopleAtRiskService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(CommitmentReliabilityService)
    private readonly reliability: CommitmentReliabilityService,
  ) {}

  async getAtRisk(args: {
    tenantId: string;
    limit: number;
    /**
     * userId текущего зрителя. Резолвим его Person в этой Org и исключаем из
     * выборки, чтобы директор не видел сам себя в списке «под риском». Если
     * Person не находится (нет связки userId↔Person) — никого не исключаем.
     */
    viewerUserId?: string | null;
  }): Promise<PeopleAtRiskResponse> {
    const excludePersonId = args.viewerUserId
      ? await this.resolveViewerPersonId(args.tenantId, args.viewerUserId)
      : null;
    return this.compute(
      { tenantId: args.tenantId, limit: args.limit, excludePersonId },
      new Date(),
    );
  }

  /**
   * Person.id текущего зрителя в данной Org по его userId (связка
   * `Person.userId`, образец — `me.service.ts` / `clones.service.ts`).
   * На ошибку БД не падаем — возвращаем null (никого не исключаем).
   */
  private async resolveViewerPersonId(
    tenantId: string,
    userId: string,
  ): Promise<string | null> {
    try {
      const person = await this.prisma.person.findFirst({
        where: { tenantId, userId, deletedAt: null },
        select: { id: true },
      });
      return person?.id ?? null;
    } catch (err) {
      this.logger.warn(
        `resolveViewerPersonId fail (tenantId=${tenantId}, userId=${userId}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  /**
   * Чистая реализация (принимает фиксированный `now`) — упрощает интеграционную
   * проверку детерминизма. Публичный `getAtRisk` фиксирует `now = new Date()`.
   */
  async compute(
    args: { tenantId: string; limit: number; excludePersonId?: string | null },
    now: Date,
  ): Promise<PeopleAtRiskResponse> {
    // excludePersonId входит в ключ — иначе зритель A получит из кэша список,
    // посчитанный для зрителя B (с исключённым чужим personId).
    const cacheKey = `people_at_risk:${args.tenantId}:${args.limit}:${
      args.excludePersonId ?? '_'
    }`;
    const cached = await this.tryReadCache(cacheKey);
    if (cached) return cached;

    const thresholds = await this.readThresholds();

    const employees = (await this.prisma.person.findMany({
      where: {
        tenantId: args.tenantId,
        deletedAt: null,
        relationship: 'employee',
        ...(args.excludePersonId ? { id: { not: args.excludePersonId } } : {}),
      },
      select: {
        id: true,
        name: true,
        engagementScore: true,
        engagementScoreAt: true,
        riskFlagsJson: true,
        primaryDepartmentId: true,
      },
    })) as EmployeeRow[];

    const deptNameById = await this.loadDepartmentNames(
      args.tenantId,
      employees,
    );
    const redShareByPerson = await this.computeRedShares(
      args.tenantId,
      employees,
      now,
    );

    const scored: PeopleAtRiskItem[] = [];
    for (const person of employees) {
      const overdue14d = await this.computeOverdue14d(
        args.tenantId,
        person.id,
        now,
      );
      const redShare30d = redShareByPerson.get(person.id) ?? 0;
      const engagementScore =
        person.engagementScore == null ? null : Number(person.engagementScore);

      const pulseScore = computePulseScore(
        { engagementScore, overdue14d, redShare30d },
        thresholds,
      );
      const penOverdue = computeOverduePenalty(overdue14d, thresholds);
      const penMood = computeMoodPenalty(redShare30d, thresholds);
      const topReason = computeTopReason({
        riskFlagsJson: person.riskFlagsJson,
        overdue14d,
        penOverdue,
        penMood,
      });

      scored.push({
        personId: person.id,
        name: person.name,
        department: person.primaryDepartmentId
          ? (deptNameById.get(person.primaryDepartmentId) ?? null)
          : null,
        pulseScore,
        topReason,
        engagementScoreAt: person.engagementScoreAt
          ? person.engagementScoreAt.toISOString()
          : null,
      });
    }

    const atRisk = scored
      .filter((item) => item.pulseScore < thresholds.riskThreshold)
      .sort((a, b) => a.pulseScore - b.pulseScore);

    const dto: PeopleAtRiskResponse = {
      items: atRisk.slice(0, args.limit),
      totalAtRisk: atRisk.length,
      generatedAt: now.toISOString(),
    };

    await this.tryWriteCache(cacheKey, dto);
    return dto;
  }

  // ---------------------------------------------------------------------------
  // Внутреннее
  // ---------------------------------------------------------------------------

  private async readThresholds(): Promise<PeopleAtRiskThresholds> {
    const [
      overduePenaltyPerItem,
      overduePenaltyCap,
      redMoodShareThreshold,
      redMoodPenalty,
      riskThreshold,
    ] = await Promise.all([
      this.cfg.getDynamic<number>(
        'peopleAtRisk.overduePenaltyPerItem',
        undefined,
        8,
      ),
      this.cfg.getDynamic<number>(
        'peopleAtRisk.overduePenaltyCap',
        undefined,
        30,
      ),
      this.cfg.getDynamic<number>(
        'peopleAtRisk.redMoodShareThreshold',
        undefined,
        0.34,
      ),
      this.cfg.getDynamic<number>('peopleAtRisk.redMoodPenalty', undefined, 15),
      this.cfg.getDynamic<number>('peopleAtRisk.riskThreshold', undefined, 60),
    ]);
    return {
      overduePenaltyPerItem,
      overduePenaltyCap,
      redMoodShareThreshold,
      redMoodPenalty,
      riskThreshold,
    };
  }

  /** Имена отделов одним запросом (без N+1). */
  private async loadDepartmentNames(
    tenantId: string,
    employees: EmployeeRow[],
  ): Promise<Map<string, string>> {
    const ids = Array.from(
      new Set(
        employees
          .map((e) => e.primaryDepartmentId)
          .filter((id): id is string => !!id),
      ),
    );
    const map = new Map<string, string>();
    if (ids.length === 0) return map;
    const departments = await this.prisma.department.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true, name: true },
    });
    for (const d of departments) map.set(d.id, d.name);
    return map;
  }

  /**
   * Доля `sentiment='red'` среди ОТВЕЧЕННЫХ (`completedAt != null`) чек-инов за
   * 30 дней, посчитанная батчем по всем сотрудникам (избегаем N+1: одна
   * выборка, раскладка по personId в JS). Знаменатель — отвеченные чек-ины;
   * если их 0 → доля 0 (штрафа за настроение не будет).
   */
  private async computeRedShares(
    tenantId: string,
    employees: EmployeeRow[],
    now: Date,
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    const personIds = employees.map((e) => e.id);
    if (personIds.length === 0) return result;

    const since = new Date(now.getTime() - RED_MOOD_WINDOW_DAYS * DAY_MS);
    const checkIns = await this.prisma.dailyCheckIn.findMany({
      where: {
        tenantId,
        personId: { in: personIds },
        completedAt: { gte: since, lte: now },
      },
      select: { personId: true, sentiment: true },
    });

    const totals = new Map<string, { answered: number; red: number }>();
    for (const ci of checkIns) {
      const acc = totals.get(ci.personId) ?? { answered: 0, red: 0 };
      acc.answered += 1;
      if (ci.sentiment === 'red') acc.red += 1;
      totals.set(ci.personId, acc);
    }
    for (const [personId, acc] of totals) {
      result.set(personId, acc.answered === 0 ? 0 : acc.red / acc.answered);
    }
    return result;
  }

  /**
   * Просрочки за 14 дней из `CommitmentReliabilityService` (поле `overdue` —
   * обещания со статусом open/asked и истёкшим сроком). scope='person',
   * scopeId=personId; метод принимает `now` явно.
   */
  private async computeOverdue14d(
    tenantId: string,
    personId: string,
    now: Date,
  ): Promise<number> {
    const dto = await this.reliability.computeReliability(
      {
        tenantId,
        scope: 'person',
        scopeId: personId,
        windowDays: RELIABILITY_WINDOW_DAYS,
      },
      now,
    );
    return dto.overdue;
  }

  private async tryReadCache(
    key: string,
  ): Promise<PeopleAtRiskResponse | null> {
    try {
      const raw = await this.redis.client.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as PeopleAtRiskResponse;
    } catch (err) {
      this.logger.warn(
        `Redis get failed for ${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private async tryWriteCache(
    key: string,
    dto: PeopleAtRiskResponse,
  ): Promise<void> {
    try {
      await this.redis.client.set(
        key,
        JSON.stringify(dto),
        'EX',
        CACHE_TTL_SECONDS,
      );
    } catch (err) {
      this.logger.warn(
        `Redis set failed for ${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
