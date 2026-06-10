import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { withConfidenceCalibration } from '../../ai/services/prompts/common';

/**
 * Pulse Wave 3 §3.7 — HR-Recommender cron.
 *
 * Источник: plans/tz/2026-05-30-pulse-full.md §3.7.
 *
 * Weekly (`@Cron('0 6 * * 1')`, понедельник 06:00 UTC) для каждого
 * employee'я собирает сводку сигналов за 14 дней и просит LLM выдать
 * 0..3 рекомендации руководителю в 5 категориях:
 *
 *   - praise              — похвалить за конкретное;
 *   - compensation_review — рассмотреть ЗП-ревью;
 *   - workload_check      — обсудить нагрузку (переработка / простой);
 *   - development         — план развития, новые задачи, обучение;
 *   - urgent_talk         — срочно поговорить (risk-сигналы).
 *
 * Результат пишем в `Person.hrSuggestionsJson` (свежий weekly overwrite —
 * актуально только последнее).
 *
 * Жёсткие правила (см. промпт + ТЗ):
 *   - НЕ называем полное имя в text — «сотрудник», «он/она».
 *   - Только на основе данных в сводке.
 *   - Если данных нет совсем (нет чек-инов / обещаний / recognition) — skip.
 *   - Best-effort: ошибка по одному Person'у не валит остальных.
 *
 * Capable модель (`hr-recommender` → deepseek-v4-pro), JSON-парсинг
 * мягкий (без strict schema — модель может вернуть 0 рекомендаций или
 * добавить optional поля).
 */
// A9 (2026-06-10): у каждой рекомендации есть `confidence` (0..1) — основание,
// показывать ли её руководителю и с каким приоритетом. Базовая шкала
// уверенности (`withConfidenceCalibration`) дописывается в КОНЕЦ SYSTEM
// (cache-friendly), чтобы HR-рекомендации с шаткими сигналами не выдавали
// завышенную уверенность.
const HR_RECOMMENDER_SYSTEM_PROMPT = withConfidenceCalibration(`Ты — HR-консультант. На вход — сводка сигналов про сотрудника за 14 дней. Выдай рекомендации руководителю в 5 категориях:

— praise (похвалить за конкретное)
— compensation_review (рассмотреть ЗП-ревью)
— workload_check (обсудить нагрузку — переработка или простой)
— development (план развития, новые задачи, обучение)
— urgent_talk (срочно поговорить — risk-сигналы)

Жёсткие правила:
- Выводи только релевантные категории (можешь вернуть 0-3 рекомендации, не обязательно 5).
- Каждая рекомендация имеет: type, text (1-2 предложения на русском), signals (массив строк — какие сигналы легли в основу), confidence (0..1).
- НЕ называй полное имя сотрудника в text, говори «сотрудник» или «он/она».
- Только на основе данных в сводке. Не выдумывай.
- Верни строго JSON: { recommendations: [...] }.`);

const HR_RECOMMENDER_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: {
            type: 'string',
            enum: [
              'praise',
              'compensation_review',
              'workload_check',
              'development',
              'urgent_talk',
            ],
          },
          text: { type: 'string' },
          signals: { type: 'array', items: { type: 'string' } },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['type', 'text', 'signals', 'confidence'],
      },
    },
  },
  required: ['recommendations'],
};

interface ParsedRecommendation {
  type:
    | 'praise'
    | 'compensation_review'
    | 'workload_check'
    | 'development'
    | 'urgent_talk';
  text: string;
  signals: string[];
  confidence: number;
}

interface ParsedHrResponse {
  recommendations: ParsedRecommendation[];
}

