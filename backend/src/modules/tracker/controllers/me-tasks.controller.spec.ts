import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import type { RbacService } from '../../rbac/rbac.service';
import {
  PostMeTaskBodySchema,
  type PostMeTaskBodyDto,
} from '../dto/issues/post-me-task.dto';
import type { MeTasksService } from '../services/me-tasks.service';

import { MeTasksController } from './me-tasks.controller';

/**
 * ТЗ#3 (2026-06-15) — unit-тесты контроллера POST /api/v1/me/tasks.
 *
 * Покрытие:
 *  (а) member с issue:write создаёт задачу себе → делегирует в сервис, есть id;
 *  (б) пустой title → 400 (Zod, через ZodValidationPipe);
 *  (в) RBAC: canWrite('issue')=false → 403 forbidden.
 */

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
    expect(() =>
      pipe.transform({ description: 'без заголовка' }),
    ).toThrow(BadRequestException);
  });

  it('(в) RBAC запрет write(issue) → 403 forbidden, сервис не вызывается', async () => {
    canWrite.mockResolvedValueOnce(false);

    await expect(
      controller.createSelfTask({ title: 'X' }, USER, TENANT),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(createSelfTask).not.toHaveBeenCalled();
  });

  it('(г) tenant не определён → 400 tenant_required', async () => {
    await expect(
      controller.createSelfTask({ title: 'X' }, USER, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(canWrite).not.toHaveBeenCalled();
  });
});
