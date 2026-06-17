import { createHash } from 'node:crypto';

import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma, type IntakeIssue } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/typed-config.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { BlockFetchService } from '../../knowledge-core/services/block-fetch.service';
import { computeExpiresAt } from '../../pending-actions/expires-at.util';
import type { CreateIntakeDto, ListIntakeQuery } from '../dto/intake/create-intake.dto';
import type { TriageIntakeDto, UpdateIntakeDto } from '../dto/intake/triage-intake.dto';
import type { IssueResponseDto } from '../dto/issues/issue-response.dto';

import { linkDerivedDecisionsForIssue } from './decision-task-link.util';
import { IntakeAutoTriageQueueService } from './intake-auto-triage-queue.service';
import { IssuesService } from './issues.service';
import { ProjectsService } from './projects.service';
import { TrackerEventsService } from './tracker-events.service';
import { WebhookDispatcher } from './webhook-dispatcher.service';

export interface IntakeResponseDto {
  id: string;
  tenantId: string;
  projectId: string | null;
  status: string;
  source: string;
  sourceEmail: string | null;
  externalSource: string | null;
  externalId: string | null;
  rawContent: string;
  extractedTitle: string | null;
  extractedDescription: string | null;
  suggestedProjectId: string | null;
  suggestedAssigneeId: string | null;
  suggestedGoalId: string | null;
  suggestedProjectName: string | null;
  suggestedAssigneeName: string | null;
  suggestedGoalTitle: string | null;
  suggestedPriority: string | null;
  suggestedDueDate: string | null;
  suggestedLabels: string[];
  sourceBlockIds: string[];
  confidence: string | null;
  triagedByUserId: string | null;
  triagedAt: string | null;
  rejectedReason: string | null;
  snoozedUntil: string | null;
  createdIssueId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListIntakeResponse {
  items: IntakeResponseDto[];
  total: number;
  page: number;
  limit: number;
}

interface SuggestedNameMaps {
  projectNames: Map<string, string>;
  goalTitles: Map<string, string>;
  assigneeNames: Map<string, string>;
}

export interface TriageIntakeResult {
  intake: IntakeResponseDto;
  createdIssue: IssueResponseDto | null;
}

@Injectable()
export class IntakeService {
  private readonly logger = new Logger(IntakeService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IssuesService) private readonly issues: IssuesService,
    @Inject(TrackerEventsService)
    private readonly events: TrackerEventsService,
    @Inject(WebhookDispatcher)
    private readonly webhooks: WebhookDispatcher,
    @Inject(TypedConfigService)
    private readonly cfg: TypedConfigService,
    @Optional()
    @Inject(IntakeAutoTriageQueueService)
    private readonly autoTriageQueue?: IntakeAutoTriageQueueService,
    @Optional()
    @Inject(BlockFetchService)
    private readonly blockFetch?: BlockFetchService,
    @Optional()
    @Inject(ProjectsService)
    private readonly projects?: ProjectsService,
  ) {}

  private static readonly INBOX_PROJECT_NAME = 'Входящие';

