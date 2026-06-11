import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SupportCloneService } from './services/support-clone.service';

/**
 * support-desk Ф3 — unit-тесты SupportCloneService.generateDraft:
 *   - конвейер retrieval(контур) → блоки → LLM-черновик → calibrate → critic →
 *     IssueComment(authorType='clone', draftState='pending') с непустыми
 *     cloneConfidence/groundednessScore и сохранённой цитатой [BLOCK:id];
 *   - R-INV-1: fetchCandidates вызывается С contourGroupId (изоляция контура).
 *
 * Все зависимости замоканы (prisma / access / retrieval / llm / critic /
 * calibration).
 */
describe('SupportCloneService.generateDraft', () => {
  const VENDOR = 'vendor-org-1';
  const GROUP = 'grp-support';
  const TICKET = 'ticket-1';
  const AGENT = 'agent-user-1';

  let prismaStub: {
    issue: { findFirst: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
    issueComment: {
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
    ideaBlock: { findMany: ReturnType<typeof vi.fn> };
    supportDraftOutcome: { findMany: ReturnType<typeof vi.fn> };
  };
  let accessStub: {
    getVendorOrgId: ReturnType<typeof vi.fn>;
    getSupportGroupId: ReturnType<typeof vi.fn>;
  };
  let retrievalStub: { fetchCandidates: ReturnType<typeof vi.fn> };
  let llmStub: { call: ReturnType<typeof vi.fn> };
  let criticStub: { check: ReturnType<typeof vi.fn> };
  let calibrationStub: { calibrate: ReturnType<typeof vi.fn> };
  let svc: SupportCloneService;

  beforeEach(() => {
    prismaStub = {
      issue: { findFirst: vi.fn(), findMany: vi.fn() },
      issueComment: { findFirst: vi.fn(), create: vi.fn() },
      ideaBlock: { findMany: vi.fn() },
      supportDraftOutcome: { findMany: vi.fn() },
    };
    prismaStub.issue.findFirst.mockResolvedValue({
      id: TICKET,
      title: 'Как сбросить пароль?',
    });
    prismaStub.issueComment.findFirst.mockResolvedValue({
      content: 'Не могу войти, забыл пароль',
      contentStripped: 'Не могу войти, забыл пароль',
    });
    prismaStub.ideaBlock.findMany.mockResolvedValue([
      {
        id: 'b1',
        criticalQuestion: 'Как сбросить пароль?',
        trustedAnswer: 'Через ссылку восстановления.',
        name: 'reset',
      },
    ]);
    prismaStub.supportDraftOutcome.findMany.mockResolvedValue([]);
    prismaStub.issue.findMany.mockResolvedValue([]);
    prismaStub.issueComment.create.mockResolvedValue({ id: 'draft-comment-1' });

    accessStub = {
      getVendorOrgId: vi.fn(async () => VENDOR),
      getSupportGroupId: vi.fn(async () => GROUP),
    };
    retrievalStub = {
      fetchCandidates: vi.fn(async () => [
        { blockId: 'b1', score: 0.9, fromGraph: false },
      ]),
    };
    llmStub = {
      call: vi.fn(async () => ({
        text: JSON.stringify({ answer: 'Ответ [BLOCK:b1]', confidence: 0.8 }),
        modelUsed: 'deepseek:deepseek-v4-pro',
      })),
    };
    criticStub = {
      check: vi.fn(async () => ({
        groundedness: 0.9,
        verdict: 'answer',
        unsupported: [],
      })),
    };
    calibrationStub = {
      calibrate: vi.fn(async (raw: number) => raw),
    };

    svc = new SupportCloneService(
      prismaStub as unknown as never,
      accessStub as unknown as never,
      retrievalStub as unknown as never,
      llmStub as unknown as never,
      criticStub as unknown as never,
      calibrationStub as unknown as never,
    );
  });

  it('создаёт черновик клона (authorType=clone, draftState=pending, citation, scores)', async () => {
    const res = await svc.generateDraft(TICKET, AGENT);

    expect(res).toEqual({ draftCommentId: 'draft-comment-1' });
    expect(prismaStub.issueComment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          issueId: TICKET,
          authorId: AGENT,
          access: 'internal',
          authorType: 'clone',
          draftState: 'pending',
        }),
      }),
    );

    const createArg = prismaStub.issueComment.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    // Непустые decimal-поля (строки .toFixed(3)).
    expect(createArg.data.cloneConfidence).toBe('0.800');
    expect(createArg.data.groundednessScore).toBe('0.900');
    // Цитата на блок контура сохранена в теле.
    expect(String(createArg.data.content)).toContain('[BLOCK:b1]');
  });

  it('R-INV-1: fetchCandidates вызывается с contourGroupId (изоляция контура)', async () => {
    await svc.generateDraft(TICKET, AGENT);

    expect(retrievalStub.fetchCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: VENDOR,
        scope: 'org',
        contourGroupId: GROUP,
        graphHops: 0,
      }),
    );
  });

  it('критик не answer → пометка-предупреждение сверху + clarify-рекомендация', async () => {
    criticStub.check.mockResolvedValueOnce({
      groundedness: 0.4,
      verdict: 'clarify',
      unsupported: ['x'],
    });

    await svc.generateDraft(TICKET, AGENT);

    const createArg = prismaStub.issueComment.create.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(String(createArg.data.content)).toContain('Клон не уверен');
    expect(String(createArg.data.content)).toContain('уточнить детали');
  });
});
