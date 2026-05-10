import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { z } from 'zod';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { WorkerOrgGate } from '../../core-queue/worker-org-gate';

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

/**
 * JSON Schema для шага 4 reframing'а — рефлексия над Theme'ами.
 * - themeSplits — id тем-кандидатов на разделение (ничего не делаем
 *   автоматически, только лог-сигнал — UI разберёт через owner Org).
 * - themeMerges — пары (sourceId, targetId): source становится merged_into target.
 * - themesToArchive — id тем, которые reframing считает устаревшими.
 */
const REFRAMING_THEMES_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['analysis'],
  properties: {
    analysis: { type: 'string', maxLength: 1000 },
    themeSplits: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['themeId', 'reason'],
        properties: {
          themeId: { type: 'string' },
          reason: { type: 'string', maxLength: 500 },
        },
      },
    },
    themeMerges: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sourceId', 'targetId', 'reason'],
        properties: {
          sourceId: { type: 'string' },
          targetId: { type: 'string' },
          reason: { type: 'string', maxLength: 500 },
        },
      },
    },
    themesToArchive: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['themeId', 'reason'],
        properties: {
          themeId: { type: 'string' },
          reason: { type: 'string', maxLength: 500 },
        },
      },
    },
  },
};

const ThemesReframingResponseSchema = z.object({
  analysis: z.string().max(1000),
  themeSplits: z
    .array(
      z.object({
        themeId: z.string(),
        reason: z.string().max(500),
      }),
    )
    .optional(),
  themeMerges: z
    .array(
      z.object({
        sourceId: z.string(),
        targetId: z.string(),
        reason: z.string().max(500),
      }),
    )
    .optional(),
  themesToArchive: z
    .array(
      z.object({
        themeId: z.string(),
        reason: z.string().max(500),
      }),
    )
    .optional(),
});

const REFRAMING_THEMES_SYSTEM_PROMPT = `Ты — аналитик графа знаний компании. На вход — список активных Theme'ов (имя + описание + размер по числу блоков), плюс блоки за последнюю неделю, ещё не привязанные ни к одной теме.

Твоя задача — найти проблемы в текущей карте тем:
1. "themeSplits" — id тем, которые на самом деле смешивают две и более идеи и стоит разделить (пары / группы).
2. "themeMerges" — пары тем (sourceId, targetId), которые описывают одно и то же. source → merged_into target.
3. "themesToArchive" — темы, которые потеряли актуальность (нет новых блоков, описание устарело).
4. "analysis" — краткий вывод (1-2 абзаца), что наблюдается на этой неделе по теме мапы.

Правила:
- Не выдумывай. Если карта ровная — возвращай только analysis.
- Не предлагай объединять разные ветки компании.
- Ответ — строго JSON по схеме.`;

