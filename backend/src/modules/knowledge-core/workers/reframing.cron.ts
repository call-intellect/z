import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { z } from 'zod';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { withInjectionGuard, wrapUserData } from '../../ai/services/prompts/common';
import { WorkerOrgGate } from '../../core-queue/worker-org-gate';
import {
  REFRAMING_BLOCKS_JSON_SCHEMA,
  REFRAMING_BLOCKS_SYSTEM_PROMPT,
  REFRAMING_THEMES_JSON_SCHEMA,
  REFRAMING_THEMES_SYSTEM_PROMPT,
  ReframingBlocksResponseSchema,
  ThemesReframingResponseSchema,
} from '../prompts/reframing.prompt';

const REFRAMING_JSON_SCHEMA = REFRAMING_BLOCKS_JSON_SCHEMA;
const ReframingResponseSchema = ReframingBlocksResponseSchema;
const REFRAMING_SYSTEM_PROMPT = REFRAMING_BLOCKS_SYSTEM_PROMPT;

const REFRAMING_THEMES_MAX = 50;

const SLOW_LINK_AGE_DAYS = 7;
const SLOW_LINK_MIN_CONFIDENCE = 0.5;
const REFRAMING_RECENT_BLOCKS_DAYS = 7;
const REFRAMING_MIN_FRESH_BLOCKS = 10;
const REFRAMING_MAX_BLOCKS_TO_ANALYZE = 50;

@Injectable()
export class ReframingCron {
  private readonly logger = new Logger(ReframingCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(WorkerOrgGate) private readonly gate: WorkerOrgGate,
  ) {}

  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  @Cron('0 3 * * *')
  async sweep(): Promise<void> {
    try {
      const summary = await this.runForAllOrgs();
      this.logger.debug(summary, 'reframing: ночной проход завершён');
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
    const decayCutoff = this.daysAgo(this.cfg.knowledgeCore.blockDynamicScoreDecayDays);
    const freshCutoff = this.daysAgo(REFRAMING_RECENT_BLOCKS_DAYS);

    for (const org of orgs) {
      try {
        try {
          await this.gate.checkOrThrow(org.id, 'reframing');
        } catch {
          this.logger.debug({ tenantId: org.id }, 'reframing: gate disabled — skip Org');
          continue;
        }

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
        decayedBlocks += Number(decayResult ?? 0);

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
    const guardOnBlocks = this.isPromptInjectionGuardEnabled();
    const guardedSystemBlocks = guardOnBlocks
      ? withInjectionGuard(REFRAMING_SYSTEM_PROMPT)
      : REFRAMING_SYSTEM_PROMPT;
    const guardedUserBlocks = guardOnBlocks ? wrapUserData(userMessage) : userMessage;
    try {
      const out = await this.llm.call({
        taskType: 'reframing',
        tenantId,
        systemPrompt: guardedSystemBlocks,
        userMessage: guardedUserBlocks,
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
        this.logger.warn({ tenantId }, 'reframing: invalid JSON LLM-анализа — игнорирую');
        return;
      }
      this.logger.debug(
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

    const guardOnThemes = this.isPromptInjectionGuardEnabled();
    const guardedSystemThemes = guardOnThemes
      ? withInjectionGuard(REFRAMING_THEMES_SYSTEM_PROMPT)
      : REFRAMING_THEMES_SYSTEM_PROMPT;
    const guardedUserThemes = guardOnThemes ? wrapUserData(userMessage) : userMessage;
    let parsed: z.infer<typeof ThemesReframingResponseSchema> | null;
    try {
      const out = await this.llm.call({
        taskType: 'reframing',
        tenantId,
        systemPrompt: guardedSystemThemes,
        userMessage: guardedUserThemes,
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

    for (const s of parsed.themeSplits ?? []) {
      if (!validIds.has(s.themeId)) continue;
      this.logger.debug(
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
      this.logger.debug(
        { tenantId, merged, archived, splitsLogged, analysis: parsed.analysis },
        'reframing-themes: применены изменения',
      );
    }

    return { merged, archived, splitsLogged };
  }

  private async applyThemeMerge(args: {
    tenantId: string;
    sourceId: string;
    targetId: string;
  }): Promise<void> {
    const { tenantId, sourceId, targetId } = args;
    await this.prisma.$transaction(async (tx) => {
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

  private parseThemesReframing(text: string): z.infer<typeof ThemesReframingResponseSchema> | null {
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
