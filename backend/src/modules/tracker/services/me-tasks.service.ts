import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type { PostMeTaskBodyDto, PostMeTaskResponseDto } from '../dto/issues/post-me-task.dto';

import { IssuesService } from './issues.service';
import { ProjectsService } from './projects.service';

@Injectable()
export class MeTasksService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IssuesService) private readonly issues: IssuesService,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
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

  private async resolveStatus(stateId: string | null): Promise<string> {
    if (!stateId) return 'backlog';
    const state = await this.prisma.issueState.findUnique({
      where: { id: stateId },
      select: { category: true },
    });
    return state?.category ?? 'backlog';
  }
}
