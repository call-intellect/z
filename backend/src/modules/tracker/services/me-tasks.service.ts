import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type { PostAssignTaskBodyDto, PostAssignTaskResponseDto } from '../dto/issues/post-assign-task.dto';
import type { PostMeTaskBodyDto, PostMeTaskResponseDto } from '../dto/issues/post-me-task.dto';

import { AssigneeResolverService } from './assignee-resolver.service';
import { IssuesService } from './issues.service';
import { ProjectsService } from './projects.service';
import { TrackerEmitterService } from './tracker-emitter.service';

@Injectable()
export class MeTasksService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IssuesService) private readonly issues: IssuesService,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
    @Inject(AssigneeResolverService) private readonly resolver: AssigneeResolverService,
    @Inject(TrackerEmitterService) private readonly emitter: TrackerEmitterService,
  ) {}

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
    if (resolution.kind === 'not_found') {
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

    return {
      id: created.id,
      title: created.title,
      projectId: created.projectId,
      status: await this.resolveStatus(created.stateId),
      assignee: { userId: resolution.userId, name: resolution.name },
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
