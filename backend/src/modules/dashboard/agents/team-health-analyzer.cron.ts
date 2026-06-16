import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  withPeopleHypothesisGuard,
  withToneConfidenceCalibration,
} from '../../ai/services/prompts/common';
import { TeamHealthService, type TeamHealthRowDto } from '../services/team-health.service';

/**
 * Pulse Wave 3 §3.1 — Team-Health-Analyzer cron.
 *
 * Источник: plans/tz/2026-05-30-pulse-full.md §3.1.
 *
 * Ежедневный (`@Cron('30 4 * * *')`) обход всех Org. По каждому отделу с
 * cohort ≥ 3 (`!team.belowCohort`) формируем «факты» (sentiment / promises /
 * conflicts / decisions) поверх готового `TeamHealthService.getHealth` и
 * одним LLM-вызовом `team-health-analyzer` собираем 5-осей факторов
 * вовлечённости (low/medium/high) + summary. Результат пишем в
 * `Department.healthSummaryJson` (упрощённая аналитика для UI Pulse).
 *
 * Принципы (см. §0.5 и Приложение А ТЗ):
 *   - cache-friendly: стабильный SYSTEM, переменные данные в КОНЦЕ user.
 *   - не называем имена сотрудников в summary (анти-доксинг).
 *   - best-effort: ошибка по одной Org/отделу не валит общий проход.
 *   - JSON-strict ответ через `responseFormat: json_schema` (см.
 *     `LlmFormatNotSupportedError` — провайдер сам fallback'ится в цепочке).
 *
 * Master-flag: пока нет — фича дешёвая (1 вызов per dept ≤ 1 раз в сутки),
 * можно включить kill-switch отдельным config'ом позже.
 */
// A9 (2026-06-10): факторы вовлечённости — оценка ТОНА/настроения команды по
// наблюдаемым сигналам. Тональная шкала уверенности (`withToneConfidenceCalibration`)
// дописывается в КОНЕЦ SYSTEM (cache-friendly): даёт модели правило
// «тон — наблюдаемое поведение, не диагноз; при сомнении снижай оценку».
// A5 (2026-06-10): факторы вовлечённости — это оценка людей (команды/руководителя),
// поэтому поверх тональной шкалы дописываем `withPeopleHypothesisGuard` в самый
// КОНЕЦ SYSTEM (cache-friendly) — оценки человека остаются гипотезами по
// наблюдаемому поведению, а не вердиктом.
const TEAM_HEALTH_SYSTEM_PROMPT = withPeopleHypothesisGuard(
  withToneConfidenceCalibration(`Ты — аналитик корпоративной культуры. На вход — сводка по отделу за последние 14 дней. Оцени 5 факторов вовлечённости команды по шкале low/medium/high:

1. manager_support — есть ли поддержка от руководителя (recognition, 1-on-1, четкий приоритет)
2. workload_fairness — справедливое распределение нагрузки (нет переработок, monologue)
3. communication — открытость общения (вопросы, обсуждения, конфликты резолвятся)
4. time_pressure — давление по срокам (overdue, missed commitments)
5. role_clarity — ясность ролей (нет конфликтов, есть прогресс)

Жёсткие правила:
- Опирайся ТОЛЬКО на данные в сводке. Не додумывай.
- Верни строго JSON: { factors: { manager_support, workload_fairness, communication, time_pressure, role_clarity }, summary: "1-2 предложения на русском" }.
- summary — НЕ называй имена сотрудников, говори общими формулировками («команда», «руководитель», «несколько участников»).`),
);

const TEAM_HEALTH_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    factors: {
      type: 'object',
      additionalProperties: false,
      properties: {
        manager_support: { type: 'string', enum: ['low', 'medium', 'high'] },
        workload_fairness: { type: 'string', enum: ['low', 'medium', 'high'] },
        communication: { type: 'string', enum: ['low', 'medium', 'high'] },
        time_pressure: { type: 'string', enum: ['low', 'medium', 'high'] },
        role_clarity: { type: 'string', enum: ['low', 'medium', 'high'] },
      },
      required: [
        'manager_support',
        'workload_fairness',
        'communication',
        'time_pressure',
        'role_clarity',
      ],
    },
    summary: { type: 'string' },
  },
  required: ['factors', 'summary'],
};

