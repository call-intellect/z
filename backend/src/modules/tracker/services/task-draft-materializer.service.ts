import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/typed-config.service';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { computeExpiresAt } from '../../pending-actions/expires-at.util';

import { AssigneeResolverService } from './assignee-resolver.service';
import { IntakeAutoTriageQueueService } from './intake-auto-triage-queue.service';
import { SkillRoutingService } from './skill-routing.service';
import { TaskDedupService } from './task-dedup.service';
import { shouldMaterializeTask } from './task-quality-gate.util';

export interface TaskDraftInput {
  title: string;
  assignee?: string | null;
  dueDate?: string | null;
  suggestedAssigneeHint?: string | null;
  suggestedDueDate?: string | null;
  suggestedPriority?: 'urgent' | 'high' | 'medium' | 'low' | null;
  confidence?: number | null;
  sourceQuote?: string | null;
  subtasks?: Array<{ title: string }> | null;
  sourceBlockId?: string | null;
}

export interface MaterializedTask {
  id: string;
  title: string;
  confidence: number | null;
}

export interface MaterializeArgs {
  tenantId: string;
  channel: string;
  sourceId: string;
  sourceTitle?: string | null;
  drafts: TaskDraftInput[];
}

function clampConfidence(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return Math.round(v * 1000) / 1000;
}

