import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma, type IdeaBlock } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService, maxDataClass } from '../../ai/services/llm-router.service';
import { withInjectionGuard, wrapUserData } from '../../ai/services/prompts/common';
import { ConflictService } from '../../curation/services/conflict.service';
import { CurationService } from '../../curation/services/curation.service';
import { getCardRollupV2SystemPrompt } from '../prompts/card-rollup-v2.prompts';

import { DataClassPolicyService } from './dataclass-policy.service';
import { Specialist34ProbeService } from './specialist-3-4-probe.service';

const CARD_ROLLUP_V2_MAX_BLOCKS = 50;

const CARD_ROLLUP_V2_EVIDENCE_PER_BLOCK = 1;

const CARD_ROLLUP_V2_TOP_THEMES = 3;

const CARD_ROLLUP_V2_DEFAULT_CONFIDENCE = 0.9;

interface BlockForRollup extends Pick<
  IdeaBlock,
  | 'id'
  | 'name'
  | 'criticalQuestion'
  | 'trustedAnswer'
  | 'tags'
  | 'signalType'
  | 'dataClass'
  | 'createdAt'
> {
  evidenceQuote?: string | null;
}

export interface CardRollupV2Result {
  summary: string | null;
  topThemeIds: string[];
  blocksUsed: number;
  sourceBlockIds: string[];
  personSubjectIds: string[];
  confidence: number;
  triageDecision: 'auto' | 'provisional' | 'light' | 'deep' | 'skipped';
  applied: boolean;
  cardVersionId: string | null;
  curationItemId: string | null;
  conflictReported: boolean;
  usedTier: string | null;
  usedModel: string | null;
  llmTokens: { input: number; output: number };
}

