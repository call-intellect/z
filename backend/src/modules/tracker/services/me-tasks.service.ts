import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { PostAssignTaskBodyDto, PostAssignTaskResponseDto } from '../dto/issues/post-assign-task.dto';
import type { PostCompleteTaskResponseDto } from '../dto/issues/post-complete-task.dto';
import type { PostMeTaskBodyDto, PostMeTaskResponseDto } from '../dto/issues/post-me-task.dto';
import type { PostProgressTaskResponseDto } from '../dto/issues/post-progress-task.dto';
import type { PostSuggestAssigneeResponseDto } from '../dto/issues/post-suggest-assignee.dto';

import { AssigneeResolverService } from './assignee-resolver.service';
import { IssuesService } from './issues.service';
import { ProgressUpdatesService } from './progress-updates.service';
import { ProjectsService } from './projects.service';
import { SkillRoutingService } from './skill-routing.service';
import { TrackerEmitterService } from './tracker-emitter.service';

export type OpenTaskResolution =
  | { kind: 'resolved'; issueId: string; title: string }
  | { kind: 'ambiguous'; candidates: Array<{ issueId: string; title: string }> }
  | { kind: 'not_found' };

function normalizeTaskName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

@Injectable()
export class MeTasksService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IssuesService) private readonly issues: IssuesService,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(AssigneeResolverService) private readonly resolver: AssigneeResolverService,
    @Inject(TrackerEmitterService) private readonly emitter: TrackerEmitterService,
    @Inject(SkillRoutingService) private readonly skillRouting: SkillRoutingService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
    @Inject(ProgressUpdatesService) private readonly progressUpdates: ProgressUpdatesService,
  ) {}

  async suggestAssignee(
    body: { taskText: string; departmentId?: string },
    tenantId: string,
  ): Promise<PostSuggestAssigneeResponseDto> {
    const suggestions = await this.skillRouting.suggestAssignee({
      tenantId,
      taskText: body.taskText,
      explicitTags: body.departmentId ? { departmentId: body.departmentId } : undefined,
    });
    return { suggestions };
  }

  async createSelfTask(
    body: PostMeTaskBodyDto,
    tenantId: string,
    userId: string,
  ): Promise<PostMeTaskResponseDto> {
    const projectId = await this.projects.ensureInboxProjectId(tenantId);
    if (!projectId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'inbox_project_unavailable',
          message: 'Не удалось определить проект «Входящие» для задачи',
        },
      });
    }

    const description = body.description ?? null;
    const issue = await this.issues.create(
      projectId,
      {
        title: body.title,
        description,
        descriptionHtml: null,
        descriptionStripped: description,
        priority: 'none',
        stateId: null,
        parentId: null,
        estimatePoints: null,
        sortOrder: 0,
        startDate: null,
        dueDate: body.dueDate ?? null,
        cycleId: null,
        goalId: null,
        assigneeUserIds: [userId],
        labelIds: [],
        externalSource: 'assistant',
        externalId: null,
      },
      tenantId,
      userId,
    );

    return {
      id: issue.id,
      title: issue.title,
      projectId: issue.projectId,
      status: await this.resolveStatus(issue.stateId),
    };
  }

  async assignTask(
    body: PostAssignTaskBodyDto,
    tenantId: string,
    actorUserId: string,
  ): Promise<PostAssignTaskResponseDto> {
    const resolution = await this.resolver.resolve(tenantId, body.assigneeName);
    if (resolution.kind === 'not_found' || resolution.kind === 'collective') {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'assignee_not_found',
          message: `Не нашёл сотрудника по имени «${body.assigneeName}». Уточните имя.`,
        },
      });
    }
    if (resolution.kind === 'ambiguous') {
      const names = resolution.candidates.map((c) => c.name).join(', ');
      throw new ConflictException({
        ok: false,
        error: {
          code: 'assignee_ambiguous',
          message: `Несколько сотрудников с именем «${body.assigneeName}»: ${names}. Уточните, кого имели в виду.`,
        },
      });
    }

    const projectId = await this.projects.ensureInboxProjectId(tenantId);
    if (!projectId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'inbox_project_unavailable',
          message: 'Не удалось определить проект «Входящие» для задачи',
        },
      });
    }

    const description = body.description ?? null;
    const created = await this.issues.create(
      projectId,
      {
        title: body.title,
        description,
        descriptionHtml: null,
        descriptionStripped: description,
        priority: 'none',
        stateId: null,
        parentId: null,
        estimatePoints: null,
        sortOrder: 0,
        startDate: null,
        dueDate: body.dueDate ? new Date(body.dueDate) : null,
        cycleId: null,
        goalId: null,
        assigneeUserIds: [resolution.userId],
        labelIds: [],
        externalSource: 'assistant',
        externalId: null,
      },
      tenantId,
      actorUserId,
    );

    const fullIssue = await this.prisma.issue.findUnique({ where: { id: created.id } });
    if (fullIssue) {
      this.emitter.emitIssueAssigneeChanged({
        issue: fullIssue,
        actorUserId,
        action: 'added',
        assigneeUserId: resolution.userId,
      });
    }

    if (body.viaRouting === true) {
      this.metrics.incRoutingSuggestionAccepted();
    }

    return {
      id: created.id,
      title: created.title,
      projectId: created.projectId,
      status: await this.resolveStatus(created.stateId),
      assignee: { userId: resolution.userId, name: resolution.name },
    };
  }

  async resolveOpenTaskByName(
    tenantId: string,
    userId: string,
    rawName: string,
  ): Promise<OpenTaskResolution> {
    const norm = normalizeTaskName(rawName);
    if (!norm) return { kind: 'not_found' };

    const issues = await this.prisma.issue.findMany({
      where: {
        tenantId,
        deletedAt: null,
        assignees: { some: { userId } },
        state: { category: { notIn: ['completed', 'cancelled'] } },
      },
      select: { id: true, title: true },
    });

    type Candidate = { issueId: string; title: string; norm: string };
    const candidates: Candidate[] = issues.map((i) => ({
      issueId: i.id,
      title: i.title,
      norm: normalizeTaskName(i.title),
    }));

    const exact = candidates.filter((c) => c.norm === norm);
    const partial = candidates.filter(
      (c) => c.norm.includes(norm) || norm.includes(c.norm),
    );
    const matched = exact.length > 0 ? exact : partial;

    if (matched.length === 0) return { kind: 'not_found' };
    const first = matched[0];
    if (matched.length === 1 && first) {
      return { kind: 'resolved', issueId: first.issueId, title: first.title };
    }
    return {
      kind: 'ambiguous',
      candidates: matched.slice(0, 5).map((c) => ({ issueId: c.issueId, title: c.title })),
    };
  }

  async completeTask(
    body: { taskName: string; note?: string },
    tenantId: string,
    userId: string,
  ): Promise<PostCompleteTaskResponseDto> {
    const resolution = await this.resolveOpenTaskByName(tenantId, userId, body.taskName);
    if (resolution.kind === 'not_found') {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'task_not_found',
          message: 'Задача с таким названием не найдена среди ваших открытых задач',
        },
      });
    }
    if (resolution.kind === 'ambiguous') {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'task_ambiguous',
          message: 'Найдено несколько подходящих задач — уточните название',
          candidates: resolution.candidates,
        },
      });
    }

    const sourceBlockId = `concierge-complete:${userId}`;
    const row = await this.prisma.taskClosureCandidate.upsert({
      where: {
        tenantId_issueId_sourceBlockId: {
          tenantId,
          issueId: resolution.issueId,
          sourceBlockId,
        },
      },
      create: {
        tenantId,
        issueId: resolution.issueId,
        sourceBlockId,
        status: 'pending',
        evidenceQuote: body.note ?? null,
        rationale: 'Отмечено выполненным через помощника',
        expiresAt: null,
      },
      update: {},
    });

    return {
      candidateId: row.id,
      issueId: resolution.issueId,
      title: resolution.title,
      status: row.status,
    };
  }

  async reportTaskProgress(
    body: { taskName: string; progress: string },
    tenantId: string,
    userId: string,
  ): Promise<PostProgressTaskResponseDto> {
    const resolution = await this.resolveOpenTaskByName(tenantId, userId, body.taskName);
    if (resolution.kind === 'not_found') {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'task_not_found',
          message: 'Задача с таким названием не найдена среди ваших открытых задач',
        },
      });
    }
    if (resolution.kind === 'ambiguous') {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'task_ambiguous',
          message: 'Найдено несколько подходящих задач — уточните название',
          candidates: resolution.candidates,
        },
      });
    }

    const res = await this.progressUpdates.create(
      resolution.issueId,
      { health: 'on_track', body: body.progress },
      tenantId,
      userId,
    );

    return {
      progressUpdateId: res.id,
      issueId: resolution.issueId,
      title: resolution.title,
    };
  }

  private async resolveStatus(stateId: string | null): Promise<string> {
    if (!stateId) return 'backlog';
    const state = await this.prisma.issueState.findUnique({
      where: { id: stateId },
      select: { category: true },
    });
    return state?.category ?? 'backlog';
  }
}
