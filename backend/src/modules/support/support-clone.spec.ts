import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SupportCloneService } from './services/support-clone.service';

describe('SupportCloneService.generateDraft', () => {
  const VENDOR = 'vendor-org-1';
  const GROUP = 'grp-support';
  const TICKET = 'ticket-1';
  const AGENT = 'agent-user-1';

  let prismaStub: {
    supportTicket: { findFirst: ReturnType<typeof vi.fn> };
    ideaBlock: { findMany: ReturnType<typeof vi.fn> };
    supportDraftOutcome: { findMany: ReturnType<typeof vi.fn> };
    conversation: { findMany: ReturnType<typeof vi.fn> };
  };
  let accessStub: {
    getVendorOrgId: ReturnType<typeof vi.fn>;
    getSupportGroupId: ReturnType<typeof vi.fn>;
  };
  let retrievalStub: { fetchCandidates: ReturnType<typeof vi.fn> };
  let llmStub: { call: ReturnType<typeof vi.fn> };
  let criticStub: { check: ReturnType<typeof vi.fn> };
  let calibrationStub: { calibrate: ReturnType<typeof vi.fn> };
  let messagesStub: {
    getLastExternalQuestion: ReturnType<typeof vi.fn>;
    appendTicketMessage: ReturnType<typeof vi.fn>;
  };
  let svc: SupportCloneService;

  beforeEach(() => {
    prismaStub = {
      supportTicket: { findFirst: vi.fn() },
      ideaBlock: { findMany: vi.fn() },
      supportDraftOutcome: { findMany: vi.fn() },
      conversation: { findMany: vi.fn() },
    };
    prismaStub.supportTicket.findFirst.mockResolvedValue({
      conversationId: TICKET,
      conversation: { title: 'Как сбросить пароль?' },
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
    prismaStub.conversation.findMany.mockResolvedValue([]);

    accessStub = {
      getVendorOrgId: vi.fn(async () => VENDOR),
      getSupportGroupId: vi.fn(async () => GROUP),
    };
    retrievalStub = {
      fetchCandidates: vi.fn(async () => [{ blockId: 'b1', score: 0.9, fromGraph: false }]),
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
    messagesStub = {
      getLastExternalQuestion: vi.fn(async () => 'Не могу войти, забыл пароль'),
      appendTicketMessage: vi.fn(async () => ({ messageId: 'draft-msg-1', seq: '2' })),
    };

    svc = new SupportCloneService(
      prismaStub as unknown as never,
      accessStub as unknown as never,
      retrievalStub as unknown as never,
      llmStub as unknown as never,
      criticStub as unknown as never,
      calibrationStub as unknown as never,
      messagesStub as unknown as never,
    );
  });

  it('создаёт черновик клона (authorType=clone, draftState=pending, citation, scores)', async () => {
    const res = await svc.generateDraft(TICKET, AGENT);

    expect(res).toEqual({ draftMessageId: 'draft-msg-1' });
    expect(messagesStub.appendTicketMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: TICKET,
        tenantId: VENDOR,
        authorUserId: AGENT,
        access: 'internal',
        authorType: 'clone',
        draftState: 'pending',
        emitOutbox: false,
      }),
    );

    const appendArg = messagesStub.appendTicketMessage.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(appendArg.cloneConfidence).toBe('0.800');
    expect(appendArg.groundednessScore).toBe('0.900');
    expect(String(appendArg.content)).toContain('[BLOCK:b1]');
  });

  it('вопрос берётся из последнего external Message клиента', async () => {
    await svc.generateDraft(TICKET, AGENT);

    expect(messagesStub.getLastExternalQuestion).toHaveBeenCalledWith(TICKET);
    const llmArg = llmStub.call.mock.calls[0]?.[0] as { userMessage: string };
    expect(llmArg.userMessage).toContain('Не могу войти, забыл пароль');
  });

  it('нет external Message → вопрос = заголовок тикета (fallback)', async () => {
    messagesStub.getLastExternalQuestion.mockResolvedValueOnce(null);

    await svc.generateDraft(TICKET, AGENT);

    const llmArg = llmStub.call.mock.calls[0]?.[0] as { userMessage: string };
    expect(llmArg.userMessage).toContain('Как сбросить пароль?');
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

  it('контур-изоляция: черновик цитирует только блоки контура (по blockId из retrieval)', async () => {
    await svc.generateDraft(TICKET, AGENT);

    const ideaArg = prismaStub.ideaBlock.findMany.mock.calls[0]?.[0] as {
      where: { id: { in: string[] } };
    };
    expect(ideaArg.where.id.in).toEqual(['b1']);
    const appendArg = messagesStub.appendTicketMessage.mock.calls[0]?.[0] as { content: string };
    expect(appendArg.content).toContain('[BLOCK:b1]');
  });

  it('критик не answer → пометка-предупреждение сверху + clarify-рекомендация', async () => {
    criticStub.check.mockResolvedValueOnce({
      groundedness: 0.4,
      verdict: 'clarify',
      unsupported: ['x'],
    });

    await svc.generateDraft(TICKET, AGENT);

    const appendArg = messagesStub.appendTicketMessage.mock.calls[0]?.[0] as { content: string };
    expect(String(appendArg.content)).toContain('Клон не уверен');
    expect(String(appendArg.content)).toContain('уточнить детали');
  });
});
