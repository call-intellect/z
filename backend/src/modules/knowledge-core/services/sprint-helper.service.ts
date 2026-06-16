import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { type LlmCallResult, LlmRouterService } from '../../ai/services/llm-router.service';
import { wrapUserData } from '../../ai/services/prompts/common';
import {
  SPRINT_HELPER_SUGGEST_JSON_SCHEMA,
  SPRINT_HELPER_SUGGEST_SCHEMA_NAME,
  SPRINT_HELPER_SUGGEST_SYSTEM_PROMPT,
  SPRINT_HELPER_SUGGEST_USER_TEMPLATE,
} from '../../ai/services/prompts/sprint-helper-suggest.prompt';

interface SuggestedHint {
  kind: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string;
  affectedIssueIds: string[];
  confidence: number;
}

@Injectable()
export class SprintHelperService {
  private readonly logger = new Logger(SprintHelperService.name);

  static readonly SPECIALIST_NAME = '3-13-sprint-helper';
  private static readonly MAX_ISSUES_IN_CONTEXT = 50;
  private static readonly MAX_BLOCKS_IN_CONTEXT = 30;
  private static readonly RECENT_HINTS_DAYS = 7;
  private static readonly MIN_CONFIDENCE = 0.5;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  async runForCycle(args: {
    cycleId: string;
    tenantId: string;
    reason: 'cron' | 'meeting_completed' | 'manual';
  }): Promise<{ created: number; reused: number }> {
    const startedAt = Date.now();
    const tenantLabel = args.tenantId;
    try {
      const cycle = await this.prisma.cycle.findFirst({
        where: { id: args.cycleId, tenantId: args.tenantId },
        include: {
          project: {
            include: {
              customerCard: { select: { name: true } },
              vendor: { select: { name: true } },
              subjectPerson: { select: { name: true } },
              department: { select: { name: true } },
            },
          },
        },
      });
      if (!cycle) {
        this.metrics?.incSprintHelperRun({ tenant: tenantLabel, status: 'skipped' });
        return { created: 0, reused: 0 };
      }
      if (cycle.completedAt) {
        this.metrics?.incSprintHelperRun({ tenant: tenantLabel, status: 'skipped' });
        return { created: 0, reused: 0 };
      }

      const issues = await this.prisma.issue.findMany({
        where: {
          cycleId: cycle.id,
          tenantId: args.tenantId,
          deletedAt: null,
        },
        orderBy: [{ createdAt: 'desc' }],
        take: SprintHelperService.MAX_ISSUES_IN_CONTEXT,
        select: {
          id: true,
          identifier: true,
          title: true,
          priority: true,
          dueDate: true,
          createdAt: true,
          updatedAt: true,
          checklistTotalCount: true,
          checklistDoneCount: true,
          sourceBlockIds: true,
          state: { select: { category: true } },
          board: { select: { name: true } },
          assignees: { select: { userId: true } },
          children: { select: { id: true } },
        },
      });

      const carryOverByIssue = new Map<string, number>();
      if (issues.length > 0) {
        const rows = await this.prisma.issueActivity.groupBy({
          by: ['issueId'],
          where: {
            issueId: { in: issues.map((i) => i.id) },
            verb: { in: ['moved_from_cycle', 'cycle_changed'] },
          },
          _count: { _all: true },
        });
        for (const r of rows) {
          carryOverByIssue.set(r.issueId, r._count._all);
        }
      }

      const lastActivityByIssue = new Map<string, Date | null>();
      if (issues.length > 0) {
        const rows = await this.prisma.issueActivity.groupBy({
          by: ['issueId'],
          where: { issueId: { in: issues.map((i) => i.id) } },
          _max: { createdAt: true },
        });
        for (const r of rows) {
          lastActivityByIssue.set(r.issueId, r._max.createdAt);
        }
      }

      const meetingIds = await this.prisma.meeting
        .findMany({
          where: {
            linkedCycleId: cycle.id,
            tenantId: args.tenantId,
            deletedAt: null,
          },
          select: { id: true },
        })
        .then((rows) => rows.map((r) => r.id));

      const sourceBlockIds = new Set<string>();
      for (const i of issues) {
        for (const b of i.sourceBlockIds) sourceBlockIds.add(b);
      }
      void meetingIds;

      const blocks =
        sourceBlockIds.size > 0
          ? await this.prisma.ideaBlock.findMany({
              where: {
                id: { in: [...sourceBlockIds] },
                tenantId: args.tenantId,
                status: { in: ['canonical', 'draft'] },
              },
              orderBy: [{ updatedAt: 'desc' }],
              take: SprintHelperService.MAX_BLOCKS_IN_CONTEXT,
              select: {
                name: true,
                criticalQuestion: true,
                trustedAnswer: true,
                tags: true,
              },
            })
          : [];

      const recentCutoff = new Date(Date.now() - SprintHelperService.RECENT_HINTS_DAYS * 86400_000);
      const recentHints = await this.prisma.sprintHint.findMany({
        where: {
          cycleId: cycle.id,
          tenantId: args.tenantId,
          createdAt: { gte: recentCutoff },
        },
        orderBy: [{ createdAt: 'desc' }],
        take: 50,
        select: {
          kind: true,
          title: true,
          affectedIssueIds: true,
          status: true,
          createdAt: true,
        },
      });

      const userMessage = SPRINT_HELPER_SUGGEST_USER_TEMPLATE({
        cycleName: cycle.name,
        scopeLabel: this.buildScopeLabel(cycle.project),
        startDate: cycle.startDate.toISOString().slice(0, 10),
        endDate: cycle.endDate.toISOString().slice(0, 10),
        description: cycle.description,
        progress: this.computeProgressSummary(issues),
        issues: issues.map((i) => ({
          identifier: i.identifier,
          id: i.id,
          title: i.title,
          stateCategory: i.state?.category ?? null,
          priority: i.priority,
          dueDate: i.dueDate?.toISOString() ?? null,
          assigneeUserIds: i.assignees.map((a) => a.userId),
          boardName: i.board?.name ?? null,
          checklistTotalCount: i.checklistTotalCount,
          checklistDoneCount: i.checklistDoneCount,
          childrenCount: i.children.length,
          createdAt: i.createdAt.toISOString(),
          lastActivityAt: lastActivityByIssue.get(i.id)?.toISOString() ?? null,
          carryOverCount: carryOverByIssue.get(i.id) ?? 0,
        })),
        recentBlocks: blocks,
        recentHints: recentHints.map((h) => ({
          kind: h.kind,
          title: h.title,
          affectedIssueIds: h.affectedIssueIds,
          status: h.status,
          createdAt: h.createdAt.toISOString(),
        })),
        now: new Date().toISOString(),
      });

      const guardedUser = wrapUserData(userMessage);

      let result: LlmCallResult;
      try {
        result = await this.llm.call({
          taskType: 'sprint-helper-suggest',
          systemPrompt: SPRINT_HELPER_SUGGEST_SYSTEM_PROMPT,
          userMessage: guardedUser,
          tenantId: args.tenantId,
          responseFormat: {
            type: 'json_schema',
            name: SPRINT_HELPER_SUGGEST_SCHEMA_NAME,
            schema: SPRINT_HELPER_SUGGEST_JSON_SCHEMA,
            strict: true,
          },
          sourceRef: { type: 'cycle', id: cycle.id },
          dataClass: 'internal',
        });
      } catch (err) {
        this.metrics?.incSprintHelperRun({ tenant: tenantLabel, status: 'failed' });
        this.logger.warn(
          {
            cycleId: cycle.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'sprint-helper.runForCycle: LLM call failed — пропускаем',
        );
        return { created: 0, reused: 0 };
      }

      let parsed: { hints?: SuggestedHint[] } = {};
      try {
        parsed = JSON.parse(result.text);
      } catch {
        this.metrics?.incSprintHelperRun({ tenant: tenantLabel, status: 'failed' });
        return { created: 0, reused: 0 };
      }
      const suggested = Array.isArray(parsed.hints) ? parsed.hints : [];

      let created = 0;
      let reused = 0;
      for (const h of suggested) {
        if (!h || typeof h !== 'object') continue;
        if (h.confidence < SprintHelperService.MIN_CONFIDENCE) continue;
        const contentHash = createHash('sha1')
          .update(`${h.kind}\n${h.title}\n${h.body}`)
          .digest('hex')
          .slice(0, 32);
        const existing = await this.prisma.sprintHint.findFirst({
          where: {
            cycleId: cycle.id,
            tenantId: args.tenantId,
            kind: h.kind as Prisma.EnumSprintHintKindFilter,
            contentHash,
          },
        });
        if (existing) {
          reused++;
          continue;
        }
        await this.prisma.sprintHint.create({
          data: {
            tenantId: args.tenantId,
            cycleId: cycle.id,
            kind: h.kind as Prisma.SprintHintCreateInput['kind'],
            severity: h.severity,
            title: h.title.slice(0, 300),
            body: h.body.slice(0, 4_000),
            affectedIssueIds: Array.isArray(h.affectedIssueIds)
              ? h.affectedIssueIds.slice(0, 20)
              : [],
            sourceBlockIds: [],
            status: 'active',
            confidence: new Prisma.Decimal(Math.max(0, Math.min(1, h.confidence))),
            contentHash,
          },
        });
        this.metrics?.incSprintHint({
          tenant: tenantLabel,
          kind: h.kind,
          status: 'active',
        });
        created++;
      }

      this.metrics?.incSprintHelperRun({
        tenant: tenantLabel,
        status: 'success',
      });
      return { created, reused };
    } finally {
      this.metrics?.observeSprintHelperDuration({
        tenant: tenantLabel,
        seconds: (Date.now() - startedAt) / 1000,
      });
    }
  }

  private computeProgressSummary(issues: ReadonlyArray<{ state: { category: string } | null }>): {
    total: number;
    completed: number;
    inProgress: number;
  } {
    let completed = 0;
    let inProgress = 0;
    for (const i of issues) {
      const cat = i.state?.category;
      if (cat === 'completed') completed++;
      else if (cat === 'started') inProgress++;
    }
    return { total: issues.length, completed, inProgress };
  }

  private buildScopeLabel(project: {
    name: string;
    customerCard: { name: string } | null;
    vendor: { name: string } | null;
    subjectPerson: { name: string } | null;
    department: { name: string } | null;
  }): string {
    if (project.customerCard) return `Клиент: ${project.customerCard.name}`;
    if (project.vendor) return `Поставщик: ${project.vendor.name}`;
    if (project.subjectPerson) return `Сотрудник: ${project.subjectPerson.name}`;
    if (project.department) return `Отдел: ${project.department.name}`;
    return `Проект: ${project.name}`;
  }
}