  private async ensureInboxProjectId(tenantId: string): Promise<string | null> {
    if (!this.projects) return null;
    const findExisting = (): Promise<{ id: string } | null> =>
      this.prisma.project.findFirst({
        where: {
          tenantId,
          name: IntakeService.INBOX_PROJECT_NAME,
          deletedAt: null,
          archivedAt: null,
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
    const existing = await findExisting();
    if (existing) return existing.id;
    const org = await this.prisma.org.findUnique({
      where: { id: tenantId },
      select: { ownerId: true },
    });
    const ownerId = org?.ownerId ?? null;
    if (!ownerId) return null;
    try {
      const created = await this.projects.create(
        {
          name: IntakeService.INBOX_PROJECT_NAME,
          description:
            'Задачи из внешних каналов без определённого проекта. Создан Корой автоматически (авто-приём входящих).',
          network: 0,
          timezone: 'Europe/Moscow',
          cycleViewEnabled: true,
          intakeViewEnabled: true,
          gantViewEnabled: false,
          timeTrackingEnabled: false,
        },
        tenantId,
        ownerId,
      );
      return created.id;
    } catch {
      const retry = await findExisting();
      return retry?.id ?? null;
    }
  }

  async create(dto: CreateIntakeDto, tenantId: string): Promise<IntakeResponseDto> {
    const created = await this.prisma.intakeIssue.create({
      data: {
        tenantId,
        projectId: dto.projectId ?? null,
        source: dto.source,
        sourceEmail: dto.sourceEmail ?? null,
        externalSource: dto.externalSource ?? null,
        externalId: dto.externalId ?? null,
        rawContent: dto.rawContent,
        extractedTitle: dto.extractedTitle ?? null,
        extractedDescription: dto.extractedDescription ?? null,
        suggestedProjectId: dto.suggestedProjectId ?? null,
        suggestedAssigneeId: dto.suggestedAssigneeId ?? null,
        suggestedGoalId: dto.suggestedGoalId ?? null,
        suggestedPriority: dto.suggestedPriority ?? null,
        suggestedDueDate: dto.suggestedDueDate ?? null,
        suggestedLabels: dto.suggestedLabels,
        sourceBlockIds: dto.sourceBlockIds,
        confidence: dto.confidence != null ? new Prisma.Decimal(dto.confidence) : null,
        expiresAt: computeExpiresAt(this.cfg.pendingActions.intakeTtlDays),
      },
    });
    const response = this.toResponse(created);
    this.events.publishIntakeNewItem(created.id, tenantId);
    void this.webhooks.dispatch(tenantId, 'intake.created', { intake: response }).catch((e) => {
      this.logger.warn(
        { intakeId: created.id, err: e instanceof Error ? e.message : String(e) },
        'intake.created webhook dispatch failed',
      );
    });
    if (this.autoTriageQueue) {
      void this.autoTriageQueue.enqueue({ tenantId, intakeIssueId: created.id }).catch((e) => {
        this.logger.warn(
          {
            intakeId: created.id,
            err: e instanceof Error ? e.message : String(e),
          },
          'intake-auto-triage enqueue failed (best-effort)',
        );
      });
    }
    return response;
  }

  async createFromMeetingNextStep(args: {
    meetingId: string;
    text: string;
    description?: string | null;
    sourceBlockIds?: string[] | null;
    tenantId: string;
  }): Promise<IntakeResponseDto> {
    const { meetingId, tenantId } = args;
    const text = args.text.trim();
    if (text.length === 0) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'text_required', message: 'Текст следующего шага пуст' },
      });
    }