@Injectable()
export class HrRecommenderCron {
  private readonly logger = new Logger(HrRecommenderCron.name);
  private static readonly WINDOW_14D_MS = 14 * 24 * 3600 * 1000;
  /** Максимум employee'ев за прогон (страхуем budget LLM). */
  private static readonly MAX_PER_RUN = 5_000;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
  ) {}

  /** Weekly Monday 06:00 UTC. */
  @Cron('0 6 * * 1')
  async run(): Promise<void> {
    try {
      const stats = await this.runOnce();
      this.logger.log(stats, 'hr-recommender.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        `hr-recommender.cron fail: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async runOnce(): Promise<{
    personsAnalyzed: number;
    personsSkippedNoData: number;
    errors: number;
  }> {
    const persons = await this.prisma.person.findMany({
      where: { deletedAt: null, relationship: 'employee' },
      select: {
        id: true,
        tenantId: true,
        userId: true,
        engagementScore: true,
      },
      take: HrRecommenderCron.MAX_PER_RUN,
    });

    let personsAnalyzed = 0;
    let personsSkippedNoData = 0;
    let errors = 0;

    for (const person of persons) {
      try {
        const factsText = await this.collectFacts(person);
        if (!factsText) {
          personsSkippedNoData++;
          continue;
        }

        const out = await this.llm.call({
          taskType: 'hr-recommender',
          tenantId: person.tenantId,
          systemPrompt: HR_RECOMMENDER_SYSTEM_PROMPT,
          userMessage: factsText,
          sourceRef: { type: 'person', id: person.id },
          maxTokens: 1000,
          responseFormat: {
            type: 'json_schema',
            name: 'HrRecommenderResponse',
            schema: HR_RECOMMENDER_JSON_SCHEMA,
            strict: true,
          },
        });

        const parsed = this.parseResponse(out.text);
        if (!parsed) continue;

        await this.prisma.person.update({
          where: { id: person.id },
          data: {
            hrSuggestionsJson: {
              recommendations: parsed.recommendations,
              generatedAt: new Date().toISOString(),
            } as unknown as Prisma.InputJsonValue,
          },
        });
        personsAnalyzed++;
      } catch (err) {
        errors++;
        this.logger.warn(
          `hr-recommender person ${person.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { personsAnalyzed, personsSkippedNoData, errors };
  }

  /**
   * Собирает «факты сотрудника» за 14 дней (чек-ины, обещания, recognition).
   * Возвращает null, если данных совсем нет (нечего рекомендовать).
   */
  private async collectFacts(person: {
    id: string;
    tenantId: string;
    userId: string | null;
    engagementScore: Prisma.Decimal | null;
  }): Promise<string | null> {
    const since14 = new Date(Date.now() - HrRecommenderCron.WINDOW_14D_MS);

    const [checkIns, commits, recognition] = await Promise.all([
      this.prisma.dailyCheckIn.findMany({
        where: { personId: person.id, createdAt: { gte: since14 } },
        select: { sentiment: true, createdAt: true },
      }),
      this.prisma.ideaBlock.findMany({
        where: {
          tenantId: person.tenantId,
          signalType: 'commitment',
          commitmentRecipientPersonId: person.id,
          commitmentDueDate: { gte: since14 },
        },
        select: { commitmentStatus: true, name: true },
      }),
      // Recognition events: targetUserId — это User.id, поэтому фильтруем
      // только если у Person'а есть привязанный User.
      person.userId
        ? this.prisma.activityFeedItem.findMany({
            where: {
              tenantId: person.tenantId,
              feedType: 'recognition',
              targetUserId: person.userId,
              emittedAt: { gte: since14 },
            },
            select: { title: true },
            take: 10,
          })
        : Promise.resolve(
            [] as Array<{ title: string }>,
          ),
    ]);

    if (checkIns.length === 0 && commits.length === 0 && recognition.length === 0) {
      return null;
    }

    const lines: string[] = [];
    lines.push(`Сотрудник за 14 дней:`);
    if (person.engagementScore) {
      lines.push(
        `Engagement score: ${Number(person.engagementScore).toFixed(2)} (0..1).`,
      );
    }
    lines.push('');
    const greenCount = checkIns.filter((c) => c.sentiment === 'green').length;
    const redCount = checkIns.filter((c) => c.sentiment === 'red').length;
    lines.push(
      `Чек-ины: всего ${checkIns.length}, green ${greenCount}, red ${redCount}.`,
    );
    if (commits.length > 0) {
      const kept = commits.filter((c) => c.commitmentStatus === 'fulfilled').length;
      const broken = commits.filter((c) => c.commitmentStatus === 'missed').length;
      lines.push(
        `Обещания: ${commits.length} всего, выполнено ${kept}, провалено ${broken}.`,
      );
    }
    if (recognition.length > 0) {
      const topThree = recognition.slice(0, 3).map((r) => r.title).join('; ');
      lines.push(`Получил похвалу: ${recognition.length} раз. Темы: ${topThree}.`);
    }

    return lines.join('\n');
  }

  private parseResponse(text: string): ParsedHrResponse | null {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        !('recommendations' in parsed)
      ) {
        return null;
      }
      const recs = (parsed as { recommendations: unknown }).recommendations;
      if (!Array.isArray(recs)) return null;
      // Минимальная проверка элементов — детальную делает strict schema провайдера.
      for (const r of recs) {
        if (
          typeof r !== 'object' ||
          r === null ||
          typeof (r as Record<string, unknown>)['type'] !== 'string' ||
          typeof (r as Record<string, unknown>)['text'] !== 'string'
        ) {
          return null;
        }
      }
      return parsed as ParsedHrResponse;
    } catch {
      return null;
    }
  }
}
