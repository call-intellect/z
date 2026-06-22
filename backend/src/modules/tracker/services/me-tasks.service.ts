import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ProbeService } from '../../probe/probe.service';
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
    @Inject(ProbeService) private readonly probe: ProbeService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
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

    if (!body.dueDate && this.cfg.tracker.dueDateClarifyEnabled) {
      await this.raiseDueDateProbe(tenantId, issue.id, issue.title, [userId]);
    }

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
    const assigneeUserIds = resolution.kind === 'resolved' ? [resolution.userId] : [];

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
        assigneeUserIds,
        labelIds: [],
        externalSource: 'assistant',
        externalId: null,
      },
      tenantId,
      actorUserId,
    );

    const status = await this.resolveStatus(created.stateId);

    if (resolution.kind === 'resolved') {
      const fullIssue = await this.prisma.issue.findUnique({ where: { id: created.id } });
      if (fullIssue) {
        this.emitter.emitIssueAssigneeChanged({
          issue: fullIssue,
          actorUserId,
          action: 'added',
          assigneeUserId: resolution.userId,
        });
      }
      this.metrics.incTaskAssigneeClarify({
        outcome: resolution.via === 'memory' ? 'resolved_memory' : 'resolved_name',
      });
      if (body.viaRouting === true) {
        this.metrics.incRoutingSuggestionAccepted();
      }
    }

    let needsAssigneeResponse: Pick<
      PostAssignTaskResponseDto,
      'needsAssignee' | 'candidates' | 'message'
    > | null = null;

    if (resolution.kind !== 'resolved') {
      let hintNames: string[] = [];
      if (this.cfg.tracker.assigneeClarifyEnabled) {
        const hints = await this.skillRouting
          .suggestAssignee({
            tenantId,
            taskText: `${body.title}${body.description ? ` ${body.description}` : ''}`,
          })
          .catch(() => []);
        hintNames = hints.slice(0, 3).map((h) => h.personName);

        try {
          await this.probe.suggest({
            tenantId,
            emittedByService: 'me-tasks',
            reason: 'task.assignee_unresolved',
            payload: {
              contextCardId: created.id,
              contextCardKind: 'issue',
              contextCardTitle: created.title,
              objectName: created.title,
              objectKindRu: 'задача',
              message: `Поставлена задача «${created.title}», но не определён исполнитель.`,
              suggestedQuestion:
                `Для кого эта задача — кому её поручить?` +
                (hintNames.length ? ` Возможно: ${hintNames.join(', ')}.` : ''),
            },
            recipientCandidates: [actorUserId],
            priorityHint: this.cfg.tracker.assigneeProbePriorityHint,
          });
        } catch {
          // best-effort: probe не должен ронять создание задачи
        }

        this.metrics.incTaskAssigneeClarify({
          outcome:
            resolution.kind === 'collective'
              ? 'collective_probe_raised'
              : 'assignee_probe_raised',
        });
      }

      const candidates: Array<{ userId: string | null; name: string }> =
        resolution.kind === 'ambiguous'
          ? resolution.candidates.map((c) => ({ userId: c.userId, name: c.name }))
          : hintNames.map((name) => ({ userId: null, name }));

      const message =
        resolution.kind === 'collective'
          ? 'Создал задачу во «Входящих». Это коллективный адресат, уточню конкретного исполнителя.'
          : 'Создал задачу во «Входящих». Уточню, на кого её повесить.';

      needsAssigneeResponse = { needsAssignee: true, candidates, message };
    }

    if (!body.dueDate && this.cfg.tracker.dueDateClarifyEnabled) {
      await this.raiseDueDateProbe(tenantId, created.id, created.title, [
        assigneeUserIds[0] ?? actorUserId,
      ]);
    }

    if (resolution.kind === 'resolved') {
      return {
        id: created.id,
        title: created.title,
        projectId: created.projectId,
        status,
        assignee: { userId: resolution.userId, name: resolution.name },
      };
    }

    return {
      id: created.id,
      title: created.title,
      projectId: created.projectId,
      status,
      ...(needsAssigneeResponse ?? { needsAssignee: true }),
    };
  }

  private async raiseDueDateProbe(
    tenantId: string,
    issueId: string,
    title: string,
    recipientCandidates: readonly string[],
  ): Promise<void> {
    try {
      await this.probe.suggest({
        tenantId,
        emittedByService: 'me-tasks',
        reason: 'task.due_date_missing',
        payload: {
          contextCardId: issueId,
          contextCardKind: 'issue',
          contextCardTitle: title,
          objectName: title,
          objectKindRu: 'задача',
          message: `У задачи «${title}» не указан срок.`,
          suggestedQuestion: `К какому сроку нужно сделать «${title}»?`,
        },
        recipientCandidates,
        priorityHint: this.cfg.tracker.assigneeProbePriorityHint,
      });
      this.metrics.incTaskAssigneeClarify({ outcome: 'due_probe_raised' });
    } catch {
      // best-effort: probe не должен ронять создание задачи
    }
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
