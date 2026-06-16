import { describe, expect, it, vi } from 'vitest';

import { IdeaStatusAutoAdvanceService } from './idea-status-auto-advance.service';

describe('IdeaStatusAutoAdvanceService', () => {
  function build(opts: {
    issue?: { id: string; goalId: string | null } | null;
    ideas?: Array<{ id: string; status: string }>;
    enabled?: boolean;
  }) {
    const prisma = {
      issue: {
        findFirst: vi.fn().mockResolvedValue(opts.issue ?? null),
      },
      idea: {
        findMany: vi.fn().mockResolvedValue(opts.ideas ?? []),
      },
    };
    const specialist36 = { changeStatus: vi.fn().mockResolvedValue({}) };
    const cfg = {
      getDynamic: vi.fn(async (_k: string, _e: string, def: unknown) =>
        opts.enabled === undefined ? def : opts.enabled,
      ),
    };
    const metrics = { incIdeaStatusAutoAdvanced: vi.fn() };
    const svc = new IdeaStatusAutoAdvanceService(
      prisma as never,
      specialist36 as never,
      cfg as never,
      metrics as never,
    );
    return { svc, prisma, specialist36, metrics };
  }

  it('закрытие задачи с goalId → продвигает связанную идею (captured → in_discussion)', async () => {
    const { svc, specialist36, metrics } = build({
      issue: { id: 'iss-1', goalId: 'g-1' },
      ideas: [{ id: 'idea-1', status: 'captured' }],
    });
    await svc.handle({
      type: 'issue.status_changed_to_done',
      tenantId: 't1',
      issue: { id: 'iss-1' },
      actor: { userId: 'u-actor' },
    });
    expect(specialist36.changeStatus).toHaveBeenCalledTimes(1);
    expect(specialist36.changeStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't1',
        ideaId: 'idea-1',
        newStatus: 'in_discussion',
        changedByUserId: 'u-actor',
      }),
    );
    expect(metrics.incIdeaStatusAutoAdvanced).toHaveBeenCalledWith({
      to: 'in_discussion',
    });
  });

  it('in_progress идея → shipped при закрытии задачи', async () => {
    const { svc, specialist36 } = build({
      issue: { id: 'iss-1', goalId: 'g-1' },
      ideas: [{ id: 'idea-1', status: 'in_progress' }],
    });
    await svc.handle({
      type: 'issue.status_changed_to_done',
      tenantId: 't1',
      issue: { id: 'iss-1' },
      actor: { userId: null },
    });
    expect(specialist36.changeStatus).toHaveBeenCalledWith(
      expect.objectContaining({ newStatus: 'shipped', changedByUserId: 'system' }),
    );
  });

  it('событие не "to_done" → ничего не делаем', async () => {
    const { svc, prisma, specialist36 } = build({});
    await svc.handle({
      type: 'issue.status_changed',
      tenantId: 't1',
      issue: { id: 'iss-1' },
    });
    expect(prisma.issue.findFirst).not.toHaveBeenCalled();
    expect(specialist36.changeStatus).not.toHaveBeenCalled();
  });

  it('задача без goalId → нет связанной идеи, ничего не продвигаем', async () => {
    const { svc, specialist36 } = build({
      issue: { id: 'iss-1', goalId: null },
    });
    await svc.handle({
      type: 'issue.status_changed_to_done',
      tenantId: 't1',
      issue: { id: 'iss-1' },
    });
    expect(specialist36.changeStatus).not.toHaveBeenCalled();
  });

  it('флаг ideas.feed.enabled=false → skip', async () => {
    const { svc, prisma, specialist36 } = build({
      issue: { id: 'iss-1', goalId: 'g-1' },
      ideas: [{ id: 'idea-1', status: 'captured' }],
      enabled: false,
    });
    await svc.handle({
      type: 'issue.status_changed_to_done',
      tenantId: 't1',
      issue: { id: 'iss-1' },
    });
    expect(prisma.issue.findFirst).not.toHaveBeenCalled();
    expect(specialist36.changeStatus).not.toHaveBeenCalled();
  });

  it('shipped идея в выборке → исключена (changeStatus не вызывается для неё)', async () => {
    const { svc, specialist36 } = build({
      issue: { id: 'iss-1', goalId: 'g-1' },
      ideas: [{ id: 'idea-1', status: 'shipped' }],
    });
    await svc.handle({
      type: 'issue.status_changed_to_done',
      tenantId: 't1',
      issue: { id: 'iss-1' },
    });
    expect(specialist36.changeStatus).not.toHaveBeenCalled();
  });
});
