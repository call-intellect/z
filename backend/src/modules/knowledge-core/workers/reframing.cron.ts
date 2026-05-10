import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { z } from 'zod';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';

const REFRAMING_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['analysis'],
  properties: {
    analysis: { type: 'string', maxLength: 1000 },
    splitCandidates: {
      type: 'array',
      items: { type: 'string' },
    },
    mergeCandidates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['a', 'b'],
        properties: {
          a: { type: 'string' },
          b: { type: 'string' },
        },
      },
    },
    themeShifts: {
      type: 'array',
      items: { type: 'string' },
    },
  },
};

const ReframingResponseSchema = z.object({
  analysis: z.string().max(1000),
  splitCandidates: z.array(z.string()).optional(),
  mergeCandidates: z
    .array(
      z.object({
        a: z.string(),
        b: z.string(),
      }),
    )
    .optional(),
  themeShifts: z.array(z.string()).optional(),
});

const REFRAMING_SYSTEM_PROMPT = `Ты — аналитик, переосмысливающий граф знания компании.
На вход — список IdeaBlock'ов за последнюю неделю (имя + критический вопрос + доверенный ответ).

Твоя задача — найти ВЫСОКОУРОВНЕВЫЕ паттерны:
1. "splitCandidates" — id блоков, которые на самом деле смешивают две разные темы и стоит разделить.
2. "mergeCandidates" — пары id блоков (a, b), которые описывают одну и ту же идею и стоит слить.
3. "themeShifts" — короткие фразы, описывающие сдвиг фокуса (например, "стало больше про маркетинг, меньше про продукт").
4. "analysis" — общий вывод (1-2 абзаца): что компания обсуждала на этой неделе, какие тренды.

Правила:
- Не выдумывай. Если блоков мало или они разрозненные — просто короткий "analysis", остальные поля можно опустить.
- "analysis" — на русском, без markdown.
- Ответ — строго JSON по схеме.`;

const SLOW_LINK_AGE_DAYS = 7;
const SLOW_LINK_MIN_CONFIDENCE = 0.5;
const REFRAMING_RECENT_BLOCKS_DAYS = 7;
const REFRAMING_MIN_FRESH_BLOCKS = 10;
const REFRAMING_MAX_BLOCKS_TO_ANALYZE = 50;

/**
 * ReframingCron — ночное переосмысление графа.
 *
 * Раз в сутки (по умолчанию 3:00) для каждой Org делает 3 шага:
 *   1. **Архивация слабых связей** — `IdeaBlockLink` и `EntityLink` со статусом
 *      `active`, confidence < 0.5 и возрастом > 7 дней → status='archived'.
 *   2. **dynamicScore decay** — для canonical-блоков, у которых
 *      `updatedAt < now - BLOCK_DYNAMIC_SCORE_DECAY_DAYS` (90 дней по умолчанию),
 *      `dynamicScore = max(0.1, dynamicScore - 0.1)` через $executeRawUnsafe.
 *   3. **LLM-анализ свежих блоков** — если ≥10 блоков за последние 7 дней,
 *      одним вызовом `taskType: 'reframing'` получаем split/merge/themeShifts.
 *      Результат логируется (ReframingLog как таблица — Фаза 7).
 *
 * NB: cron-expression в декораторе литерален (`'0 3 * * *'`).
 */
@Injectable()
export class ReframingCron {
  private readonly logger = new Logger(ReframingCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
  ) {}

