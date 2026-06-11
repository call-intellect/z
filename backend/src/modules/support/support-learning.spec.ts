import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SupportLearningService } from './services/support-learning.service';

/**
 * support-desk Ф3 — unit-тесты SupportLearningService:
 *   - accept: внешний IssueComment(access=external, authorType=human) +
 *     draftState=accepted + SupportDraftOutcome(accepted) +
 *     LlmPreferenceSample(correct); внешний текст БЕЗ цитат `[BLOCK:`;
 *   - reject: draftState=rejected + outcome=rejected + label=wrong; БЕЗ
 *     внешнего комментария;
 *   - recordEdit: editClassify.classify вызван; outcome=edited + editType;
 *   - maybePromote: CSAT 3 (<4) → promoteAnswer НЕ вызван, {promoted:0};
 *     CSAT 5 + один accepted-неотпромоученный → promoteAnswer вызван +
 *     outcome.promotedToContour=true.
 *
 * Все зависимости замоканы. `$transaction(fn)` делегирует тому же prisma-стабу
 * (tx === prismaStub), поэтому create/update внутри транзакции видны мокам.
 */
describe('SupportLearningService', () => {
  const TENANT = 'vendor-org-1';
  const ISSUE_ID = 'issue-1';
  const DRAFT_ID = 'draft-comment-1';
  const AGENT = 'agent-1';

  let prismaStub: {
    issueComment: {
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    issue: {
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    supportDraftOutcome: {
      create: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    llmPreferenceSample: { create: ReturnType<typeof vi.fn> };
    issueRating: { findUnique: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };
  let editClassifyStub: { classify: ReturnType<typeof vi.fn> };
  let contourStub: { promoteAnswer: ReturnType<typeof vi.fn> };
  let accessStub: {
    getVendorOrgId: ReturnType<typeof vi.fn>;
    getSupportGroupId: ReturnType<typeof vi.fn>;
  };
  let activityStub: { record: ReturnType<typeof vi.fn> };
  let cfgStub: { getDynamic: ReturnType<typeof vi.fn> };
  let svc: SupportLearningService;

  beforeEach(() => {
    prismaStub = {
      issueComment: {
        findUnique: vi.fn(),
        create: vi.fn(async () => ({ id: 'external-1' })),
        update: vi.fn(async () => ({})),
      },
      issue: {
        findUnique: vi.fn(),
        update: vi.fn(async () => ({})),
      },
      supportDraftOutcome: {
        create: vi.fn(async () => ({ id: 'outcome-1' })),
        findMany: vi.fn(),
        update: vi.fn(async () => ({})),
      },
      llmPreferenceSample: { create: vi.fn(async () => ({ id: 'pref-1' })) },
      issueRating: { findUnique: vi.fn() },
      // tx === prismaStub: вызовы create/update внутри транзакции видны мокам.
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
        fn(prismaStub),
      ),
    };
    editClassifyStub = { classify: vi.fn(async () => 'tone') };
    contourStub = { promoteAnswer: vi.fn() };
    accessStub = {
      getVendorOrgId: vi.fn(async () => TENANT),
      getSupportGroupId: vi.fn(async () => 'grp-support'),
    };
    activityStub = { record: vi.fn(async () => 'act-1') };
    cfgStub = { getDynamic: vi.fn(async () => 4) };

    svc = new SupportLearningService(
      prismaStub as unknown as never,
      editClassifyStub as unknown as never,
      contourStub as unknown as never,
      accessStub as unknown as never,
      activityStub as unknown as never,
      cfgStub as unknown as never,
    );
  });

  describe('accept', () => {
    beforeEach(() => {
      prismaStub.issueComment.findUnique.mockResolvedValue({
        id: DRAFT_ID,
        issueId: ISSUE_ID,
        content: 'Сбросьте пароль по ссылке [BLOCK:b1] восстановления.',
        authorType: 'clone',
        draftState: 'pending',
        cloneConfidence: { toString: () => '0.800' },
        groundednessScore: { toString: () => '0.900' },
      });
      prismaStub.issue.findUnique.mockResolvedValue({
        id: ISSUE_ID,
        tenantId: TENANT,
        firstRespondedAt: null,
      });
    });

    it('создаёт внешний ответ (external/human) + accepted-исход + correct-sample', async () => {
      const res = await svc.accept(DRAFT_ID, AGENT);
      expect(res).toEqual({ ok: true });

      // Внешний IssueComment.
      expect(prismaStub.issueComment.create).toHaveBeenCalledTimes(1);
      const createArg = prismaStub.issueComment.create.mock.calls[0]?.[0] as {
        data: Record<string, unknown>;
      };
      expect(createArg.data.access).toBe('external');
      expect(createArg.data.authorType).toBe('human');
      expect(createArg.data.issueId).toBe(ISSUE_ID);

      // draftState=accepted.
      expect(prismaStub.issueComment.update).toHaveBeenCalledWith({
        where: { id: DRAFT_ID },
        data: { draftState: 'accepted' },
      });

      // SupportDraftOutcome(accepted).
      const outcomeArg = prismaStub.supportDraftOutcome.create.mock
        .calls[0]?.[0] as { data: Record<string, unknown> };
      expect(outcomeArg.data.outcome).toBe('accepted');

      // LlmPreferenceSample(correct).
      const prefArg = prismaStub.llmPreferenceSample.create.mock.calls[0]?.[0] as {
        data: Record<string, unknown>;
      };
      expect(prefArg.data.label).toBe('correct');
      expect(prefArg.data.taskType).toBe('support-clone-draft');

      // ActivityRecorder.
      expect(activityStub.record).toHaveBeenCalledWith(
        expect.objectContaining({ verb: 'draft_accepted', actorType: 'user' }),
      );
    });

    it('внешний текст НЕ содержит цитат [BLOCK:', async () => {
      await svc.accept(DRAFT_ID, AGENT);
      const createArg = prismaStub.issueComment.create.mock.calls[0]?.[0] as {
        data: { content: string };
      };
      expect(createArg.data.content).not.toContain('[BLOCK:');
    });

    it('убирает ведущую ⚠-пометку клона из ответа клиенту', async () => {
      prismaStub.issueComment.findUnique.mockResolvedValue({
        id: DRAFT_ID,
        issueId: ISSUE_ID,
        content:
          '⚠ Клон не уверен (обоснованность 40%). Рекомендация: уточнить.\n\nВот ответ [BLOCK:b1].',
        authorType: 'clone',
        draftState: 'pending',
        cloneConfidence: null,
        groundednessScore: null,
      });

      await svc.accept(DRAFT_ID, AGENT);
      const createArg = prismaStub.issueComment.create.mock.calls[0]?.[0] as {
        data: { content: string };
      };
      expect(createArg.data.content).not.toContain('⚠');
      expect(createArg.data.content).not.toContain('[BLOCK:');
      expect(createArg.data.content).toContain('Вот ответ');
    });

    it('черновик не pending → BadRequest', async () => {
      prismaStub.issueComment.findUnique.mockResolvedValue({
        id: DRAFT_ID,
        issueId: ISSUE_ID,
        content: 'x',
        authorType: 'clone',
        draftState: 'accepted',
        cloneConfidence: null,
        groundednessScore: null,
      });
      await expect(svc.accept(DRAFT_ID, AGENT)).rejects.toMatchObject({
        response: { error: { code: 'draft_not_available' } },
      });
    });
  });

  describe('reject', () => {
    beforeEach(() => {
      prismaStub.issueComment.findUnique.mockResolvedValue({
        id: DRAFT_ID,
        issueId: ISSUE_ID,
        content: 'плохой черновик',
        authorType: 'clone',
        draftState: 'pending',
        cloneConfidence: null,
        groundednessScore: null,
      });
      prismaStub.issue.findUnique.mockResolvedValue({
        id: ISSUE_ID,
        tenantId: TENANT,
        firstRespondedAt: null,
      });
    });

    it('rejected-исход + wrong-sample, БЕЗ внешнего комментария', async () => {
      const res = await svc.reject(DRAFT_ID, AGENT);
      expect(res).toEqual({ ok: true });

      expect(prismaStub.issueComment.update).toHaveBeenCalledWith({
        where: { id: DRAFT_ID },
        data: { draftState: 'rejected' },
      });

      const outcomeArg = prismaStub.supportDraftOutcome.create.mock
        .calls[0]?.[0] as { data: Record<string, unknown> };
      expect(outcomeArg.data.outcome).toBe('rejected');
      expect(outcomeArg.data.finalText).toBeNull();

      const prefArg = prismaStub.llmPreferenceSample.create.mock.calls[0]?.[0] as {
        data: Record<string, unknown>;
      };
      expect(prefArg.data.label).toBe('wrong');

      // Внешнего ответа быть не должно — issueComment.create НЕ вызван
      // (в reject-ветке внешний комментарий не создаётся).
      expect(prismaStub.issueComment.create).not.toHaveBeenCalled();

      expect(activityStub.record).toHaveBeenCalledWith(
        expect.objectContaining({ verb: 'draft_rejected' }),
      );
    });
  });

  describe('recordEdit', () => {
    it('classify вызван; outcome=edited + editType', async () => {
      prismaStub.issueComment.findUnique.mockResolvedValue({
        id: DRAFT_ID,
        issueId: ISSUE_ID,
        content: 'черновик клона',
        authorType: 'clone',
        draftState: 'pending',
        cloneConfidence: null,
        groundednessScore: null,
      });
      prismaStub.issue.findUnique.mockResolvedValue({
        id: ISSUE_ID,
        tenantId: TENANT,
      });
      editClassifyStub.classify.mockResolvedValue('factual');

      await svc.recordEdit(DRAFT_ID, 'финальный текст человека', AGENT);

      expect(editClassifyStub.classify).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT,
          draft: 'черновик клона',
          final: 'финальный текст человека',
        }),
      );

      const outcomeArg = prismaStub.supportDraftOutcome.create.mock
        .calls[0]?.[0] as { data: Record<string, unknown> };
      expect(outcomeArg.data.outcome).toBe('edited');
      expect(outcomeArg.data.editType).toBe('factual');

      const prefArg = prismaStub.llmPreferenceSample.create.mock.calls[0]?.[0] as {
        data: Record<string, unknown>;
      };
      expect(prefArg.data.label).toBe('edited');
    });

    it('не клон-черновик → no-op (defensive)', async () => {
      prismaStub.issueComment.findUnique.mockResolvedValue({
        id: DRAFT_ID,
        issueId: ISSUE_ID,
        content: 'обычный комментарий',
        authorType: 'human',
        draftState: null,
        cloneConfidence: null,
        groundednessScore: null,
      });

      await svc.recordEdit(DRAFT_ID, 'текст', AGENT);

      expect(editClassifyStub.classify).not.toHaveBeenCalled();
      expect(prismaStub.supportDraftOutcome.create).not.toHaveBeenCalled();
    });
  });

  describe('maybePromote', () => {
    it('CSAT 3 (<4) → promoteAnswer НЕ вызван, {promoted:0}', async () => {
      prismaStub.issueRating.findUnique.mockResolvedValue({ score: 3 });

      const res = await svc.maybePromote(ISSUE_ID);

      expect(res).toEqual({ promoted: 0 });
      expect(contourStub.promoteAnswer).not.toHaveBeenCalled();
    });

    it('нет оценки → {promoted:0}', async () => {
      prismaStub.issueRating.findUnique.mockResolvedValue(null);
      const res = await svc.maybePromote(ISSUE_ID);
      expect(res).toEqual({ promoted: 0 });
      expect(contourStub.promoteAnswer).not.toHaveBeenCalled();
    });

    it('CSAT 5 + один accepted-неотпромоученный → promoteAnswer вызван + промоут отмечен', async () => {
      prismaStub.issueRating.findUnique.mockResolvedValue({ score: 5 });
      prismaStub.issue.findUnique.mockResolvedValue({
        id: ISSUE_ID,
        tenantId: TENANT,
        title: 'Как сбросить пароль?',
      });
      prismaStub.supportDraftOutcome.findMany.mockResolvedValue([
        { id: 'outcome-1', finalText: 'Ответ клиенту.' },
      ]);
      contourStub.promoteAnswer.mockResolvedValue({
        promoted: true,
        blockId: 'blk-1',
      });

      const res = await svc.maybePromote(ISSUE_ID);

      expect(res).toEqual({ promoted: 1 });
      expect(contourStub.promoteAnswer).toHaveBeenCalledWith(
        'Как сбросить пароль?',
        'Ответ клиенту.',
      );
      expect(prismaStub.supportDraftOutcome.update).toHaveBeenCalledWith({
        where: { id: 'outcome-1' },
        data: { promotedToContour: true },
      });
    });
  });
});
