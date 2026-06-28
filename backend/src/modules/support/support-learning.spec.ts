import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SupportLearningService } from './services/support-learning.service';

describe('SupportLearningService', () => {
  const TENANT = 'vendor-org-1';
  const CONV_ID = 'conv-1';
  const DRAFT_ID = 'draft-msg-1';
  const AGENT = 'agent-1';

  let prismaStub: {
    supportTicket: {
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
  let messagesStub: {
    getDraftMessage: ReturnType<typeof vi.fn>;
    appendTicketMessage: ReturnType<typeof vi.fn>;
    setDraftState: ReturnType<typeof vi.fn>;
  };
  let cfgStub: { getDynamic: ReturnType<typeof vi.fn> };
  let svc: SupportLearningService;

  function draftView(overrides: Record<string, unknown> = {}) {
    return {
      id: DRAFT_ID,
      conversationId: CONV_ID,
      tenantId: TENANT,
      authorType: 'clone',
      draftState: 'pending',
      content: 'Сбросьте пароль по ссылке [BLOCK:b1] восстановления.',
      cloneConfidence: '0.800',
      groundednessScore: '0.900',
      ...overrides,
    };
  }

  beforeEach(() => {
    prismaStub = {
      supportTicket: {
        findUnique: vi.fn(async () => ({ firstRespondedAt: null })),
        update: vi.fn(async () => ({})),
      },
      supportDraftOutcome: {
        create: vi.fn(async () => ({ id: 'outcome-1' })),
        findMany: vi.fn(),
        update: vi.fn(async () => ({})),
      },
      llmPreferenceSample: { create: vi.fn(async () => ({ id: 'pref-1' })) },
      issueRating: { findUnique: vi.fn() },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prismaStub)),
    };
    editClassifyStub = { classify: vi.fn(async () => 'tone') };
    contourStub = { promoteAnswer: vi.fn() };
    accessStub = {
      getVendorOrgId: vi.fn(async () => TENANT),
      getSupportGroupId: vi.fn(async () => 'grp-support'),
    };
    messagesStub = {
      getDraftMessage: vi.fn(async () => draftView()),
      appendTicketMessage: vi.fn(async () => ({ messageId: 'external-1', seq: '3' })),
      setDraftState: vi.fn(async () => undefined),
    };
    cfgStub = { getDynamic: vi.fn(async () => 4) };

    svc = new SupportLearningService(
      prismaStub as unknown as never,
      editClassifyStub as unknown as never,
      contourStub as unknown as never,
      accessStub as unknown as never,
      messagesStub as unknown as never,
      cfgStub as unknown as never,
    );
  });

  describe('accept', () => {
    it('создаёт внешний Message (external/human) + accepted-исход + correct-sample', async () => {
      const res = await svc.accept(DRAFT_ID, AGENT);
      expect(res).toEqual({ ok: true });

      expect(messagesStub.appendTicketMessage).toHaveBeenCalledTimes(1);
      const appendArg = messagesStub.appendTicketMessage.mock.calls[0]?.[0] as Record<
        string,
        unknown
      >;
      expect(appendArg.access).toBe('external');
      expect(appendArg.authorType).toBe('human');
      expect(appendArg.conversationId).toBe(CONV_ID);

      expect(messagesStub.setDraftState).toHaveBeenCalledWith({
        messageId: DRAFT_ID,
        draftState: 'accepted',
      });

      const outcomeArg = prismaStub.supportDraftOutcome.create.mock.calls[0]?.[0] as {
        data: Record<string, unknown>;
      };
      expect(outcomeArg.data.outcome).toBe('accepted');
      expect(outcomeArg.data.conversationId).toBe(CONV_ID);
      expect(outcomeArg.data.draftMessageId).toBe(DRAFT_ID);

      const prefArg = prismaStub.llmPreferenceSample.create.mock.calls[0]?.[0] as {
        data: Record<string, unknown>;
      };
      expect(prefArg.data.label).toBe('correct');
      expect(prefArg.data.taskType).toBe('support-clone-draft');
      expect(prefArg.data.inputContext).toEqual({ conversationId: CONV_ID });
    });

    it('выставляет firstRespondedAt когда пуст', async () => {
      await svc.accept(DRAFT_ID, AGENT);
      expect(prismaStub.supportTicket.update).toHaveBeenCalledWith({
        where: { conversationId: CONV_ID },
        data: { firstRespondedAt: expect.any(Date) },
      });
    });

    it('firstRespondedAt уже стоит → update тикета не вызывается', async () => {
      prismaStub.supportTicket.findUnique.mockResolvedValue({ firstRespondedAt: new Date() });
      await svc.accept(DRAFT_ID, AGENT);
      expect(prismaStub.supportTicket.update).not.toHaveBeenCalled();
    });

    it('внешний текст НЕ содержит цитат [BLOCK:', async () => {
      await svc.accept(DRAFT_ID, AGENT);
      const appendArg = messagesStub.appendTicketMessage.mock.calls[0]?.[0] as { content: string };
      expect(appendArg.content).not.toContain('[BLOCK:');
    });

    it('убирает ведущую ⚠-пометку клона из ответа клиенту', async () => {
      messagesStub.getDraftMessage.mockResolvedValue(
        draftView({
          content:
            '⚠ Клон не уверен (обоснованность 40%). Рекомендация: уточнить.\n\nВот ответ [BLOCK:b1].',
          cloneConfidence: null,
          groundednessScore: null,
        }),
      );

      await svc.accept(DRAFT_ID, AGENT);
      const appendArg = messagesStub.appendTicketMessage.mock.calls[0]?.[0] as { content: string };
      expect(appendArg.content).not.toContain('⚠');
      expect(appendArg.content).not.toContain('[BLOCK:');
      expect(appendArg.content).toContain('Вот ответ');
    });

    it('черновик не pending → BadRequest', async () => {
      messagesStub.getDraftMessage.mockResolvedValue(draftView({ draftState: 'accepted' }));
      await expect(svc.accept(DRAFT_ID, AGENT)).rejects.toMatchObject({
        response: { error: { code: 'draft_not_available' } },
      });
    });
  });

  describe('reject', () => {
    beforeEach(() => {
      messagesStub.getDraftMessage.mockResolvedValue(
        draftView({ content: 'плохой черновик', cloneConfidence: null, groundednessScore: null }),
      );
    });

    it('rejected-исход + wrong-sample, БЕЗ внешнего Message', async () => {
      const res = await svc.reject(DRAFT_ID, AGENT);
      expect(res).toEqual({ ok: true });

      expect(messagesStub.setDraftState).toHaveBeenCalledWith({
        messageId: DRAFT_ID,
        draftState: 'rejected',
      });

      const outcomeArg = prismaStub.supportDraftOutcome.create.mock.calls[0]?.[0] as {
        data: Record<string, unknown>;
      };
      expect(outcomeArg.data.outcome).toBe('rejected');
      expect(outcomeArg.data.finalText).toBeNull();

      const prefArg = prismaStub.llmPreferenceSample.create.mock.calls[0]?.[0] as {
        data: Record<string, unknown>;
      };
      expect(prefArg.data.label).toBe('wrong');

      expect(messagesStub.appendTicketMessage).not.toHaveBeenCalled();
    });
  });

  describe('recordEdit', () => {
    it('classify вызван; outcome=edited + editType', async () => {
      messagesStub.getDraftMessage.mockResolvedValue(
        draftView({ content: 'черновик клона', cloneConfidence: null, groundednessScore: null }),
      );
      editClassifyStub.classify.mockResolvedValue('factual');

      await svc.recordEdit(DRAFT_ID, 'финальный текст человека', AGENT);

      expect(editClassifyStub.classify).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT,
          draft: 'черновик клона',
          final: 'финальный текст человека',
        }),
      );

      expect(messagesStub.setDraftState).toHaveBeenCalledWith({
        messageId: DRAFT_ID,
        draftState: 'edited',
      });

      const outcomeArg = prismaStub.supportDraftOutcome.create.mock.calls[0]?.[0] as {
        data: Record<string, unknown>;
      };
      expect(outcomeArg.data.outcome).toBe('edited');
      expect(outcomeArg.data.editType).toBe('factual');

      const prefArg = prismaStub.llmPreferenceSample.create.mock.calls[0]?.[0] as {
        data: Record<string, unknown>;
      };
      expect(prefArg.data.label).toBe('edited');
    });

    it('не клон-черновик → no-op (defensive)', async () => {
      messagesStub.getDraftMessage.mockResolvedValue(
        draftView({ authorType: 'human', draftState: null }),
      );

      await svc.recordEdit(DRAFT_ID, 'текст', AGENT);

      expect(editClassifyStub.classify).not.toHaveBeenCalled();
      expect(prismaStub.supportDraftOutcome.create).not.toHaveBeenCalled();
    });
  });

  describe('maybePromote', () => {
    it('CSAT 3 (<4) → promoteAnswer НЕ вызван, {promoted:0}', async () => {
      prismaStub.issueRating.findUnique.mockResolvedValue({ score: 3 });

      const res = await svc.maybePromote(CONV_ID);

      expect(res).toEqual({ promoted: 0 });
      expect(contourStub.promoteAnswer).not.toHaveBeenCalled();
    });

    it('нет оценки → {promoted:0}', async () => {
      prismaStub.issueRating.findUnique.mockResolvedValue(null);
      const res = await svc.maybePromote(CONV_ID);
      expect(res).toEqual({ promoted: 0 });
      expect(contourStub.promoteAnswer).not.toHaveBeenCalled();
    });

    it('CSAT 5 + один accepted-неотпромоученный → promoteAnswer вызван + промоут отмечен', async () => {
      prismaStub.issueRating.findUnique.mockResolvedValue({ score: 5 });
      prismaStub.supportTicket.findUnique.mockResolvedValue({
        tenantId: TENANT,
        conversation: { title: 'Как сбросить пароль?' },
      });
      prismaStub.supportDraftOutcome.findMany.mockResolvedValue([
        { id: 'outcome-1', finalText: 'Ответ клиенту.' },
      ]);
      contourStub.promoteAnswer.mockResolvedValue({
        promoted: true,
        blockId: 'blk-1',
      });

      const res = await svc.maybePromote(CONV_ID);

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