    const meeting = await this.prisma.meeting.findFirst({
      where: { id: meetingId, tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!meeting) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'meeting_not_found', message: 'Встреча не найдена' },
      });
    }

    const textHash = createHash('sha1').update(text).digest('hex').slice(0, 16);
    const externalId = `meeting:${meetingId}:${textHash}`.slice(0, 200);

    const existing = await this.prisma.intakeIssue.findFirst({
      where: { tenantId, source: 'meeting', externalSource: 'meeting', externalId },
    });
    if (existing) {
      this.logger.debug(
        { meetingId, externalId },
        'intake from next-step: дубль — возвращаем существующий',
      );
      return this.toResponse(existing);
    }

    const explicit = (args.sourceBlockIds ?? []).filter(
      (s): s is string => typeof s === 'string' && s.length > 0,
    );
    const sourceBlockIds =
      explicit.length > 0 ? explicit : await this.resolveMeetingSourceBlockIds(meetingId, tenantId);

    return this.create(
      {
        source: 'meeting',
        rawContent: text,
        extractedTitle: text.slice(0, 120),
        extractedDescription: args.description?.trim() || null,
        externalSource: 'meeting',
        externalId,
        suggestedLabels: [],
        sourceBlockIds,
      },
      tenantId,
    );
  }

  private async resolveMeetingSourceBlockIds(
    meetingId: string,
    tenantId: string,
  ): Promise<string[]> {
    if (!this.blockFetch) return [];
    try {
      const blocks = await this.blockFetch.getCanonicalBlocksForMeeting(meetingId, tenantId);
      const ACTION_SIGNALS = new Set(['commitment', 'plan_item', 'task_created', 'decision']);
      const ids = blocks.filter((b) => ACTION_SIGNALS.has(b.signalType)).map((b) => b.id);
      return ids.slice(0, 64);
    } catch (e) {
      this.logger.warn(
        {
          meetingId,
          err: e instanceof Error ? e.message : String(e),
        },
        'intake from next-step: резолв sourceBlockIds упал — пустой провенанс',
      );
      return [];
    }
  }

  async findAll(
    tenantId: string,
    query: ListIntakeQuery,
    userId?: string,
  ): Promise<ListIntakeResponse> {
    const where: Prisma.IntakeIssueWhereInput = { tenantId };
    if (query.status) where.status = query.status;
    if (query.source) where.source = query.source;
    if (query.projectId) where.projectId = query.projectId;

    const pendingDefaultView = query.status === undefined || query.status === 'pending';
    if (pendingDefaultView && userId) {
      const snoozedIds = await this.loadSnoozedIntakeIds(tenantId, userId);
      if (snoozedIds.length > 0) {
        where.id = { notIn: snoozedIds };
      }
    }

    const [items, total] = await Promise.all([
      this.prisma.intakeIssue.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        take: query.limit,
        skip: (query.page - 1) * query.limit,
      }),
      this.prisma.intakeIssue.count({ where }),
    ]);
    const names = await this.resolveSuggestedNames(tenantId, items);
    return {
      items: items.map((i) => this.toResponse(i, names)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  private async loadSnoozedIntakeIds(tenantId: string, userId: string): Promise<string[]> {
    const rows = await this.prisma.pendingActionSnooze.findMany({
      where: {
        tenantId,
        userId,
        source: 'intake',
        snoozedUntil: { gt: new Date() },
      },
      select: { resourceId: true },
    });
    return rows.map((r) => r.resourceId);
  }

  private async resolveSuggestedNames(
    tenantId: string,
    items: IntakeIssue[],
  ): Promise<SuggestedNameMaps> {
    const projectIds = new Set<string>();
    const goalIds = new Set<string>();
    const assigneeUserIds = new Set<string>();
    for (const i of items) {
      if (i.suggestedProjectId) projectIds.add(i.suggestedProjectId);
      if (i.suggestedGoalId) goalIds.add(i.suggestedGoalId);
      if (i.suggestedAssigneeId) assigneeUserIds.add(i.suggestedAssigneeId);
    }

    const [projects, goals, persons] = await Promise.all([
      projectIds.size > 0
        ? this.prisma.project.findMany({
            where: { id: { in: [...projectIds] }, tenantId },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as { id: string; name: string }[]),
      goalIds.size > 0
        ? this.prisma.goal.findMany({
            where: { id: { in: [...goalIds] }, tenantId },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as { id: string; name: string }[]),
      assigneeUserIds.size > 0
        ? this.prisma.person.findMany({
            where: { userId: { in: [...assigneeUserIds] }, tenantId },
            select: { userId: true, name: true },
          })
        : Promise.resolve([] as { userId: string | null; name: string }[]),
    ]);

    const projectNames = new Map<string, string>();
    for (const p of projects) projectNames.set(p.id, p.name);
    const goalTitles = new Map<string, string>();
    for (const g of goals) goalTitles.set(g.id, g.name);
    const assigneeNames = new Map<string, string>();
    for (const p of persons) {
      if (p.userId) assigneeNames.set(p.userId, p.name);
    }

    return { projectNames, goalTitles, assigneeNames };
  }

  async update(
    id: string,
    dto: UpdateIntakeDto,
    tenantId: string,
    _userId: string,
  ): Promise<IntakeResponseDto> {
    await this.requireIntake(id, tenantId);
    const updated = await this.prisma.intakeIssue.update({
      where: { id },
      data: {
        ...(dto.extractedTitle !== undefined && {
          extractedTitle: dto.extractedTitle,
        }),
        ...(dto.extractedDescription !== undefined && {
          extractedDescription: dto.extractedDescription,
        }),
        ...(dto.projectId !== undefined && { projectId: dto.projectId }),
        ...(dto.suggestedProjectId !== undefined && {
          suggestedProjectId: dto.suggestedProjectId,
        }),
        ...(dto.suggestedAssigneeId !== undefined && {
          suggestedAssigneeId: dto.suggestedAssigneeId,
        }),
        ...(dto.suggestedGoalId !== undefined && {
          suggestedGoalId: dto.suggestedGoalId,
        }),
        ...(dto.suggestedPriority !== undefined && {
          suggestedPriority: dto.suggestedPriority,
        }),
        ...(dto.suggestedDueDate !== undefined && {
          suggestedDueDate: dto.suggestedDueDate,
        }),
        ...(dto.suggestedLabels !== undefined && {
          suggestedLabels: dto.suggestedLabels,
        }),
      },
    });
    return this.toResponse(updated);
  }

  async triage(
    id: string,
    dto: TriageIntakeDto,
    tenantId: string,
    userId: string,
  ): Promise<TriageIntakeResult> {
    const intake = await this.requireIntake(id, tenantId);
    if (intake.status !== 'pending' && intake.status !== 'snoozed') {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'intake_already_triaged',
          message: `Intake уже в статусе '${intake.status}'`,
        },
      });
    }

    let createdIssue: IssueResponseDto | null = null;
    const triagedAt = new Date();

    if (dto.decision === 'accept') {
      const targetProjectId =
        dto.targetProjectId ??
        intake.projectId ??
        intake.suggestedProjectId ??
        (await this.ensureInboxProjectId(tenantId));
      if (!targetProjectId) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'target_project_required',
            message: 'Не указан проект для создания задачи',
          },
        });
      }
      const title = dto.overrideTitle ?? intake.extractedTitle ?? intake.rawContent.slice(0, 200);
      const description =
        dto.overrideDescription ?? intake.extractedDescription ?? intake.rawContent;
      createdIssue = await this.issues.create(
        targetProjectId,
        {
          title,
          description,
          descriptionHtml: null,
          descriptionStripped: description,
          priority:
            dto.overridePriority ??
            (intake.suggestedPriority as 'urgent' | 'high' | 'medium' | 'low' | 'none' | null) ??
            'none',
          stateId: null,
          parentId: null,
          estimatePoints: null,
          sortOrder: 0,
          startDate: null,
          dueDate: dto.overrideDueDate ?? intake.suggestedDueDate ?? null,
          cycleId: null,
          goalId: dto.overrideGoalId ?? intake.suggestedGoalId ?? null,
          assigneeUserIds:
            dto.overrideAssigneeUserIds ??
            (intake.suggestedAssigneeId ? [intake.suggestedAssigneeId] : []),
          labelIds: [],
          externalSource: intake.externalSource ?? intake.source,
          externalId: intake.externalId,
          sourceBlockIds: intake.sourceBlockIds,
        },
        tenantId,
        userId,
      );
      await this.linkDerivedDecisions(tenantId, createdIssue.id, intake.sourceBlockIds);
    } else if (dto.decision === 'snooze' && !dto.snoozedUntil) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'snoozed_until_required',
          message: 'Для snooze требуется snoozedUntil',
        },
      });
    } else if (dto.decision === 'duplicate' && !dto.duplicateOfIssueId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'duplicate_of_issue_required',
          message: 'Для duplicate требуется duplicateOfIssueId',
        },
      });
    }

    const updated = await this.prisma.intakeIssue.update({
      where: { id },
      data: {
        status:
          dto.decision === 'accept'
            ? 'accepted'
            : dto.decision === 'reject'
              ? 'rejected'
              : dto.decision === 'snooze'
                ? 'snoozed'
                : 'duplicate',
        triagedByUserId: userId,
        triagedAt,
        rejectedReason: dto.decision === 'reject' ? (dto.reason ?? null) : null,
        snoozedUntil: dto.decision === 'snooze' ? (dto.snoozedUntil ?? null) : null,
        createdIssueId:
          dto.decision === 'accept'
            ? (createdIssue?.id ?? null)
            : dto.decision === 'duplicate'
              ? (dto.duplicateOfIssueId ?? null)
              : null,
      },
    });

    const result: TriageIntakeResult = {
      intake: this.toResponse(updated),
      createdIssue,
    };
    this.events.publishIntakeTriaged({
      intakeId: id,
      tenantId,
      decision: dto.decision,
      createdIssueId: createdIssue?.id ?? null,
    });
    void this.webhooks
      .dispatch(tenantId, 'intake.triaged', {
        intake: result.intake,
        decision: dto.decision,
        createdIssueId: createdIssue?.id ?? null,
      })
      .catch((e) => {
        this.logger.warn(
          { intakeId: id, err: e instanceof Error ? e.message : String(e) },
          'intake.triaged webhook dispatch failed',
        );
      });
    return result;
  }

  private async linkDerivedDecisions(
    tenantId: string,
    issueId: string,
    sourceBlockIds: string[],
  ): Promise<void> {
    try {
      const created = await linkDerivedDecisionsForIssue(this.prisma, {
        tenantId,
        issueId,
        sourceBlockIds,
      });
      if (created > 0) {
        this.logger.debug({ issueId, created }, 'intake triage: создано DecisionTaskLink(derived)');
      }
    } catch (e) {
      this.logger.warn(
        { issueId, err: e instanceof Error ? e.message : String(e) },
        'intake triage: линковка derived-решений упала (best-effort)',
      );
    }
  }

  private async requireIntake(id: string, tenantId: string): Promise<IntakeIssue> {
    const i = await this.prisma.intakeIssue.findFirst({
      where: { id, tenantId },
    });
    if (!i) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'intake_not_found', message: 'Intake-карточка не найдена' },
      });
    }
    return i;
  }

  private toResponse(i: IntakeIssue, names?: SuggestedNameMaps): IntakeResponseDto {
    return {
      id: i.id,
      tenantId: i.tenantId,
      projectId: i.projectId,
      status: i.status,
      source: i.source,
      sourceEmail: i.sourceEmail,
      externalSource: i.externalSource,
      externalId: i.externalId,
      rawContent: i.rawContent,
      extractedTitle: i.extractedTitle,
      extractedDescription: i.extractedDescription,
      suggestedProjectId: i.suggestedProjectId,
      suggestedAssigneeId: i.suggestedAssigneeId,
      suggestedGoalId: i.suggestedGoalId,
      suggestedProjectName:
        (i.suggestedProjectId && names?.projectNames.get(i.suggestedProjectId)) || null,
      suggestedAssigneeName:
        (i.suggestedAssigneeId && names?.assigneeNames.get(i.suggestedAssigneeId)) || null,
      suggestedGoalTitle: (i.suggestedGoalId && names?.goalTitles.get(i.suggestedGoalId)) || null,
      suggestedPriority: i.suggestedPriority,
      suggestedDueDate: i.suggestedDueDate?.toISOString() ?? null,
      suggestedLabels: i.suggestedLabels,
      sourceBlockIds: i.sourceBlockIds,
      confidence: i.confidence?.toString() ?? null,
      triagedByUserId: i.triagedByUserId,
      triagedAt: i.triagedAt?.toISOString() ?? null,
      rejectedReason: i.rejectedReason,
      snoozedUntil: i.snoozedUntil?.toISOString() ?? null,
      createdIssueId: i.createdIssueId,
      createdAt: i.createdAt.toISOString(),
      updatedAt: i.updatedAt.toISOString(),
    };
  }
}
