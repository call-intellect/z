import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { withPeopleHypothesisGuard } from '../../ai/services/prompts/common';

/**
 * Pulse Wave 3 §3.5 — Reflection-Quality-Scorer cron.
 *
 * Источник: plans/tz/2026-05-30-pulse-full.md §3.5.
 *
 * Hourly (`@Cron('15 * * * *')`) выбирает чек-ины за последние 24 часа без
 * `qualityScore` и одним LLM-вызовом `reflection-quality-scorer` оценивает
 * качество рефлексии по 3 осям [0..1]:
 *
 *   - depth          — глубина (содержательность, конкретика, контекст);
 *   - concreteness   — конкретность (есть ли action items, цифры, имена, сроки);
 *   - variety        — разнообразие тем (один пункт vs несколько разных).
 *
 * `qualityScore = (depth + concreteness + variety) / 3`, Decimal(4,3).
 *
 * Если `rawResponseText` короче 10 символов — выставляем 0.1 без LLM-вызова
 * (экономим деньги, очевидно пустой ответ).
 *
 * Best-effort: ошибка по одному чек-ину не валит остальных. Не используется
 * master-flag: фича дешёвая (deepseek-v4-flash + короткий вход + короткий
 * выход), включаем сразу. Если потребуется отключение — добавим
 * `pulse.reflection_quality.enabled` через `cfg.getDynamic` в next iteration.
 */
// A5 (2026-06-10): оценка рефлексии сотрудника — это оценка человека (качество
// его чек-ина). `withPeopleHypothesisGuard` дописывается в КОНЕЦ SYSTEM
// (cache-friendly): оценка остаётся гипотезой по наблюдаемому тексту, а не
// вердиктом о сотруднике (скор приватен, не показывается человеку как приговор).
const REFLECTION_QUALITY_SYSTEM_PROMPT = withPeopleHypothesisGuard(`Ты — оценщик качества рефлексии в чек-ине сотрудника. Оцени чек-ин по 3 осям 0..1:

1. depth — глубина (сколько содержательных слов, конкретики, контекста)
2. concreteness — конкретность (есть ли action items, цифры, имена, сроки)
3. variety — разнообразие тем (один пункт vs несколько разных тем)

Жёсткие правила:
- Верни строго JSON: { depth: 0.X, concreteness: 0.X, variety: 0.X }.
- Числа от 0 до 1.
- Без объяснений в JSON, без markdown.`);

const REFLECTION_QUALITY_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    depth: { type: 'number', minimum: 0, maximum: 1 },
    concreteness: { type: 'number', minimum: 0, maximum: 1 },
    variety: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['depth', 'concreteness', 'variety'],
};

interface ParsedQuality {
  depth: number;
  concreteness: number;
  variety: number;
}

@Injectable()
export class ReflectionQualityScorerCron {
  private readonly logger = new Logger(ReflectionQualityScorerCron.name);
  /** Максимум чек-инов за один прогон (страхуем budget LLM). */
  private static readonly MAX_PER_RUN = 200;
  /** Окно «последние 24 часа» — не пытаемся бэкфилить старые. */
  private static readonly LOOKBACK_MS = 24 * 3600 * 1000;
  /** Лимит входного текста для LLM (защита от мусорных «портянок»). */
  private static readonly MAX_INPUT_CHARS = 2000;
  /** Минимальная длина текста, при которой имеет смысл звать LLM. */
  private static readonly MIN_TEXT_LENGTH = 10;
  /** Дефолтный качественный скор для слишком коротких ответов. */
  private static readonly TOO_SHORT_SCORE = 0.1;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
  ) {}

  /** Hourly batch, обрабатывает чек-ины без qualityScore за последние 24ч. */
  @Cron('15 * * * *')
  async run(): Promise<void> {
    try {
      const stats = await this.runOnce();
      if (stats.processed > 0 || stats.errors > 0) {
        this.logger.debug(stats, 'reflection-quality-scorer.cron: проход завершён');
      }
    } catch (err) {
      this.logger.error(
        `reflection-quality-scorer.cron fail: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async runOnce(): Promise<{ processed: number; errors: number; tooShort: number }> {
    const since = new Date(Date.now() - ReflectionQualityScorerCron.LOOKBACK_MS);
    const checkIns = await this.prisma.dailyCheckIn.findMany({
      where: {
        createdAt: { gte: since },
        qualityScore: null,
      },
      select: { id: true, tenantId: true, rawResponseText: true },
      take: ReflectionQualityScorerCron.MAX_PER_RUN,
    });

    let processed = 0;
    let errors = 0;
    let tooShort = 0;

    for (const c of checkIns) {
      const text = c.rawResponseText?.trim() ?? '';
      // Слишком короткий — ставим TOO_SHORT_SCORE без LLM (экономим).
      if (text.length < ReflectionQualityScorerCron.MIN_TEXT_LENGTH) {
        try {
          await this.prisma.dailyCheckIn.update({
            where: { id: c.id },
            data: {
              qualityScore: new Prisma.Decimal(
                ReflectionQualityScorerCron.TOO_SHORT_SCORE,
              ),
            },
          });
          processed++;
          tooShort++;
        } catch (err) {
          errors++;
          this.logger.warn(
            `reflection-quality-scorer too-short ${c.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        continue;
      }

      try {
        const out = await this.llm.call({
          taskType: 'reflection-quality-scorer',
          tenantId: c.tenantId,
          systemPrompt: REFLECTION_QUALITY_SYSTEM_PROMPT,
          userMessage: text.slice(0, ReflectionQualityScorerCron.MAX_INPUT_CHARS),
          sourceRef: { type: 'daily_check_in', id: c.id },
          maxTokens: 200,
          responseFormat: {
            type: 'json_schema',
            name: 'ReflectionQuality',
            schema: REFLECTION_QUALITY_JSON_SCHEMA,
            strict: true,
          },
        });
        const parsed = this.parseResponse(out.text);
        if (!parsed) {
          errors++;
          continue;
        }
        const composite = (parsed.depth + parsed.concreteness + parsed.variety) / 3;
        await this.prisma.dailyCheckIn.update({
          where: { id: c.id },
          data: {
            qualityScore: new Prisma.Decimal(this.roundDecimal3(composite)),
          },
        });
        processed++;
      } catch (err) {
        errors++;
        this.logger.warn(
          `reflection-quality-scorer ${c.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { processed, errors, tooShort };
  }

  private parseResponse(text: string): ParsedQuality | null {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (typeof parsed !== 'object' || parsed === null) return null;
      const obj = parsed as Record<string, unknown>;
      const depth = obj['depth'];
      const concreteness = obj['concreteness'];
      const variety = obj['variety'];
      if (
        typeof depth !== 'number' ||
        typeof concreteness !== 'number' ||
        typeof variety !== 'number'
      ) {
        return null;
      }
      return {
        depth: this.clamp01(depth),
        concreteness: this.clamp01(concreteness),
        variety: this.clamp01(variety),
      };
    } catch {
      return null;
    }
  }

  private clamp01(v: number): number {
    if (Number.isNaN(v)) return 0;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
  }

  private roundDecimal3(v: number): number {
    return Math.round(v * 1000) / 1000;
  }
}