  @Cron('0 3 * * *')
  async sweep(): Promise<void> {
    try {
      const summary = await this.runForAllOrgs();
      this.logger.log(summary, 'reframing: ночной проход завершён');
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'reframing: непойманная ошибка',
      );
    }
  }

  async runForAllOrgs(): Promise<{
    scannedOrgs: number;
    archivedBlockLinks: number;
    archivedEntityLinks: number;
    decayedBlocks: number;
    analyzedOrgs: number;
  }> {
    const orgs = await this.prisma.org.findMany({
      where: {
        deletedAt: null,
        memberships: {
          some: { role: { in: ['owner', 'admin'] } },
        },
      },
      select: { id: true },
    });

    let archivedBlockLinks = 0;
    let archivedEntityLinks = 0;
    let decayedBlocks = 0;
    let analyzedOrgs = 0;

    const slowCutoff = this.daysAgo(SLOW_LINK_AGE_DAYS);
    const decayCutoff = this.daysAgo(
      this.cfg.knowledgeCore.blockDynamicScoreDecayDays,
    );
    const freshCutoff = this.daysAgo(REFRAMING_RECENT_BLOCKS_DAYS);

    for (const org of orgs) {
      try {
        // 1. Архивация слабых блок-связей.
        const blockArc = await this.prisma.ideaBlockLink.updateMany({
          where: {
            tenantId: org.id,
            status: 'active',
            confidence: { lt: SLOW_LINK_MIN_CONFIDENCE },
            createdAt: { lt: slowCutoff },
          },
          data: { status: 'archived' },
        });
        archivedBlockLinks += blockArc.count;

        // 1b. Архивация слабых entity-связей.
        const entityArc = await this.prisma.entityLink.updateMany({
          where: {
            tenantId: org.id,
            status: 'active',
            confidence: { lt: SLOW_LINK_MIN_CONFIDENCE },
            createdAt: { lt: slowCutoff },
          },
          data: { status: 'archived' },
        });
        archivedEntityLinks += entityArc.count;

        // 2. dynamicScore decay для застойных canonical-блоков.
        const decayResult = await this.prisma.$executeRawUnsafe<number>(
          `
          UPDATE "IdeaBlock"
             SET "dynamicScore" = GREATEST(0.1, "dynamicScore"::numeric - 0.1)
           WHERE "tenantId" = $1
             AND status = 'canonical'
             AND "updatedAt" < $2
             AND "dynamicScore"::numeric > 0.1
          `,
          org.id,
          decayCutoff,
        );
        // executeRaw возвращает число затронутых строк.
        decayedBlocks += Number(decayResult ?? 0);

        // 3. LLM-анализ свежих блоков (если их достаточно).
        const freshBlocks = await this.prisma.ideaBlock.findMany({
          where: {
            tenantId: org.id,
            status: 'canonical',
            createdAt: { gte: freshCutoff },
          },
          orderBy: { createdAt: 'desc' },
          take: REFRAMING_MAX_BLOCKS_TO_ANALYZE,
        });
        if (freshBlocks.length >= REFRAMING_MIN_FRESH_BLOCKS) {
          await this.analyzeFreshBlocks(org.id, freshBlocks);
          analyzedOrgs += 1;
        }
      } catch (err) {
        this.logger.warn(
          {
            tenantId: org.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'reframing: ошибка на Org — продолжаю',
        );
      }
    }

    return {
      scannedOrgs: orgs.length,
      archivedBlockLinks,
      archivedEntityLinks,
      decayedBlocks,
      analyzedOrgs,
    };
  }

  // ─────────────────────────── helpers ─────────────────────────────────────

  private async analyzeFreshBlocks(
    tenantId: string,
    blocks: Array<{
      id: string;
      name: string;
      criticalQuestion: string;
      trustedAnswer: string;
    }>,
  ): Promise<void> {
    const userPayload = blocks.map((b) => ({
      id: b.id,
      name: b.name,
      criticalQuestion: b.criticalQuestion,
      trustedAnswer: b.trustedAnswer,
    }));
    const userMessage = `Блоки за последние ${REFRAMING_RECENT_BLOCKS_DAYS} дней:\n\n${JSON.stringify(userPayload, null, 2)}`;
    try {
      const out = await this.llm.call({
        taskType: 'reframing',
        tenantId,
        systemPrompt: REFRAMING_SYSTEM_PROMPT,
        userMessage,
        responseFormat: {
          type: 'json_schema',
          name: 'ReframingAnalysis',
          strict: true,
          schema: REFRAMING_JSON_SCHEMA,
        },
        sourceRef: { type: 'reframing', id: tenantId },
      });
      const parsed = this.parseReframing(out.text);
      if (!parsed) {
        this.logger.warn(
          { tenantId },
          'reframing: invalid JSON LLM-анализа — игнорирую',
        );
        return;
      }
      // Логируем результат — таблица ReframingLog появится в Фазе 7 (Z-Admin).
      this.logger.log(
        {
          tenantId,
          analysis: parsed.analysis,
          splitCandidates: parsed.splitCandidates ?? [],
          mergeCandidates: parsed.mergeCandidates ?? [],
          themeShifts: parsed.themeShifts ?? [],
          sampleSize: blocks.length,
        },
        'reframing: LLM-анализ свежих блоков',
      );
    } catch (err) {
      this.logger.warn(
        {
          tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'reframing: LLM-вызов упал — пропускаю Org',
      );
    }
  }

  private parseReframing(text: string): z.infer<typeof ReframingResponseSchema> | null {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return null;
    }
    const parsed = ReframingResponseSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  private daysAgo(days: number): Date {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - days);
    return d;
  }
}