interface ParsedHealthAnalysis {
  factors: {
    manager_support: 'low' | 'medium' | 'high';
    workload_fairness: 'low' | 'medium' | 'high';
    communication: 'low' | 'medium' | 'high';
    time_pressure: 'low' | 'medium' | 'high';
    role_clarity: 'low' | 'medium' | 'high';
  };
  summary: string;
}

@Injectable()
export class TeamHealthAnalyzerCron {
  private readonly logger = new Logger(TeamHealthAnalyzerCron.name);
  /** Жёсткий лимит на размер выборки Org-ов за прогон (страхуем worker memory). */
  private static readonly MAX_ORGS_PER_RUN = 5_000;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(TeamHealthService) private readonly teamHealth: TeamHealthService,
  ) {}

  /** Daily в 04:30 UTC. */
  @Cron('30 4 * * *')
  async run(): Promise<void> {
    try {
      const stats = await this.runOnce();
      this.logger.debug(stats, 'team-health-analyzer.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        `team-health-analyzer.cron fail: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async runOnce(): Promise<{
    orgsProcessed: number;
    deptsProcessed: number;
    deptsAnalyzed: number;
    errors: number;
  }> {
    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
      take: TeamHealthAnalyzerCron.MAX_ORGS_PER_RUN,
    });

    let orgsProcessed = 0;
    let deptsProcessed = 0;
    let deptsAnalyzed = 0;
    let errors = 0;

    for (const org of orgs) {
      orgsProcessed++;
      try {
        const health = await this.teamHealth.getHealth({ tenantId: org.id });
        for (const team of health.teams) {
          deptsProcessed++;
          if (team.belowCohort) continue;

          try {
            const factsText = this.formatTeamFacts(team);
            const out = await this.llm.call({
              taskType: 'team-health-analyzer',
              tenantId: org.id,
              systemPrompt: TEAM_HEALTH_SYSTEM_PROMPT,
              userMessage: factsText,
              sourceRef: { type: 'department', id: team.departmentId },
              maxTokens: 800,
              responseFormat: {
                type: 'json_schema',
                name: 'TeamHealthFactors',
                schema: TEAM_HEALTH_JSON_SCHEMA,
                strict: true,
              },
            });
            const parsed = this.parseResponse(out.text);
            if (!parsed) continue;

            await this.prisma.department.update({
              where: { id: team.departmentId },
              data: {
                healthSummaryJson: {
                  factors: parsed.factors,
                  summary: parsed.summary,
                  generatedAt: new Date().toISOString(),
                  provenance: { sourceIds: [team.departmentId] },
                } as unknown as Prisma.InputJsonValue,
              },
            });
            deptsAnalyzed++;
          } catch (err) {
            errors++;
            this.logger.warn(
              `team-health-analyzer dept ${team.departmentId}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      } catch (err) {
        errors++;
        this.logger.warn(
          `team-health-analyzer org ${org.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { orgsProcessed, deptsProcessed, deptsAnalyzed, errors };
  }

  /**
   * Формат «фактов команды» — стабильный текст, переменные данные внизу (правило
   * cache-friendly). На вход — одна строка `TeamHealthRowDto` из агрегата.
   */
  private formatTeamFacts(team: TeamHealthRowDto): string {
    const promisesDelta =
      team.promises.delta === null || team.promises.delta === undefined
        ? 'нет данных'
        : `${team.promises.delta > 0 ? '+' : ''}${team.promises.delta}%`;
    return [
      `Команда «${team.departmentName}», размер ${team.size} человек.`,
      ``,
      `Сводка за 14 дней:`,
      `- Sentiment (настроение): индекс ${team.sentiment.value} (-100..+100), тон ${team.sentiment.tone}.`,
      `- Обещания (надёжность): ${team.promises.value}%, тон ${team.promises.tone}, изменение к прошлым 14 дням: ${promisesDelta}.`,
      `- Конфликты: ${team.conflicts.value} пар, тон ${team.conflicts.tone}.`,
      `- Решения: ${team.decisions.value} (placeholder, per-dept ещё не считаем).`,
    ].join('\n');
  }

  private parseResponse(text: string): ParsedHealthAnalysis | null {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('factors' in parsed) ||
        !('summary' in parsed)
      ) {
        return null;
      }
      const factors = (parsed as { factors: unknown }).factors;
      const summary = (parsed as { summary: unknown }).summary;
      if (typeof factors !== 'object' || factors === null) return null;
      if (typeof summary !== 'string') return null;
      return parsed as ParsedHealthAnalysis;
    } catch {
      return null;
    }
  }
}
