import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { IssueResponseDto } from '../dto/issues/issue-response.dto';

import type { IssuesService } from './issues.service';
import { MeTasksService } from './me-tasks.service';
import type { ProjectsService } from './projects.service';

/**
 * ТЗ#3 (2026-06-15) — unit-тесты self-постановки задачи (POST /api/v1/me/tasks).
 *
 * Изолированно (мок Prisma / IssuesService / ProjectsService):
 *  (а) создаёт задачу себе → исполнитель = userId, проект = «Входящие»,
 *      ответ { id, title, projectId, status };
 *  (б) inbox-проект недоступен (Org без владельца) → 400 inbox_project_unavailable;
 *  (в) status резолвится из категории состояния (stateId → IssueState.category).
 */

const TENANT = 'org_1';
const USER = 'user_1';
const INBOX = 'proj_inbox';

function makeIssueResponse(overrides: Partial<IssueResponseDto>): IssueResponseDto {
  return {
    id: 'issue_1',
    tenantId: TENANT,
    projectId: INBOX,
    identifier: 'INB-1',
    sequenceId: 1,
    title: 'Задача',
    description: null,
    descriptionHtml: null,
    descriptionStripped: null,
    priority: 'none',
    stateId: 'state_backlog',
    parentId: null,
    estimatePoints: null,
    sortOrder: 0,
    startDate: null,
    dueDate: null,
    completedAt: null,
    cycleId: null,
    goalId: null,
    boardId: null,
    meetingId: null,
    linkedMeetingIds: [],
    sourceBlockIds: [],
    confidence: null,
    createdManually: true,
    externalSource: 'assistant',
    externalId: null,
    entityId: null,
    createdById: USER,
    createdAt: '2026-06-15T00:00:00.000Z',
    updatedAt: '2026-06-15T00:00:00.000Z',
    archivedAt: null,
    deletedAt: null,
    assigneeUserIds: [USER],
    labelIds: [],
    checklistTotalCount: 0,
    checklistDoneCount: 0,
    ...overrides,
  };
}

describe('MeTasksService.createSelfTask', () => {
  let prisma: PrismaService;
  let issues: IssuesService;
  let projects: ProjectsService;
  let service: MeTasksService;

  let issueStateFindUnique: ReturnType<typeof vi.fn>;
  let issuesCreate: ReturnType<typeof vi.fn>;
  let ensureInbox: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    issueStateFindUnique = vi.fn(async () => ({ category: 'backlog' }));
    issuesCreate = vi.fn(async () => makeIssueResponse({}));
    ensureInbox = vi.fn(async () => INBOX);

    prisma = {
      issueState: { findUnique: issueStateFindUnique },
    } as unknown as PrismaService;
    issues = { create: issuesCreate } as unknown as IssuesService;
    projects = {
      ensureInboxProjectId: ensureInbox,
    } as unknown as ProjectsService;

    service = new MeTasksService(prisma, issues, projects);
  });

  it('(а) создаёт задачу себе в «Входящих» с исполнителем = userId', async () => {
    const res = await service.createSelfTask(
      { title: 'Позвонить клиенту', description: 'до пятницы' },
      TENANT,
      USER,
    );

    // Резолв inbox-проекта произошёл с правильным tenant.
    expect(ensureInbox).toHaveBeenCalledWith(TENANT);

    // IssuesService.create вызван с проектом «Входящие», assignee = сам,
    // priority='none', externalSource='assistant'.
    expect(issuesCreate).toHaveBeenCalledTimes(1);
    const call = issuesCreate.mock.calls[0] as [
      string,
      Record<string, unknown>,
      string,
      string,
    ];
    const [projectIdArg, dtoArg, tenantArg, userArg] = call;
    expect(projectIdArg).toBe(INBOX);
    expect(tenantArg).toBe(TENANT);
    expect(userArg).toBe(USER);
    expect(dtoArg.title).toBe('Позвонить клиенту');
    expect(dtoArg.description).toBe('до пятницы');
    expect(dtoArg.assigneeUserIds).toEqual([USER]);
    expect(dtoArg.priority).toBe('none');
    expect(dtoArg.externalSource).toBe('assistant');

    // Ответ — узкий контракт { id, title, projectId, status }.
    expect(res).toEqual({
      id: 'issue_1',
      title: 'Задача',
      projectId: INBOX,
      status: 'backlog',
    });
  });

  it('(б) inbox-проект недоступен → BadRequest inbox_project_unavailable', async () => {
    ensureInbox.mockResolvedValueOnce(null);

    await expect(
      service.createSelfTask({ title: 'Что-то' }, TENANT, USER),
    ).rejects.toMatchObject({
      response: { error: { code: 'inbox_project_unavailable' } },
    });
    expect(issuesCreate).not.toHaveBeenCalled();
  });

  it('(в) status = категория состояния созданной задачи', async () => {
    issuesCreate.mockResolvedValueOnce(
      makeIssueResponse({ stateId: 'state_started' }),
    );
    issueStateFindUnique.mockResolvedValueOnce({ category: 'started' });

    const res = await service.createSelfTask({ title: 'X' }, TENANT, USER);

    expect(issueStateFindUnique).toHaveBeenCalledWith({
      where: { id: 'state_started' },
      select: { category: true },
    });
    expect(res.status).toBe('started');
  });

  it('(в2) stateId=null → status дефолт backlog без запроса в БД', async () => {
    issuesCreate.mockResolvedValueOnce(makeIssueResponse({ stateId: null }));

    const res = await service.createSelfTask({ title: 'X' }, TENANT, USER);

    expect(issueStateFindUnique).not.toHaveBeenCalled();
    expect(res.status).toBe('backlog');
  });

  it('защита BadRequestException — корректный тип ошибки', async () => {
    ensureInbox.mockResolvedValueOnce(null);
    await expect(
      service.createSelfTask({ title: 'X' }, TENANT, USER),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
