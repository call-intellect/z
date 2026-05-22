/**
 * Фаза A.2 — controller-level integration тест для AdminPromptTemplatesController.
 *
 * Не поднимает full NestJS-app (Docker выключен, БД недоступна), но создаёт
 * контроллер с мокнутым сервисом и проверяет, что:
 *   - GET /prompt-templates делегирует list() с фильтрами.
 *   - POST /prompt-templates делегирует create() с user.id.
 *   - PATCH /prompt-templates/:id делегирует update().
 *   - POST /prompt-templates/:id/activate-version/:versionId делегирует activate.
 *   - POST /prompt-templates/:id/preview делегирует preview-сервис.
 *
 * Покрытие ≥4 эндпоинтов из ТЗ §7.1 — DoD.
 */

import { describe, expect, it, vi } from 'vitest';

import type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import { AdminPromptTemplatesController } from './prompt-templates.controller';
import type { PromptTemplatesPreviewService } from './prompt-templates-preview.service';
import type { AdminPromptTemplatesService } from './prompt-templates.service';

const sampleUser: CurrentUserPayload = {
  id: 'u-1',
  email: 'admin@z.test',
  role: 'admin',
};

function build() {
  const svc = {
    list: vi.fn(async () => ({ items: [{ id: 't-1' }] })),
    detail: vi.fn(async () => ({ id: 't-1' })),
    create: vi.fn(async () => ({ id: 't-new' })),
    update: vi.fn(async () => ({ id: 't-1', name: 'Обновлённый' })),
    softDelete: vi.fn(async () => ({ ok: true as const })),
    createVersion: vi.fn(async () => ({ version: { id: 'v-2' }, activated: false })),
    getVersion: vi.fn(async () => ({ id: 'v-1' })),
    activateVersion: vi.fn(async () => ({ ok: true as const })),
    copyToOrg: vi.fn(async () => ({ id: 't-copy' })),
  } as unknown as AdminPromptTemplatesService;
  const previewSvc = {
    runPreview: vi.fn(async () => ({
      source: 'db_active',
      templateId: 't-1',
      versionId: 'v-1',
      versionNumber: 1,
      demoMeetingKey: 'demo-sales',
      text: 'результат',
      durationMs: 1500,
      costUsd: 0.001,
      costOverBudget: false,
      modelUsed: 'deepseek:flash',
      inputTokens: 800,
      outputTokens: 200,
    })),
  } as unknown as PromptTemplatesPreviewService;
  // Фаза A.3 — контроллер теперь резолвит rbac через PrismaService.
  // В этом spec'е пользователь — super_admin, без owned Org.
  const prisma = {
    user: { findUnique: vi.fn(async () => ({ isSuperAdmin: true })) },
    membership: { findMany: vi.fn(async () => []) },
  } as unknown as PrismaService;
  const ctrl = new AdminPromptTemplatesController(svc, previewSvc, prisma);
  return { ctrl, svc, previewSvc };
}

describe('AdminPromptTemplatesController', () => {
  it('GET /prompt-templates — делегирует list с фильтрами', async () => {
    const { ctrl, svc } = build();
    const out = await ctrl.list({ scope: 'system', status: 'active' }, sampleUser);
    expect(svc.list).toHaveBeenCalledWith(
      { scope: 'system', status: 'active' },
      expect.objectContaining({ isSuperAdmin: true }),
    );
    expect(out).toEqual({ items: [{ id: 't-1' }] });
  });

  it('POST /prompt-templates — пробрасывает user.id в сервис', async () => {
    const { ctrl, svc } = build();
    await ctrl.create(
      {
        scope: 'system',
        key: 'type-test',
        name: 'Тестовый шаблон',
        taskType: 'summary',
      } as unknown as Parameters<typeof ctrl.create>[0],
      sampleUser,
    );
    expect(svc.create).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'type-test' }),
      'u-1',
      expect.objectContaining({ isSuperAdmin: true }),
    );
  });

  it('PATCH /prompt-templates/:id — делегирует update с user.id', async () => {
    const { ctrl, svc } = build();
    await ctrl.update('t-1', { name: 'Обновлённый' } as never, sampleUser);
    expect(svc.update).toHaveBeenCalledWith(
      't-1',
      { name: 'Обновлённый' },
      'u-1',
      expect.objectContaining({ isSuperAdmin: true }),
    );
  });

  it('POST /prompt-templates/:id/activate-version/:versionId — делегирует activate', async () => {
    const { ctrl, svc } = build();
    await ctrl.activateVersion('t-1', 'v-2', sampleUser);
    expect(svc.activateVersion).toHaveBeenCalledWith(
      't-1',
      'v-2',
      expect.objectContaining({ isSuperAdmin: true }),
    );
  });

  it('POST /prompt-templates/:id/preview — вызывает preview-сервис', async () => {
    const { ctrl, previewSvc } = build();
    const out = await ctrl.preview(
      't-1',
      { demoMeetingKey: 'demo-sales' } as never,
      sampleUser,
    );
    expect(previewSvc.runPreview).toHaveBeenCalledWith(
      't-1',
      { demoMeetingKey: 'demo-sales' },
      'u-1',
    );
    expect(out.text).toBe('результат');
  });

  it('create без user — бросает BadRequestException', async () => {
    const { ctrl } = build();
    await expect(
      ctrl.create({ scope: 'system', key: 'k', name: 'n', taskType: 'summary' } as never, null),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        error: expect.objectContaining({ code: 'no_user_context' }),
      }),
    });
  });
});