const REFRAMING_THEMES_MAX = 50;

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
    @Inject(WorkerOrgGate) private readonly gate: WorkerOrgGate,
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
    themeMergesApplied: number;
    themesArchivedByLlm: number;
    themeSplitsLogged: number;
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
    let themeMergesApplied = 0;
    let themesArchivedByLlm = 0;
    let themeSplitsLogged = 0;

    const slowCutoff = this.daysAgo(SLOW_LINK_AGE_DAYS);
    const decayCutoff = this.daysAgo(
      this.cfg.knowledgeCore.blockDynamicScoreDecayDays,
    );
    const freshCutoff = this.daysAgo(REFRAMING_RECENT_BLOCKS_DAYS);

    for (const org of orgs) {
      try {
        // Org-Admin Фаза 7: тумблер reframing — если выключен, скипаем.
        try {
          await this.gate.checkOrThrow(org.id, 'reframing');
        } catch {
          this.logger.debug(
            { tenantId: org.id },
            'reframing: gate disabled — skip Org',
          );
          continue;
        }

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

        // 4. Рефлексия над Theme'ами (Фаза 4 — split/merge/archive).
        const themeOutcome = await this.reflectOnThemes(org.id);
        themeMergesApplied += themeOutcome.merged;
        themesArchivedByLlm += themeOutcome.archived;
        themeSplitsLogged += themeOutcome.splitsLogged;
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
      themeMergesApplied,
      themesArchivedByLlm,
      themeSplitsLogged,
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

  /**
   * Шаг 4 — рефлексия над Theme'ами Org.
   *
   * Если в Org < 2 активных тем — пропускаем (нечего сравнивать).
   * Иначе: грузим до REFRAMING_THEMES_MAX тем + 30 свежих блоков без темы;
   * один LLM-вызов `reframing` возвращает split/merge/archive списки.
   *
   *  - merge: переносим ThemeIdeaBlock/ThemeEntity с source на target,
   *           ставим source.status='merged_into', mergedIntoId=target.id.
   *  - archive: ставим status='archived'.
   *  - splits: только лог-сигнал — не делаем автоматически (рискованно).
   */
  private async reflectOnThemes(
    tenantId: string,
  ): Promise<{ merged: number; archived: number; splitsLogged: number }> {
    const themes = await this.prisma.theme.findMany({
      where: { tenantId, status: 'active' },
      orderBy: [{ weight: 'desc' }, { createdAt: 'desc' }],
      take: REFRAMING_THEMES_MAX,
      include: { _count: { select: { blocks: true } } },
    });
    if (themes.length < 2) {
      return { merged: 0, archived: 0, splitsLogged: 0 };
    }

    const freshBlocks = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId,
        status: 'canonical',
        createdAt: { gte: this.daysAgo(REFRAMING_RECENT_BLOCKS_DAYS) },
        themes: { none: {} },
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true,
        name: true,
        criticalQuestion: true,
        signalType: true,
      },
    });

    const userPayload = {
      themes: themes.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        branch: t.branch,
        size: t._count.blocks,
        weight: Number(t.weight),
      })),
      freshBlocksWithoutTheme: freshBlocks,
    };
    const userMessage = `Карта тем (active) и свежие блоки без темы:\n\n${JSON.stringify(userPayload, null, 2)}`;

    let parsed: z.infer<typeof ThemesReframingResponseSchema> | null;
    try {
      const out = await this.llm.call({
        taskType: 'reframing',
        tenantId,
        systemPrompt: REFRAMING_THEMES_SYSTEM_PROMPT,
        userMessage,
        responseFormat: {
          type: 'json_schema',
          name: 'ReframingThemes',
          strict: true,
          schema: REFRAMING_THEMES_JSON_SCHEMA,
        },
        sourceRef: { type: 'reframing-themes', id: tenantId },
      });
      parsed = this.parseThemesReframing(out.text);
    } catch (err) {
      this.logger.warn(
        {
          tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'reframing-themes: LLM-вызов упал — пропускаю',
      );
      return { merged: 0, archived: 0, splitsLogged: 0 };
    }
    if (!parsed) {
      this.logger.warn({ tenantId }, 'reframing-themes: ответ LLM не распарсился');
      return { merged: 0, archived: 0, splitsLogged: 0 };
    }

    const validIds = new Set(themes.map((t) => t.id));
    let merged = 0;
    let archived = 0;
    let splitsLogged = 0;

    for (const m of parsed.themeMerges ?? []) {
      if (!validIds.has(m.sourceId) || !validIds.has(m.targetId)) continue;
      if (m.sourceId === m.targetId) continue;
      try {
        await this.applyThemeMerge({ tenantId, sourceId: m.sourceId, targetId: m.targetId });
        merged += 1;
      } catch (err) {
        this.logger.warn(
          {
            tenantId,
            sourceId: m.sourceId,
            targetId: m.targetId,
            err: err instanceof Error ? err.message : String(err),
          },
          'reframing-themes: ошибка слияния — пропускаю',
        );
      }
    }

    for (const a of parsed.themesToArchive ?? []) {
      if (!validIds.has(a.themeId)) continue;
      try {
        const res = await this.prisma.theme.updateMany({
          where: { id: a.themeId, tenantId, status: 'active' },
          data: { status: 'archived' },
        });
        if (res.count > 0) archived += 1;
      } catch (err) {
        this.logger.warn(
          {
            tenantId,
            themeId: a.themeId,
            err: err instanceof Error ? err.message : String(err),
          },
          'reframing-themes: ошибка архивации — пропускаю',
        );
      }
    }

    // Splits — только лог. Никакой автоматики: разделение требует ручного
    // пересмотра owner'ом Org через UI (Фаза 5/6).
    for (const s of parsed.themeSplits ?? []) {
      if (!validIds.has(s.themeId)) continue;
      this.logger.log(
        {
          tenantId,
          themeId: s.themeId,
          reason: s.reason,
        },
        'reframing-themes: split candidate — owner Org должен разобраться',
      );
      splitsLogged += 1;
    }

    if (merged > 0 || archived > 0 || splitsLogged > 0) {
      this.logger.log(
        { tenantId, merged, archived, splitsLogged, analysis: parsed.analysis },
        'reframing-themes: применены изменения',
      );
    }

    return { merged, archived, splitsLogged };
  }

  /**
   * source.status='merged_into', source.mergedIntoId=target.
   * Переносим/upsert'им ThemeIdeaBlock и ThemeEntity на target (skipDuplicates).
   */
  private async applyThemeMerge(args: {
    tenantId: string;
    sourceId: string;
    targetId: string;
  }): Promise<void> {
    const { tenantId, sourceId, targetId } = args;
    await this.prisma.$transaction(async (tx) => {
      // Перенос блоков: на target — те, которых там ещё нет.
      const sourceBlocks = await tx.themeIdeaBlock.findMany({
        where: { themeId: sourceId },
        select: { blockId: true, weight: true },
      });
      if (sourceBlocks.length > 0) {
        await tx.themeIdeaBlock.createMany({
          data: sourceBlocks.map((b) => ({
            themeId: targetId,
            blockId: b.blockId,
            weight: b.weight,
          })),
          skipDuplicates: true,
        });
        await tx.themeIdeaBlock.deleteMany({ where: { themeId: sourceId } });
      }

      const sourceEntities = await tx.themeEntity.findMany({
        where: { themeId: sourceId },
        select: { entityId: true, mentionsCount: true },
      });
      if (sourceEntities.length > 0) {
        await tx.themeEntity.createMany({
          data: sourceEntities.map((e) => ({
            themeId: targetId,
            entityId: e.entityId,
            mentionsCount: e.mentionsCount,
          })),
          skipDuplicates: true,
        });
        await tx.themeEntity.deleteMany({ where: { themeId: sourceId } });
      }

      await tx.theme.update({
        where: { id: sourceId },
        data: { status: 'merged_into', mergedIntoId: targetId },
      });

      // Tenant-чек: гарантируем, что обе темы из той же Org (страховочно).
      const target = await tx.theme.findUnique({
        where: { id: targetId },
        select: { tenantId: true, status: true },
      });
      if (!target || target.tenantId !== tenantId || target.status !== 'active') {
        throw new Error(
          `applyThemeMerge: target ${targetId} не подходит для merge (tenantId/status)`,
        );
      }
    });
  }

  private parseThemesReframing(
    text: string,
  ): z.infer<typeof ThemesReframingResponseSchema> | null {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return null;
    }
    const parsed = ThemesReframingResponseSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  private daysAgo(days: number): Date {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - days);
    return d;
  }
}
