import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import type { RbacService } from '../../rbac/rbac.service';
import { PostAssignTaskBodySchema } from '../dto/issues/post-assign-task.dto';
import { PostMeTaskBodySchema, type PostMeTaskBodyDto } from '../dto/issues/post-me-task.dto';
import { PostSuggestAssigneeBodySchema } from '../dto/issues/post-suggest-assignee.dto';
import type { MeTasksService } from '../services/me-tasks.service';

import { MeTasksController } from './me-tasks.controller';

const TENANT = 'org_1';
const USER: CurrentUserPayload = {
  id: 'user_1',
  email: 'member@example.com',
  role: 'user',
};

describe('MeTasksController POST /me/tasks', () => {
  let svc: MeTasksService;
  let rbac: RbacService;
  let controller: MeTasksController;

  let createSelfTask: ReturnType<typeof vi.fn>;
  let canWrite: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createSelfTask = vi.fn(async () => ({
      id: 'issue_1',
      title: 'Задача',
      projectId: 'proj_inbox',
      status: 'backlog',
    }));
    canWrite = vi.fn(async () => true);

    svc = { createSelfTask } as unknown as MeTasksService;
    rbac = { canWrite } as unknown as RbacService;
    controller = new MeTasksController(svc, rbac);
  });

  it('(а) member создаёт задачу себе → 200/201, есть id, делегирует в сервис', async () => {
    const body: PostMeTaskBodyDto = { title: 'Позвонить клиенту' };
    const res = await controller.createSelfTask(body, USER, TENANT);

    expect(canWrite).toHaveBeenCalledWith(USER.id, TENANT, 'issue');
    expect(createSelfTask).toHaveBeenCalledWith(body, TENANT, USER.id);
    expect(res.id).toBe('issue_1');
    expect(res.projectId).toBe('proj_inbox');
  });

  it('(б) пустой title → 400 (Zod через ZodValidationPipe)', () => {
    const pipe = new ZodValidationPipe(PostMeTaskBodySchema);
    expect(() => pipe.transform({ title: '' })).toThrow(BadRequestException);
  });

  it('(б2) отсутствующий title → 400 (Zod)', () => {
    const pipe = new ZodValidationPipe(PostMeTaskBodySchema);
    expect(() => pipe.transform({ description: 'без заголовка' })).toThrow(BadRequestException);
  });

  it('(в) RBAC запрет write(issue) → 403 forbidden, сервис не вызывается', async () => {
    canWrite.mockResolvedValueOnce(false);

    await expect(controller.createSelfTask({ title: 'X' }, USER, TENANT)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(createSelfTask).not.toHaveBeenCalled();
  });

  it('(г) tenant не определён → 400 tenant_required', async () => {
    await expect(controller.createSelfTask({ title: 'X' }, USER, undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(canWrite).not.toHaveBeenCalled();
  });
});

describe('MeTasksController POST /me/tasks/assign', () => {
  let svc: MeTasksService;
  let rbac: RbacService;
  let controller: MeTasksController;
  let assignTask: ReturnType<typeof vi.fn>;
  let canWrite: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    assignTask = vi.fn(async () => ({
      id: 'issue_1',
      title: 'Задача',
      projectId: 'proj_inbox',
      status: 'backlog',
      assignee: { userId: 'assignee_1', name: 'Айназ' },
    }));
    canWrite = vi.fn(async () => true);
    svc = { assignTask } as unknown as MeTasksService;
    rbac = { canWrite } as unknown as RbacService;
    controller = new MeTasksController(svc, rbac);
  });

  it('(а) делегирует в сервис с body/tenant/userId, проверяет issue:write', async () => {
    const body = { title: 'Протестировать бота', assigneeName: 'Айназ' };
    const res = await controller.assignTask(body, USER, TENANT);
    expect(canWrite).toHaveBeenCalledWith(USER.id, TENANT, 'issue');
    expect(assignTask).toHaveBeenCalledWith(body, TENANT, USER.id);
    expect(res.assignee?.name).toBe('Айназ');
  });

  it('(б) пустой assigneeName → 400 (Zod)', () => {
    const pipe = new ZodValidationPipe(PostAssignTaskBodySchema);
    expect(() => pipe.transform({ title: 'X', assigneeName: '' })).toThrow(BadRequestException);
  });

  it('(в) RBAC запрет → 403, сервис не вызван', async () => {
    canWrite.mockResolvedValueOnce(false);
    await expect(
      controller.assignTask({ title: 'X', assigneeName: 'Айназ' }, USER, TENANT),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(assignTask).not.toHaveBeenCalled();
  });

  it('(г) tenant не определён → 400', async () => {
    await expect(
      controller.assignTask({ title: 'X', assigneeName: 'Айназ' }, USER, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('MeTasksController POST /me/tasks/suggest-assignee', () => {
  let svc: MeTasksService;
  let rbac: RbacService;
  let controller: MeTasksController;
  let suggestAssignee: ReturnType<typeof vi.fn>;
  let canWrite: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    suggestAssignee = vi.fn(async () => ({
      suggestions: [
        {
          personId: 'person_1',
          personName: 'Наташа',
          roleName: 'Офис-менеджер',
          departmentName: 'Администрация',
          confidence: 0.82,
          rationale: 'отвечает за снабжение',
          matchPath: 'semantic' as const,
        },
      ],
    }));
    canWrite = vi.fn(async () => true);
    svc = { suggestAssignee } as unknown as MeTasksService;
    rbac = { canWrite } as unknown as RbacService;
    controller = new MeTasksController(svc, rbac);
  });

  it('(а) делегирует в сервис, проверяет issue:write, возвращает {suggestions}', async () => {
    const body = { taskText: 'заказать канцелярию' };
    const res = await controller.suggestAssignee(body, USER, TENANT);

    expect(canWrite).toHaveBeenCalledWith(USER.id, TENANT, 'issue');
    expect(suggestAssignee).toHaveBeenCalledWith(body, TENANT);
    expect(res).toEqual(
      expect.objectContaining({
        suggestions: expect.arrayContaining([
          expect.objectContaining({ personId: 'person_1', matchPath: 'semantic' }),
        ]),
      }),
    );
  });

  it('(б) нет уверенного кандидата → {suggestions: []}', async () => {
    suggestAssignee.mockResolvedValueOnce({ suggestions: [] });
    const res = await controller.suggestAssignee({ taskText: 'неясная задача' }, USER, TENANT);
    expect(res).toEqual({ suggestions: [] });
  });

  it('(в) пустой taskText → 400 (Zod)', () => {
    const pipe = new ZodValidationPipe(PostSuggestAssigneeBodySchema);
    expect(() => pipe.transform({ taskText: '' })).toThrow(BadRequestException);
  });

  it('(г) RBAC запрет → 403, сервис не вызван', async () => {
    canWrite.mockResolvedValueOnce(false);
    await expect(
      controller.suggestAssignee({ taskText: 'X' }, USER, TENANT),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(suggestAssignee).not.toHaveBeenCalled();
  });

  it('(д) tenant не определён → 400', async () => {
    await expect(
      controller.suggestAssignee({ taskText: 'X' }, USER, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(canWrite).not.toHaveBeenCalled();
  });
});
