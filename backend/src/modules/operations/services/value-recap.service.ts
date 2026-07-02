import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { ChatV2FeedbackService } from '../../chat-v2/services/chat-v2-feedback.service';
import {
  buildValueRecapFallbackNarrative,
  buildValueRecapNarrativeUserMessage,
  VALUE_RECAP_NARRATIVE_SYSTEM_PROMPT,
  VALUE_RECAP_NARRATIVE_TASK_TYPE,
  type ValueRecapNarrativePromptInput,
} from '../prompts/value-recap-narrative.prompt';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

import {
  assembleValueRecapPayload,
  type ValueRecapPayload,
  type ValueRecapRoutine,
  type ValueRecapTeam,
} from './value-recap.scoring';

@Injectable()
export class ValueRecapService {
  private readonly logger = new Logger(ValueRecapService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(ChatV2FeedbackService)
    private readonly chatFeedback: ChatV2FeedbackService,
  ) {}

  async build(args: {
    tenantId: string;
    periodYm: string;
    now?: Date;
  }): Promise<{ id: string; payload: ValueRecapPayload; alreadyDelivered: boolean }> {
    const now = args.now ?? new Date();
    const { from, to } = monthBounds(args.periodYm);

    const routine = await this.computeRoutine(args.tenantId, from, to);

    const team = await this.computeTeam({ tenantId: args.tenantId, from, to });

    const prevPeriod = shiftPeriod(args.periodYm, -1);
    const previousRoutine = await this.loadPreviousRoutine(args.tenantId, prevPeriod);

    const promptInput = this.buildPromptInput({
      periodYm: args.periodYm,
      routine,
      team,
      previousRoutine,
    });
    const narrative = await this.buildNarrative(args.tenantId, promptInput);

    const payload = assembleValueRecapPayload({
      periodYm: args.periodYm,
      builtAt: now,
      routine,
      team,
      previousRoutine,
      narrative,
    });

    const existing = await this.prisma.valueRecapSnapshot.findUnique({
      where: {
        tenantId_periodYm: { tenantId: args.tenantId, periodYm: args.periodYm },
      },
      select: { id: true, deliveredAt: true },
    });
    const row = await this.prisma.valueRecapSnapshot.upsert({
      where: {
        tenantId_periodYm: { tenantId: args.tenantId, periodYm: args.periodYm },
      },
      create: {
        tenantId: args.tenantId,
        periodYm: args.periodYm,
        payloadJson: payload as unknown as Prisma.InputJsonValue,
      },
      update: {
        payloadJson: payload as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    this.metrics.incValueRecapBuilt();
    this.logger.log(
      {
        tenantId: args.tenantId,
        tenantTop: resolveOperationsTenantTop(args.tenantId),
        periodYm: args.periodYm,
        isBaseline: payload.isBaseline,
      },
      'value-recap: build завершён',
    );

    return {
      id: row.id,
      payload,
      alreadyDelivered: existing?.deliveredAt != null,
    };
  }

  async getSnapshot(args: { tenantId: string; periodYm: string }): Promise<{
    id: string;
    periodYm: string;
    payload: ValueRecapPayload | null;
    deliveredAt: string | null;
    openedAt: string | null;
    createdAt: string;
  } | null> {
    const row = await this.prisma.valueRecapSnapshot.findUnique({
      where: {
        tenantId_periodYm: { tenantId: args.tenantId, periodYm: args.periodYm },
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      periodYm: row.periodYm,
      payload: parsePayload(row.payloadJson),
      deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
      openedAt: row.openedAt ? row.openedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async getLatestPeriodWithData(tenantId: string): Promise<string | null> {
    const row = await this.prisma.valueRecapSnapshot.findFirst({
      where: { tenantId },
      orderBy: { periodYm: 'desc' },
      select: { periodYm: true },
    });
    return row?.periodYm ?? null;
  }

  async getById(args: { tenantId: string; id: string }): Promise<{
    id: string;
    periodYm: string;
    payload: ValueRecapPayload | null;
    deliveredAt: string | null;
    openedAt: string | null;
    createdAt: string;
  } | null> {
    const row = await this.prisma.valueRecapSnapshot.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
    });
    if (!row) return null;
    return {
      id: row.id,
      periodYm: row.periodYm,
      payload: parsePayload(row.payloadJson),
      deliveredAt: row.deliveredAt ? row.deliveredAt.toISOString() : null,
      openedAt: row.openedAt ? row.openedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async markOpened(args: { tenantId: string; id: string }): Promise<boolean> {
    const row = await this.prisma.valueRecapSnapshot.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
      select: { id: true, openedAt: true },
    });
    if (!row) return false;
    if (row.openedAt) return true;
    await this.prisma.valueRecapSnapshot.update({
      where: { id: row.id },
      data: { openedAt: new Date() },
    });
    this.metrics.incValueRecapOpened();
    return true;
  }

  async markDelivered(id: string): Promise<void> {
    await this.prisma.valueRecapSnapshot.update({
      where: { id },
      data: { deliveredAt: new Date() },
    });
  }

  private async computeRoutine(tenantId: string, from: Date, to: Date): Promise<ValueRecapRoutine> {
    const [
      meetingsAutoProtocoled,
      tasksExtracted,
      decisionsExtracted,
      commitmentsExtracted,
      statusesCollected,
      ideasShipped,
    ] = await Promise.all([
      this.prisma.aiResult.count({
        where: {
          meeting: { tenantId, createdAt: { gte: from, lte: to } },
        },
      }),
      this.prisma.issue.count({
        where: { tenantId, createdAt: { gte: from, lte: to }, deletedAt: null, archivedAt: null },
      }),
      this.prisma.decision.count({
        where: { tenantId, createdAt: { gte: from, lte: to }, deletedAt: null },
      }),
      this.prisma.ideaBlock.count({
        where: {
          tenantId,
          signalType: 'commitment',
          createdAt: { gte: from, lte: to },
        },
      }),
      this.prisma.dailyCheckIn.count({
        where: {
          tenantId,
          completedAt: { gte: from, lte: to, not: null },
        },
      }),
      this.prisma.idea.count({
        where: {
          tenantId,
          status: 'shipped',
          OR: [
            { statusChangedAt: { gte: from, lte: to } },
            { statusChangedAt: null, updatedAt: { gte: from, lte: to } },
          ],
        },
      }),
    ]);

    const chat = await this.chatFeedback.getChatUsageStats({
      tenantId,
      from,
      to,
      scope: 'org',
    });

    return {
      meetingsAutoProtocoled: nz(meetingsAutoProtocoled),
      tasksExtracted: nz(tasksExtracted),
      decisionsExtracted: nz(decisionsExtracted),
      commitmentsExtracted: nz(commitmentsExtracted),
      statusesCollected: nz(statusesCollected),
      questionsAnsweredWithCitation: chat.answeredWithCitation,
      ideasShipped: nz(ideasShipped),
    };
  }

  private async computeTeam(args: {
    tenantId: string;
    from: Date;
    to: Date;
  }): Promise<ValueRecapTeam> {
    const chat = await this.chatFeedback.getChatUsageStats({
      tenantId: args.tenantId,
      from: args.from,
      to: args.to,
      scope: 'org',
    });

    const ideasShipped = await this.prisma.idea.count({
      where: {
        tenantId: args.tenantId,
        status: 'shipped',
        OR: [
          { statusChangedAt: { gte: args.from, lte: args.to } },
          { statusChangedAt: null, updatedAt: { gte: args.from, lte: args.to } },
        ],
      },
    });

    return {
      chatHelpedRatePercent: chat.helpedRatePercent,
      chatRated: chat.rated,
      chatAnsweredWithCitation: chat.answeredWithCitation,
      ideasShipped: nz(ideasShipped),
      estimate: true,
    };
  }

  private async loadPreviousRoutine(
    tenantId: string,
    prevPeriodYm: string,
  ): Promise<ValueRecapRoutine | null> {
    const prev = await this.prisma.valueRecapSnapshot.findUnique({
      where: {
        tenantId_periodYm: { tenantId, periodYm: prevPeriodYm },
      },
      select: { payloadJson: true },
    });
    if (!prev) return null;
    const payload = parsePayload(prev.payloadJson);
    return payload?.routine ?? null;
  }

  private buildPromptInput(args: {
    periodYm: string;
    routine: ValueRecapRoutine;
    team: ValueRecapTeam;
    previousRoutine: ValueRecapRoutine | null;
  }): ValueRecapNarrativePromptInput {
    const prev = args.previousRoutine;
    return {
      periodYm: args.periodYm,
      routine: {
        meetingsAutoProtocoled: args.routine.meetingsAutoProtocoled,
        tasksExtracted: args.routine.tasksExtracted,
        decisionsExtracted: args.routine.decisionsExtracted,
        commitmentsExtracted: args.routine.commitmentsExtracted,
        statusesCollected: args.routine.statusesCollected,
        questionsAnsweredWithCitation: args.routine.questionsAnsweredWithCitation,
        ideasShipped: args.routine.ideasShipped,
      },
      team: {
        chatHelpedRatePercent: args.team.chatHelpedRatePercent,
        chatRated: args.team.chatRated,
      },
      delta: prev
        ? {
            meetingsAutoProtocoled:
              args.routine.meetingsAutoProtocoled - prev.meetingsAutoProtocoled,
            tasksExtracted: args.routine.tasksExtracted - prev.tasksExtracted,
            decisionsExtracted: args.routine.decisionsExtracted - prev.decisionsExtracted,
          }
        : null,
    };
  }

  private async buildNarrative(
    tenantId: string,
    promptInput: ValueRecapNarrativePromptInput,
  ): Promise<string> {
    try {
      const result = await this.llm.call({
        taskType: VALUE_RECAP_NARRATIVE_TASK_TYPE,
        tenantId,
        systemPrompt: VALUE_RECAP_NARRATIVE_SYSTEM_PROMPT,
        userMessage: buildValueRecapNarrativeUserMessage(promptInput),
        maxTokens: 400,
        sourceRef: { type: 'value-recap', id: tenantId },
      });
      const text = (result.text ?? '').trim();
      if (text.length > 0) return text.slice(0, 1_500);
      return buildValueRecapFallbackNarrative(promptInput);
    } catch (err) {
      this.logger.warn(
        {
          tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'value-recap: LLM narrative упал — fallback',
      );
      return buildValueRecapFallbackNarrative(promptInput);
    }
  }
}

function parsePayload(raw: Prisma.JsonValue): ValueRecapPayload | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as unknown as ValueRecapPayload;
  }
  return null;
}

export function monthBounds(periodYm: string): { from: Date; to: Date } {
  const m = periodYm.match(/^(\d{4})-(\d{2})$/);
  const year = m ? Number(m[1]) : new Date().getUTCFullYear();
  const month = m ? Number(m[2]) - 1 : new Date().getUTCMonth();
  const from = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  const to = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
  return { from, to };
}

export function shiftPeriod(periodYm: string, months: number): string {
  const m = periodYm.match(/^(\d{4})-(\d{2})$/);
  const year = m ? Number(m[1]) : new Date().getUTCFullYear();
  const month = m ? Number(m[2]) - 1 : new Date().getUTCMonth();
  const d = new Date(Date.UTC(year, month + months, 1));
  const y = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${mm}`;
}

function nz(v: number): number {
  return Number.isFinite(v) && v > 0 ? v : 0;
}
