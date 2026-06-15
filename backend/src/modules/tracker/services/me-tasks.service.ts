import {
  BadRequestException,
  Inject,
  Injectable,
} from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  PostMeTaskBodyDto,
  PostMeTaskResponseDto,
} from '../dto/issues/post-me-task.dto';

import { IssuesService } from './issues.service';
import { ProjectsService } from './projects.service';

/**
 * ТЗ#3 (2026-06-15) — постановка задачи СЕБЕ из помощника.
 *
 * Тонкий сервис над уже существующими кирпичами трекера:
 *   1. `ProjectsService.ensureInboxProjectId` — find-or-create дефолт-проекта
 *      «Входящие» (общая папка ручного/авто-триажа и self-задач).
 *   2. `IssuesService.create` — создание Issue с исполнителем = сам
 *      запрашивающий (`assigneeUserIds=[userId]`).
 *
 * Доступ проверяет контроллер: `issue:write` на уровне tenant'а (право, которым
 * рядовой member/manager уже обладает по policy.csv — `p, manager, *, *, issue,
 * write`). Эндпоинт НЕ расширяет доступ: проект всегда «Входящие», исполнитель
 * всегда сам, чужого исполнителя/проект задать нельзя.
 */
@Injectable()
export class MeTasksService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IssuesService) private readonly issues: IssuesService,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
  ) {}

  /**
   * Создать задачу себе в дефолт-проекте «Входящие».
   *
   * @param body  title (обязателен) + опц. description / dueDate (ISO).
   * @param tenantId  организация (X-Org-Id / :orgId).
   * @param userId  текущий пользователь — он же исполнитель задачи.
   */
  async createSelfTask(
    body: PostMeTaskBodyDto,
    tenantId: string,
    userId: string,
  ): Promise<PostMeTaskResponseDto> {
    const projectId = await this.projects.ensureInboxProjectId(tenantId);
    if (!projectId) {
      // У Org нет владельца → дефолт-проект создать некому. В норме у любой
      // Org владелец есть; это защитный 400, а не 500.
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
        // Исполнитель — сам запрашивающий. Никаких чужих исполнителей: эндпоинт
        // умышленно не принимает assigneeUserIds, чтобы не расширять доступ.
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

  /**
   * Человекочитаемый статус задачи = категория её состояния (IssueState.category:
   * backlog / started / completed / cancelled). Свежесозданная задача попадает в
   * default-состояние проекта (обычно «Бэклог» → backlog). Если состояние не
   * проставлено (stateId=null) — возвращаем 'backlog' как нейтральный дефолт.
   */
  private async resolveStatus(stateId: string | null): Promise<string> {
    if (!stateId) return 'backlog';
    const state = await this.prisma.issueState.findUnique({
      where: { id: stateId },
      select: { category: true },
    });
    return state?.category ?? 'backlog';
  }
}
