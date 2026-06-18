import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { withPeopleHypothesisGuard } from '../../ai/services/prompts/common';

const REFLECTION_QUALITY_SYSTEM_PROMPT =
  withPeopleHypothesisGuard(`Ты — оценщик качества рефлексии в чек-ине сотрудника. Оцени чек-ин по 3 осям 0..1:

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
  private static readonly MAX_PER_RUN = 200;
  private static readonly LOOKBACK_MS = 24 * 3600 * 1000;
  private static readonly MAX_INPUT_CHARS = 2000;
  private static readonly MIN_TEXT_LENGTH = 10;
  private static readonly TOO_SHORT_SCORE = 0.1;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
  ) {}

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
      if (text.length < ReflectionQualityScorerCron.MIN_TEXT_LENGTH) {
        try {
          await this.prisma.dailyCheckIn.update({
            where: { id: c.id },
            data: {
              qualityScore: new Prisma.Decimal(ReflectionQualityScorerCron.TOO_SHORT_SCORE),
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