@Injectable()
export class TaskDraftMaterializerService {
  private readonly logger = new Logger(TaskDraftMaterializerService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TaskDedupService) private readonly taskDedup: TaskDedupService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Optional()
    @Inject(AssigneeResolverService)
    private readonly orgAssigneeResolver?: AssigneeResolverService,
    @Optional()
    @Inject(SkillRoutingService)
    private readonly skillRouting?: SkillRoutingService,
    @Optional()
    @Inject(IntakeAutoTriageQueueService)
    private readonly autoTriageQueue?: IntakeAutoTriageQueueService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  async materialize(args: MaterializeArgs): Promise<MaterializedTask[]> {
    const { tenantId, channel } = args;
    const created: MaterializedTask[] = [];
    let skipped = 0;

    for (const draft of args.drafts) {
      const title = draft.title.trim();
      if (!title) continue;
      const sourceQuote = (draft.sourceQuote ?? '').trim();
      const externalId = this.makeExternalId(channel, args.sourceId, sourceQuote || title);

      const existing = await this.prisma.intakeIssue.findFirst({
        where: { tenantId, externalSource: channel, externalId },
        select: { id: true },
      });
      if (existing) {
        this.metrics?.incTaskDraftMaterialized({ channel, status: 'skipped_idempotent' });
        skipped++;
        continue;
      }

      const hint = (draft.suggestedAssigneeHint ?? draft.assignee ?? '').trim();
      let suggestedAssigneeId: string | null = null;
      if (hint && this.orgAssigneeResolver) {
        try {
          const r = await this.orgAssigneeResolver.resolve(tenantId, hint);
          suggestedAssigneeId = r.kind === 'resolved' ? r.userId : null;
        } catch {
          suggestedAssigneeId = null;
        }
      }
      if (suggestedAssigneeId == null && this.skillRouting && this.cfg.taskRouting.enabled) {
        try {
          const taskText = [title, draft.suggestedAssigneeHint, sourceQuote]
            .filter(Boolean)
            .join(' ')
            .trim();
          if (taskText.length > 0) {
            const sugg = await this.skillRouting.suggestAssignee({ tenantId, taskText });
            const top = sugg[0];
            const minConf = this.cfg.taskRouting.autoAssignMinConfidence;
            if (top && top.userId && top.confidence >= minConf) {
              suggestedAssigneeId = top.userId;
              this.metrics?.incTaskSkillRoutingAssigned({ path: 'conversation' });
            }
          }
        } catch {
          suggestedAssigneeId = null;
        }
      }

      const suggestedProjectId = await this.resolveProjectIdByTitle(
        tenantId,
        args.sourceTitle ?? '',
      );
      const suggestedDueDate = this.parseIsoDate(draft.suggestedDueDate ?? null);
      let suggestedPriority = draft.suggestedPriority ?? null;
      const confidenceDecimal: Prisma.Decimal | null =
        typeof draft.confidence === 'number'
          ? new Prisma.Decimal(clampConfidence(draft.confidence))
          : null;

      const gate = shouldMaterializeTask({
        title,
        ownerUserId: suggestedAssigneeId,
        ownerHint: draft.suggestedAssigneeHint ?? draft.assignee ?? null,
        dueDate: suggestedDueDate,
        source: channel,
      });
      if (!gate.ok) {
        if (suggestedPriority == null) suggestedPriority = 'low';
        this.logger.log(
          { channel, sourceId: args.sourceId, title, reason: gate.reason },
          'task-draft-materializer: задача низкого качества — создаём в intake (не дропаем)',
        );
      }

      let suggestedDuplicateOfIssueId: string | null = null;
      try {
        const v = await this.taskDedup.evaluate({
          tenantId,
          title,
          description: sourceQuote || null,
        });
        if (v.verdict === 'same') suggestedDuplicateOfIssueId = v.matchedIssueId;
      } catch {
        suggestedDuplicateOfIssueId = null;
      }

      const checklistItems =
        draft.subtasks && draft.subtasks.length > 0
          ? draft.subtasks
              .map((s) => ({ text: String(s.title).slice(0, 500) }))
              .filter((i) => i.text.trim().length > 0)
              .slice(0, 50)
          : [];
      const checklistJson =
        checklistItems.length > 0 ? [{ items: checklistItems }] : null;

      const rawContent =
        sourceQuote.length > 0 ? `${title}\n\nЦитата: ${sourceQuote}` : title;

      const issue = await this.prisma.intakeIssue.create({
        data: {
          tenantId,
          projectId: suggestedProjectId,
          status: 'pending',
          source: channel,
          externalSource: channel,
          externalId,
          rawContent,
          extractedTitle: title,
          extractedDescription: sourceQuote || null,
          suggestedProjectId,
          suggestedAssigneeId,
          suggestedGoalId: null,
          suggestedPriority,
          suggestedDueDate,
          suggestedLabels: [],
          suggestedDuplicateOfIssueId,
          sourceBlockIds: draft.sourceBlockId ? [draft.sourceBlockId] : [],
          meetingId: channel === 'meeting' ? args.sourceId : null,
          confidence: confidenceDecimal,
          checklistJson: checklistJson ?? Prisma.JsonNull,
          expiresAt: computeExpiresAt(this.cfg.pendingActions.intakeTtlDays),
        },
        select: { id: true },
      });
      created.push({
        id: issue.id,
        title,
        confidence:
          typeof draft.confidence === 'number' ? clampConfidence(draft.confidence) : null,
      });

      if (this.autoTriageQueue) {
        try {
          await this.autoTriageQueue.enqueue({ tenantId, intakeIssueId: issue.id });
        } catch (e) {
          this.logger.warn(
            {
              intakeIssueId: issue.id,
              err: e instanceof Error ? e.message : String(e),
            },
            'task-draft-materializer: enqueue auto-triage упал — продолжаем',
          );
        }
      }
    }

    if (created.length > 0) {
      this.metrics?.incTaskDraftMaterialized({
        channel,
        status: 'created',
        by: created.length,
      });
    }
    this.logger.log(
      {
        channel,
        sourceId: args.sourceId,
        created: created.length,
        skippedIdempotent: skipped,
      },
      '[PIPE] task-materializer',
    );
    this.logger.log(
      { channel, sourceId: args.sourceId, created: created.length, skipped },
      'task-draft-materializer: готово',
    );
    return created;
  }

  private makeExternalId(channel: string, sourceId: string, key: string): string {
    const h = createHash('sha1');
    h.update(`${channel}:${sourceId}:${key}`);
    return `mat_${h.digest('hex').slice(0, 24)}`;
  }

  private async resolveProjectIdByTitle(
    tenantId: string,
    title: string,
  ): Promise<string | null> {
    if (!title) return null;
    const tokens = title.match(/[A-ZА-Я][A-ZА-Я0-9-]{1,5}/gu) ?? [];
    for (const tok of tokens) {
      const p = await this.prisma.project.findFirst({
        where: {
          tenantId,
          deletedAt: null,
          archivedAt: null,
          identifier: { equals: tok, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (p) return p.id;
    }
    return null;
  }

  private parseIsoDate(s: string | null | undefined): Date | null {
    if (!s) return null;
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
    if (!m) return null;
    const d = new Date(`${m[1]}T00:00:00.000Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
}
