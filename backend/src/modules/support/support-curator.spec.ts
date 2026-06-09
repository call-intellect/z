import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SupportCuratorService } from './services/support-curator.service';

/**
 * support-desk Ф4 — unit-тесты SupportCuratorService.runOnce / applyAction:
 *   - kill-switch (curatorEnabled=false) → skipped, ноль LLM/debate/update;
 *   - factual fix за дебат-гейтом: verdict «против» → блок НЕ меняется,
 *     аудит applied=false (R23);
 *   - fix применён при affirm → ideaBlock.update(status='archived') (R24 soft);
 *   - soft-only: prisma.ideaBlock.delete отсутствует/не вызван;
 *   - merge с валидной целью + affirm → status='merged_into'/mergedIntoId;
 *   - идемпотентность: существующий SupportCuratorAction → no-op.
 *
 * Все зависимости замоканы (prisma / access / debate / llm / cfg).
 */
describe('SupportCuratorService', () => {
  const VENDOR = 'vendor-org-1';
  const GROUP = 'grp-support';

  let prismaStub: {
    ideaBlock: {
      findMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    supportDraftOutcome: { findMany: ReturnType<typeof vi.fn> };
    supportCuratorAction: {
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
  };
  let accessStub: {
    getVendorOrgId: ReturnType<typeof vi.fn>;
    getSupportGroupId: ReturnType<typeof vi.fn>;
  };
  let debateStub: { judge: ReturnType<typeof vi.fn> };
  let llmStub: { call: ReturnType<typeof vi.fn> };
  let cfg: { supportDesk: { enabled: boolean; curatorEnabled: boolean } };
  let svc: SupportCuratorService;

  function build(): SupportCuratorService {
    return new SupportCuratorService(
      prismaStub as unknown as never,
      accessStub as unknown as never,
      debateStub as unknown as never,
      llmStub as unknown as never,
      cfg as unknown as never,
    );
  }

  /** LLM возвращает одно действие (по умолчанию keep). */
  function llmActions(
    actions: Array<{
      blockId: string;
      action: string;
      reason?: string;
      targetBlockId?: string | null;
    }>,
  ): void {
    llmStub.call.mockResolvedValue({
      text: JSON.stringify({
        actions: actions.map((a) => ({
          blockId: a.blockId,
          action: a.action,
          reason: a.reason ?? 'тест',
          targetBlockId: a.targetBlockId ?? null,
        })),
      }),
      modelUsed: 'deepseek:deepseek-v4-pro',
    });
  }

  beforeEach(() => {
    prismaStub = {
      ideaBlock: { findMany: vi.fn(), update: vi.fn(async () => ({})) },
      supportDraftOutcome: { findMany: vi.fn(async () => []) },
      supportCuratorAction: {
        findFirst: vi.fn(async () => null),
        create: vi.fn(async () => ({ id: 'audit-1' })),
      },
    };
    prismaStub.ideaBlock.findMany.mockResolvedValue([
      {
        id: 'b1',
        criticalQuestion: 'Как сбросить пароль?',
        trustedAnswer: 'Старый ответ.',
        status: 'canonical',
      },
    ]);

    accessStub = {
      getVendorOrgId: vi.fn(async () => VENDOR),
      getSupportGroupId: vi.fn(async () => GROUP),
    };
    debateStub = {
      judge: vi.fn(async () => ({
        decision: 'supersedes',
        votes: [],
        consensusType: 'majority',
        rounds: 1,
        totalCostUsd: 0,
        fallbackUsed: null,
      })),
    };
    llmStub = { call: vi.fn() };
    llmActions([{ blockId: 'b1', action: 'keep' }]);

    cfg = { supportDesk: { enabled: true, curatorEnabled: true } };
    svc = build();
  });

  it('kill-switch: curatorEnabled=false → skipped, без LLM/debate/update', async () => {
    cfg.supportDesk.curatorEnabled = false;
    svc = build();

    const res = await svc.runOnce(new Date('2026-06-09T03:00:00Z'));

    expect(res).toEqual({ skipped: true, proposed: 0, applied: 0 });
    expect(llmStub.call).not.toHaveBeenCalled();
    expect(debateStub.judge).not.toHaveBeenCalled();
    expect(prismaStub.ideaBlock.update).not.toHaveBeenCalled();
  });

  it('factual fix gated: debate «против» → ideaBlock.update НЕ вызван, аудит applied=false', async () => {
    llmActions([{ blockId: 'b1', action: 'fix', reason: 'фактическая ошибка' }]);
    debateStub.judge.mockResolvedValueOnce({
      decision: 'split_uncertain',
      votes: [],
      consensusType: 'split',
      rounds: 1,
      totalCostUsd: 0,
      fallbackUsed: null,
    });

    const res = await svc.runOnce(new Date('2026-06-09T03:00:00Z'));

    expect(debateStub.judge).toHaveBeenCalledTimes(1);
    expect(prismaStub.ideaBlock.update).not.toHaveBeenCalled();
    expect(res.applied).toBe(0);
    expect(prismaStub.supportCuratorAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          blockId: 'b1',
          action: 'fix',
          applied: false,
          debateDecision: 'split_uncertain',
        }),
      }),
    );
  });

  it('fix applied: debate affirm → soft-archive (status=archived, supersededAt)', async () => {
    llmActions([{ blockId: 'b1', action: 'fix', reason: 'фактическая ошибка' }]);
    // debate.judge default → supersedes/majority (affirm).

    const now = new Date('2026-06-09T03:00:00Z');
    const res = await svc.runOnce(now);

    // debate.judge вызван ПЕРЕД update (gate).
    expect(debateStub.judge).toHaveBeenCalledTimes(1);
    expect(prismaStub.ideaBlock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'b1' },
        data: expect.objectContaining({
          status: 'archived',
          supersededAt: now,
        }),
      }),
    );
    expect(res.applied).toBe(1);
    expect(prismaStub.supportCuratorAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ applied: true }),
      }),
    );
  });

  it('soft-only: у prisma-стаба нет метода delete (физического удаления не существует)', async () => {
    llmActions([{ blockId: 'b1', action: 'archive' }]);
    await svc.runOnce(new Date('2026-06-09T03:00:00Z'));

    // Стаб ideaBlock не имеет delete → код не может его вызвать.
    expect(
      (prismaStub.ideaBlock as Record<string, unknown>).delete,
    ).toBeUndefined();
  });

  it('merge: valid targetBlockId + affirm → status=merged_into, mergedIntoId', async () => {
    prismaStub.ideaBlock.findMany.mockResolvedValue([
      {
        id: 'b1',
        criticalQuestion: 'дубль',
        trustedAnswer: 'A',
        status: 'canonical',
      },
      {
        id: 'b2',
        criticalQuestion: 'оригинал',
        trustedAnswer: 'A',
        status: 'canonical',
      },
    ]);
    llmActions([
      { blockId: 'b1', action: 'merge', targetBlockId: 'b2', reason: 'дубликат' },
      // b2 keep — не мутируем.
      { blockId: 'b2', action: 'keep' },
    ]);

    const res = await svc.runOnce(new Date('2026-06-09T03:00:00Z'));

    expect(prismaStub.ideaBlock.update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { status: 'merged_into', mergedIntoId: 'b2' },
    });
    expect(res.applied).toBe(1);
  });

  it('идемпотентность: существующий SupportCuratorAction → no-op (без update)', async () => {
    llmActions([{ blockId: 'b1', action: 'fix', reason: 'ошибка' }]);
    prismaStub.supportCuratorAction.findFirst.mockResolvedValue({
      id: 'prior-action',
    });

    const res = await svc.runOnce(new Date('2026-06-09T03:00:00Z'));

    expect(prismaStub.ideaBlock.update).not.toHaveBeenCalled();
    expect(prismaStub.supportCuratorAction.create).not.toHaveBeenCalled();
    expect(res.applied).toBe(0);
  });
});