@Injectable()
export class CardRollupV2Service {
  private readonly logger = new Logger(CardRollupV2Service.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(CurationService) private readonly curation: CurationService,
    @Inject(ConflictService) private readonly conflicts: ConflictService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(Specialist34ProbeService)
    private readonly probes: Specialist34ProbeService,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg?: TypedConfigService,
    @Optional()
    @Inject(DataClassPolicyService)
    private readonly dataClassPolicy?: DataClassPolicyService,
  ) {}

  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.cfg?.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }

  async buildRollup(args: { tenantId: string; cardId: string }): Promise<CardRollupV2Result> {
    const start = Date.now();

    const empty: CardRollupV2Result = {
      summary: null,
      topThemeIds: [],
      blocksUsed: 0,
      sourceBlockIds: [],
      personSubjectIds: [],
      confidence: 0,
      triageDecision: 'skipped',
      applied: false,
      cardVersionId: null,
      curationItemId: null,
      conflictReported: false,
      usedTier: null,
      usedModel: null,
      llmTokens: { input: 0, output: 0 },
    };

    const card = await this.prisma.card.findUnique({
      where: { id: args.cardId },
      select: {
        id: true,
        kind: true,
        name: true,
        contactName: true,
        contactEmail: true,
        ownerId: true,
        tenantId: true,
        entityId: true,
        relatedEntityIds: true,
        deletedAt: true,
        summaryCache: true,
      },
    });
    if (!card || card.deletedAt) {
      return empty;
    }
    if (card.tenantId !== args.tenantId) {
      this.logger.warn(
        { cardId: card.id, tenantId: args.tenantId },
        'card-rollup-v2: tenant mismatch — пропускаем',
      );
      return empty;
    }

    const meetingIds = (
      await this.prisma.meeting.findMany({
        where: { cardId: card.id, deletedAt: null },
        select: { id: true },
      })
    ).map((m) => m.id);

    const candidateEntityIds = [
      ...(card.entityId ? [card.entityId] : []),
      ...card.relatedEntityIds,
    ];

    const blockIdSet = new Set<string>();

    if (meetingIds.length > 0) {
      const meetingBlockRows = await this.prisma.ideaBlockEvidence.findMany({
        where: {
          rawEvent: {
            tenantId: args.tenantId,
            sourceExternalId: { in: meetingIds },
          },
          block: { status: 'canonical', tenantId: args.tenantId },
        },
        select: { blockId: true },
        take: CARD_ROLLUP_V2_MAX_BLOCKS * 4,
      });
      for (const r of meetingBlockRows) blockIdSet.add(r.blockId);
    }

    if (candidateEntityIds.length > 0) {
      const entityBlockRows = await this.prisma.ideaBlockEntity.findMany({
        where: {
          entityId: { in: candidateEntityIds },
          block: { status: 'canonical', tenantId: args.tenantId },
        },
        select: { blockId: true },
        take: CARD_ROLLUP_V2_MAX_BLOCKS * 4,
      });
      for (const r of entityBlockRows) blockIdSet.add(r.blockId);
    }

    if (blockIdSet.size === 0) {
      this.metrics.observeCoreSpecialistPipelineDuration({
        type: 'card',
        seconds: (Date.now() - start) / 1000,
      });
      return empty;
    }

    const blocks = await this.prisma.ideaBlock.findMany({
      where: {
        id: { in: [...blockIdSet] },
        status: 'canonical',
        tenantId: args.tenantId,
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: CARD_ROLLUP_V2_MAX_BLOCKS,
      select: {
        id: true,
        name: true,
        criticalQuestion: true,
        trustedAnswer: true,
        tags: true,
        signalType: true,
        dataClass: true,
        createdAt: true,
      },
    });
    if (blocks.length === 0) {
      this.metrics.observeCoreSpecialistPipelineDuration({
        type: 'card',
        seconds: (Date.now() - start) / 1000,
      });
      return empty;
    }

    const sourceBlockIds = blocks.map((b) => b.id);

    const evidenceRows = await this.prisma.ideaBlockEvidence.findMany({
      where: { blockId: { in: sourceBlockIds } },
      orderBy: [{ sourceTimestamp: 'desc' }, { createdAt: 'desc' }],
      select: { blockId: true, quote: true },
    });
    const quoteByBlock = new Map<string, string>();
    for (const ev of evidenceRows) {
      if (!quoteByBlock.has(ev.blockId)) {
        quoteByBlock.set(ev.blockId, ev.quote);
      }
      if (quoteByBlock.size >= blocks.length * CARD_ROLLUP_V2_EVIDENCE_PER_BLOCK) break;
    }
    const enriched: BlockForRollup[] = blocks.map((b) => ({
      ...b,
      evidenceQuote: quoteByBlock.get(b.id) ?? null,
    }));

    const themeRows = await this.prisma.themeIdeaBlock.findMany({
      where: { blockId: { in: sourceBlockIds } },
      select: { themeId: true },
    });
    const themeCount = new Map<string, number>();
    for (const r of themeRows) {
      themeCount.set(r.themeId, (themeCount.get(r.themeId) ?? 0) + 1);
    }
    const topThemeIds = [...themeCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, CARD_ROLLUP_V2_TOP_THEMES)
      .map(([id]) => id);

    const topThemes =
      topThemeIds.length > 0
        ? await this.prisma.theme.findMany({
            where: {
              id: { in: topThemeIds },
              status: 'active',
              tenantId: args.tenantId,
            },
            select: { id: true, name: true, description: true, branch: true },
          })
        : [];

    const personSubjectIds = await this.collectPersonSubjects({
      tenantId: args.tenantId,
      blockIds: sourceBlockIds,
    });

    const systemPrompt = getCardRollupV2SystemPrompt(card.kind);
    const userMessage = this.buildUserMessage({
      cardKind: card.kind,
      cardName: card.name,
      contactName: card.contactName,
      contactEmail: card.contactEmail,
      blocks: enriched,
      themes: topThemes,
    });
    const guardOn = this.isPromptInjectionGuardEnabled();
    const guardedSystem = guardOn ? withInjectionGuard(systemPrompt) : systemPrompt;
    const guardedUser = guardOn ? wrapUserData(userMessage) : userMessage;
    const result = await this.llm.call({
      taskType: 'card-rollup-v2',
      systemPrompt: guardedSystem,
      userMessage: guardedUser,
      tenantId: args.tenantId,
      userId: card.ownerId,
      sourceRef: { type: 'card', id: card.id },
      dataClass: maxDataClass(enriched.map((b) => b.dataClass)),
      maxTokens: 8_000,
    });

    const summary = result.text.trim() || null;
    const confidence = CARD_ROLLUP_V2_DEFAULT_CONFIDENCE;
    const usedTier = result.tier ?? null;
    const usedModel = result.modelUsed ?? null;
    const llmTokens = {
      input: result.inputTokens,
      output: result.outputTokens,
    };

    if (llmTokens.input + llmTokens.output > 0 && usedModel) {
      this.metrics.incCoreSpecialistLlmTokens({
        type: 'card',
        model: usedModel,
        tier: usedTier ?? 'primary',
        tokens: llmTokens.input + llmTokens.output,
      });
    }

    if (!summary) {
      this.metrics.observeCoreSpecialistPipelineDuration({
        type: 'card',
        seconds: (Date.now() - start) / 1000,
      });
      return {
        ...empty,
        topThemeIds,
        blocksUsed: enriched.length,
        sourceBlockIds,
        personSubjectIds,
        confidence,
        usedTier,
        usedModel,
        llmTokens,
        triageDecision: 'skipped',
      };
    }

    const proposedPayload: Record<string, unknown> = {
      summaryCache: summary,
      kind: card.kind,
      name: card.name,
      entityId: card.entityId,
      sourceBlockIds,
      cachedTopThemeIds: topThemeIds,
      personSubjectIds,
      confidence,
    };

    const enforcementCr = this.cfg?.dataClassPolicy.enforcement ?? 'off';
    const derivedCr = this.dataClassPolicy?.derive({
      sources: enriched.map((b) => ({
        dataClass: b.dataClass,
        sourceId: b.id,
        sourceKind: 'idea_block' as const,
      })),
      context: { kind: 'card_rollup' },
    });
    if (this.dataClassPolicy && derivedCr) {
      this.dataClassPolicy.compareWithLegacy({
        legacyResult: 'internal',
        proposedResult: derivedCr.dataClass,
        kind: 'card_rollup',
        sourceIds: enriched.map((b) => b.id),
      });
    }
    const effectiveDcCr =
      enforcementCr === 'enforce' && derivedCr ? derivedCr.dataClass : 'internal';
    const auditCr: Prisma.InputJsonValue | typeof Prisma.JsonNull =
      enforcementCr === 'enforce' && derivedCr
        ? (derivedCr.audit as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull;

    const triage = await this.curation.triage({
      tenantId: args.tenantId,
      resourceType: 'card',
      resourceId: card.id,
      confidence,
      proposedPayload,
      conflictSignal: 'none',
      createdByUserId: null,
      dataClass: effectiveDcCr,
    });

    let applied = false;
    const cardVersionId: string | null = triage.cardVersionId;
    const curationItemId: string | null = triage.curationItemId;

    if (triage.decision === 'auto') {
      const updatedCard = await this.prisma.card.update({
        where: { id: card.id },
        data: {
          summaryCache: summary,
          summaryUpdatedAt: new Date(),
          cachedTopThemeIds: topThemeIds,
          sourceBlockIds,
          confidence: new Prisma.Decimal(confidence),
          currentVersionId: cardVersionId ?? undefined,
          personSubjectIds,
          lastConfirmedAt: new Date(),
          dataClassAudit: auditCr,
        },
      });
      applied = true;

      await this.probes.checkAndEmitProbes(updatedCard);
    } else {
      await this.prisma.card.update({
        where: { id: card.id },
        data: { summaryUpdatedAt: new Date() },
      });
    }

    let conflictReported = false;
    if (
      summary &&
      card.summaryCache &&
      this.detectStatusContradiction(card.summaryCache, summary)
    ) {
      try {
        await this.conflicts.report({
          tenantId: args.tenantId,
          resourceType: 'card',
          existingId: card.id,
          newId: `${card.id}:next`,
          relationType: 'contradicts',
          detectedBy: 'specialist',
          evidence: {
            specialistName: '3-4-project-customer',
            heuristic: 'status-keyword-flip',
            oldSummary: card.summaryCache.slice(0, 1_000),
            newSummary: summary.slice(0, 1_000),
            sourceBlockIds: sourceBlockIds.slice(0, 20),
          },
        });
        conflictReported = true;
        this.metrics.incCoreSpecialistConflictEvent({ type: 'card' });
      } catch (err) {
        this.logger.warn(
          {
            cardId: card.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'card-rollup-v2: conflict.report не удался — пропускаю',
        );
      }
    }

    this.metrics.observeCoreSpecialistPipelineDuration({
      type: 'card',
      seconds: (Date.now() - start) / 1000,
    });

    return {
      summary,
      topThemeIds,
      blocksUsed: enriched.length,
      sourceBlockIds,
      personSubjectIds,
      confidence,
      triageDecision: triage.decision,
      applied,
      cardVersionId,
      curationItemId,
      conflictReported,
      usedTier,
      usedModel,
      llmTokens,
    };
  }

  private async collectPersonSubjects(args: {
    tenantId: string;
    blockIds: string[];
  }): Promise<string[]> {
    if (args.blockIds.length === 0) return [];
    const rows = await this.prisma.ideaBlockEntity.findMany({
      where: {
        blockId: { in: args.blockIds },
        role: 'subject',
        entity: { type: 'person' },
      },
      select: { entityId: true },
    });
    if (rows.length === 0) return [];
    const entityIds = [...new Set(rows.map((r) => r.entityId))];
    const persons = await this.prisma.person.findMany({
      where: {
        entityId: { in: entityIds },
        deletedAt: null,
      },
      select: { id: true },
    });
    return persons.map((p) => p.id);
  }

  private detectStatusContradiction(oldText: string, newText: string): boolean {
    const closedRe =
      /\b(закрыт|закрыто|завершён|завершен|остановлен|приостановлен|отменён|отменен)\b/i;
    const activeRe =
      /\b(активен|активна|активно|идёт|идет|развивается|продолжается|открыт|открыта)\b/i;
    const oldClosed = closedRe.test(oldText);
    const oldActive = activeRe.test(oldText);
    const newClosed = closedRe.test(newText);
    const newActive = activeRe.test(newText);
    return (oldClosed && newActive) || (oldActive && newClosed);
  }

  private buildUserMessage(args: {
    cardKind: string;
    cardName: string;
    contactName: string | null;
    contactEmail: string | null;
    blocks: BlockForRollup[];
    themes: Array<{
      id: string;
      name: string;
      description: string;
      branch: string | null;
    }>;
  }): string {
    const { cardKind, cardName, contactName, contactEmail, blocks, themes } = args;
    const header = [
      `Карточка: ${cardName}`,
      `Тип: ${cardKind}`,
      contactName ? `Контакт: ${contactName}` : null,
      contactEmail ? `Email: ${contactEmail}` : null,
    ]
      .filter((x): x is string => Boolean(x))
      .join('\n');

    const themesPart =
      themes.length > 0
        ? `\n\nТоп-темы (по числу блоков):\n${themes
            .map(
              (t, i) =>
                `${i + 1}. ${t.name}${t.branch ? ` [ветка: ${t.branch}]` : ''} — ${t.description}`,
            )
            .join('\n')}`
        : '';

    const blocksPart = blocks
      .map((b, i) => {
        const lines: string[] = [
          `Блок ${i + 1}: ${b.name} (signal: ${b.signalType})`,
          `Вопрос: ${b.criticalQuestion}`,
          `Ответ: ${b.trustedAnswer}`,
        ];
        if (b.tags.length > 0) lines.push(`Теги: ${b.tags.join(', ')}`);
        if (b.evidenceQuote) lines.push(`Цитата: «${b.evidenceQuote}»`);
        return lines.join('\n');
      })
      .join('\n\n');

    return `${header}${themesPart}\n\nБлоки (всего ${blocks.length}):\n\n${blocksPart}`;
  }
}
