import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../../ai/services/llm-router.service';
import type { AssigneeResolverService } from '../../../tracker/services/assignee-resolver.service';

import { TelegramTaskParserService } from './telegram-task-parser.service';

interface PrismaMock {
  intakeIssue: { create: ReturnType<typeof vi.fn> };
  person: { findMany: ReturnType<typeof vi.fn> };
  project: {
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
}

function makePrisma(): PrismaMock {
  return {
    intakeIssue: {
      create: vi
        .fn()
        .mockImplementation((args: { data: { id?: string } }) =>
          Promise.resolve({ id: 'intake-1', ...args.data }),
        ),
    },
    person: { findMany: vi.fn().mockResolvedValue([]) },
    project: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

function makeLlm(): LlmRouterService {
  return { call: vi.fn() } as unknown as LlmRouterService;
}

interface ResolverMock {
  resolve: ReturnType<typeof vi.fn>;
}

function makeResolver(): ResolverMock {
  return { resolve: vi.fn().mockResolvedValue({ kind: 'not_found' }) };
}

function makeParser(
  prisma: PrismaMock,
  llm: LlmRouterService,
  resolver?: ResolverMock,
): TelegramTaskParserService {
  return new TelegramTaskParserService(
    prisma as unknown as PrismaService,
    llm,
    null,
    resolver as unknown as AssigneeResolverService,
  );
}

describe('TelegramTaskParserService', () => {
  let prisma: PrismaMock;
  let llm: LlmRouterService;
  let resolver: ResolverMock;
  let parser: TelegramTaskParserService;

  beforeEach(() => {
    prisma = makePrisma();
    llm = makeLlm();
    resolver = makeResolver();
    parser = makeParser(prisma, llm, resolver);
  });

  describe('parseCreateTask', () => {
    it('возвращает intakeIssueId + autoTriageEnqueued=true при confidence ≥ 0.85 (исполнитель через единый резолвер)', async () => {
      vi.mocked(llm.call).mockResolvedValue({
        text: JSON.stringify({
          title: 'Замерить и привезти расчёт по объекту Тверская',
          suggestedAssigneeHint: 'Сергею',
          suggestedDueDate: '2026-05-24',
          suggestedProjectHint: 'Тверская',
          suggestedPriority: 'high',
          confidence: 0.92,
          sourceQuote: 'Сергею, завтра в 15...',
        }),
        modelUsed: 'deepseek:deepseek-chat',
        inputTokens: 100,
        outputTokens: 50,
        cachedTokens: 0,
        durationMs: 500,
      });
      resolver.resolve.mockResolvedValueOnce({
        kind: 'resolved',
        userId: 'u1',
        name: 'Сергей',
        via: 'name',
      });
      prisma.project.findFirst.mockResolvedValueOnce({ id: 'proj-1' });

      const result = await parser.parseCreateTask({
        tenantId: 'org-1',
        userId: 'u-author',
        rawText: 'Сергею, завтра в 15, объект Тверская — замерить и привезти расчёт',
        externalId: '12345:67',
      });

      expect(resolver.resolve).toHaveBeenCalledWith('org-1', 'Сергею');
      expect(result.intakeIssueId).toBe('intake-1');
      expect(result.autoTriageEnqueued).toBe(true);
      expect(result.confidence).toBe(0.92);
      expect(result.reason).toBe('ok');
      expect(result.suggested).toEqual({
        title: 'Замерить и привезти расчёт по объекту Тверская',
        suggestedAssigneeId: 'u1',
        suggestedProjectId: 'proj-1',
        suggestedDueDate: expect.any(String),
        suggestedPriority: 'high',
      });

      expect(prisma.intakeIssue.create).toHaveBeenCalledOnce();
      const createCalls = prisma.intakeIssue.create.mock.calls;
      const firstCall = createCalls[0];
      expect(firstCall).toBeDefined();
      const createArg = firstCall![0] as { data: Record<string, unknown> };
      expect(createArg.data.source).toBe('telegram');
      expect(createArg.data.externalSource).toBe('telegram');
      expect(createArg.data.externalId).toBe('12345:67');
      expect(createArg.data.suggestedAssigneeId).toBe('u1');
      expect(createArg.data.suggestedProjectId).toBe('proj-1');
      expect(createArg.data.confidence).toBeInstanceOf(Prisma.Decimal);
    });

    it('исполнитель not_found → suggestedAssigneeId=null (резолвер вызван с hint)', async () => {
      vi.mocked(llm.call).mockResolvedValue({
        text: JSON.stringify({
          title: 'Замерить и привезти расчёт по объекту Тверская',
          suggestedAssigneeHint: 'Сергею',
          suggestedDueDate: '2026-05-24',
          suggestedProjectHint: 'Тверская',
          suggestedPriority: 'high',
          confidence: 0.92,
          sourceQuote: 'Сергею, завтра в 15...',
        }),
        modelUsed: 'deepseek:deepseek-chat',
        inputTokens: 100,
        outputTokens: 50,
        cachedTokens: 0,
        durationMs: 500,
      });
      resolver.resolve.mockResolvedValueOnce({ kind: 'not_found' });
      prisma.project.findFirst.mockResolvedValueOnce({ id: 'proj-1' });

      const result = await parser.parseCreateTask({
        tenantId: 'org-1',
        userId: 'u-author',
        rawText: 'Сергею, завтра — замерить и привезти расчёт',
        externalId: '12345:68',
      });

      expect(resolver.resolve).toHaveBeenCalledWith('org-1', 'Сергею');
      expect(result.suggested?.suggestedAssigneeId).toBeNull();
      const createArg = prisma.intakeIssue.create.mock.calls[0]?.[0] as {
        data: Record<string, unknown>;
      };
      expect(createArg.data.suggestedAssigneeId).toBeNull();
    });

    it('autoTriageEnqueued=false при confidence < 0.85', async () => {
      vi.mocked(llm.call).mockResolvedValue({
        text: JSON.stringify({
          title: 'Что-то непонятное',
          confidence: 0.4,
        }),
        modelUsed: 'deepseek:deepseek-chat',
        inputTokens: 10,
        outputTokens: 5,
        cachedTokens: 0,
        durationMs: 200,
      });
      const result = await parser.parseCreateTask({
        tenantId: 'org-1',
        userId: 'u-1',
        rawText: 'непонятное сообщение',
      });
      expect(result.intakeIssueId).toBe('intake-1');
      expect(result.autoTriageEnqueued).toBe(false);
      expect(result.confidence).toBe(0.4);
    });

    it('пустой text → reason=empty_text, без LLM вызова', async () => {
      const result = await parser.parseCreateTask({
        tenantId: 'org-1',
        userId: 'u-1',
        rawText: '   ',
      });
      expect(result.reason).toBe('empty_text');
      expect(result.intakeIssueId).toBeNull();
      expect(llm.call).not.toHaveBeenCalled();
    });

    it('LLM упал → reason=llm_failed, без создания IntakeIssue', async () => {
      vi.mocked(llm.call).mockRejectedValueOnce(new Error('boom'));
      const result = await parser.parseCreateTask({
        tenantId: 'org-1',
        userId: 'u-1',
        rawText: 'some task',
      });
      expect(result.reason).toBe('llm_failed');
      expect(result.intakeIssueId).toBeNull();
      expect(prisma.intakeIssue.create).not.toHaveBeenCalled();
    });

    it('LLM вернул невалидный JSON title=null → reason=llm_failed', async () => {
      vi.mocked(llm.call).mockResolvedValueOnce({
        text: JSON.stringify({ confidence: 0.5 }),
        modelUsed: 'deepseek:deepseek-chat',
        inputTokens: 10,
        outputTokens: 5,
        cachedTokens: 0,
        durationMs: 200,
      });
      const result = await parser.parseCreateTask({
        tenantId: 'org-1',
        userId: 'u-1',
        rawText: 'some task',
      });
      expect(result.reason).toBe('llm_failed');
    });

    it('SYSTEM содержит негативный класс «не задача» (Ф7)', async () => {
      vi.mocked(llm.call).mockResolvedValueOnce({
        text: JSON.stringify({ title: 'X', confidence: 0.3 }),
        modelUsed: 'deepseek:deepseek-chat',
        inputTokens: 10,
        outputTokens: 5,
        cachedTokens: 0,
        durationMs: 200,
      });
      await parser.parseCreateTask({
        tenantId: 'org-1',
        userId: 'u-1',
        rawText: 'какие у меня задачи?',
      });
      const callArg = vi.mocked(llm.call).mock.calls[0]?.[0] as
        | { systemPrompt?: string }
        | undefined;
      expect(callArg?.systemPrompt).toBeDefined();
      expect(callArg!.systemPrompt).toContain('Не задача (НЕ извлекай');
      expect(callArg!.systemPrompt).toContain('/actions');
      expect(callArg!.systemPrompt).toContain('запрос ответа, не поручение');
    });

    it('на вопрос «/actions» с пустым title → IntakeIssue НЕ создан', async () => {
      vi.mocked(llm.call).mockResolvedValueOnce({
        text: JSON.stringify({ title: '', confidence: 0 }),
        modelUsed: 'deepseek:deepseek-chat',
        inputTokens: 10,
        outputTokens: 2,
        cachedTokens: 0,
        durationMs: 100,
      });
      const result = await parser.parseCreateTask({
        tenantId: 'org-1',
        userId: 'u-1',
        rawText: '/actions',
      });
      expect(result.intakeIssueId).toBeNull();
      expect(result.reason).toBe('llm_failed');
      expect(prisma.intakeIssue.create).not.toHaveBeenCalled();
    });
  });

  describe('parseForwardToTask', () => {
    it('создаёт IntakeIssue с source=telegram_forward', async () => {
      vi.mocked(llm.call).mockResolvedValueOnce({
        text: JSON.stringify({
          title: 'Согласовать договор с клиентом',
          confidence: 0.7,
        }),
        modelUsed: 'deepseek:deepseek-chat',
        inputTokens: 10,
        outputTokens: 5,
        cachedTokens: 0,
        durationMs: 200,
      });
      const result = await parser.parseForwardToTask({
        tenantId: 'org-1',
        userId: 'u-author',
        forwardedText: 'Пересланное сообщение от клиента про договор',
      });
      expect(result.intakeIssueId).toBe('intake-1');
      const fwdCalls = prisma.intakeIssue.create.mock.calls;
      const fwdFirst = fwdCalls[0];
      expect(fwdFirst).toBeDefined();
      const createArg = fwdFirst![0] as { data: Record<string, unknown> };
      expect(createArg.data.source).toBe('telegram_forward');
      expect(createArg.data.externalSource).toBe('telegram_forward');
    });
  });

  describe('classifyReply', () => {
    it('status_command + accept', async () => {
      vi.mocked(llm.call).mockResolvedValueOnce({
        text: JSON.stringify({ kind: 'status_command', statusAction: 'accept' }),
        modelUsed: 'ollama:qwen3.5:9b',
        inputTokens: 5,
        outputTokens: 3,
        cachedTokens: 0,
        durationMs: 100,
      });
      const r = await parser.classifyReply({
        tenantId: 'org-1',
        userId: 'u-1',
        replyText: 'принял',
        relatedIssueId: 'issue-1',
      });
      expect(r.kind).toBe('status_command');
      if (r.kind === 'status_command') {
        expect(r.action).toBe('accept');
      }
    });

    it('postpone_one_day из LLM', async () => {
      vi.mocked(llm.call).mockResolvedValueOnce({
        text: JSON.stringify({
          kind: 'status_command',
          statusAction: 'postpone_one_day',
        }),
        modelUsed: 'ollama:qwen3.5:9b',
        inputTokens: 5,
        outputTokens: 3,
        cachedTokens: 0,
        durationMs: 100,
      });
      const r = await parser.classifyReply({
        tenantId: 'org-1',
        userId: 'u-1',
        replyText: '+1 день',
        relatedIssueId: 'issue-1',
      });
      expect(r.kind).toBe('status_command');
      if (r.kind === 'status_command') {
        expect(r.action).toBe('postpone_one_day');
      }
    });

    it('comment с очищенным текстом', async () => {
      vi.mocked(llm.call).mockResolvedValueOnce({
        text: JSON.stringify({
          kind: 'comment',
          commentText: 'Уточнил у заказчика — согласовали',
        }),
        modelUsed: 'ollama:qwen3.5:9b',
        inputTokens: 5,
        outputTokens: 5,
        cachedTokens: 0,
        durationMs: 100,
      });
      const r = await parser.classifyReply({
        tenantId: 'org-1',
        userId: 'u-1',
        replyText: 'уточнил у заказчика согласовали',
        relatedIssueId: 'issue-1',
      });
      expect(r.kind).toBe('comment');
      if (r.kind === 'comment') {
        expect(r.text).toBe('Уточнил у заказчика — согласовали');
      }
    });

    it('LLM упал → fallback на эвристику (accept по «принял»)', async () => {
      vi.mocked(llm.call).mockRejectedValueOnce(new Error('llm down'));
      const r = await parser.classifyReply({
        tenantId: 'org-1',
        userId: 'u-1',
        replyText: 'принял',
        relatedIssueId: null,
      });
      expect(r.kind).toBe('status_command');
      if (r.kind === 'status_command') {
        expect(r.action).toBe('accept');
      }
    });

    it('LLM вернул невалидный JSON → fallback на эвристику', async () => {
      vi.mocked(llm.call).mockResolvedValueOnce({
        text: 'not json at all',
        modelUsed: 'ollama:qwen3.5:9b',
        inputTokens: 5,
        outputTokens: 5,
        cachedTokens: 0,
        durationMs: 100,
      });
      const r = await parser.classifyReply({
        tenantId: 'org-1',
        userId: 'u-1',
        replyText: 'обычный текст без команды',
        relatedIssueId: 'issue-1',
      });
      expect(r.kind).toBe('comment');
    });

    it('пустой текст → unknown', async () => {
      const r = await parser.classifyReply({
        tenantId: 'org-1',
        userId: 'u-1',
        replyText: '   ',
        relatedIssueId: null,
      });
      expect(r.kind).toBe('unknown');
    });
  });

  describe('formulateDigest', () => {
    it('пустой payload → null (без вызова LLM)', async () => {
      const result = await parser.formulateDigest({
        tenantId: 'org-1',
        userId: 'u-1',
        issuesPayload: { urgentToday: [], inProgress: [], overdue: [] },
      });
      expect(result).toBeNull();
      expect(llm.call).not.toHaveBeenCalled();
    });

    it('LLM ОК → возвращает HTML', async () => {
      vi.mocked(llm.call).mockResolvedValueOnce({
        text: '<b>Утро!</b> Срочно: KORA-1.',
        modelUsed: 'deepseek:deepseek-chat',
        inputTokens: 30,
        outputTokens: 20,
        cachedTokens: 0,
        durationMs: 500,
      });
      const result = await parser.formulateDigest({
        tenantId: 'org-1',
        userId: 'u-1',
        issuesPayload: {
          urgentToday: [{ identifier: 'KORA-1', title: 'Тест' }],
          inProgress: [],
          overdue: [],
        },
      });
      expect(result).toContain('Утро');
    });

    it('LLM упал → fallback markdown', async () => {
      vi.mocked(llm.call).mockRejectedValueOnce(new Error('boom'));
      const result = await parser.formulateDigest({
        tenantId: 'org-1',
        userId: 'u-1',
        issuesPayload: {
          urgentToday: [{ identifier: 'KORA-1', title: 'Срочная' }],
          inProgress: [],
          overdue: [{ identifier: 'KORA-2', title: 'Старая', daysOverdue: 2 }],
        },
      });
      expect(result).toBeTruthy();
      expect(result).toContain('Доброе утро');
      expect(result).toContain('KORA-1');
      expect(result).toContain('KORA-2');
      expect(result).toContain('на 2 дн');
    });

    it('застрявшие (stalled) в fallback → секция «Застряли» с identifier', async () => {
      vi.mocked(llm.call).mockRejectedValueOnce(new Error('boom'));
      const result = await parser.formulateDigest({
        tenantId: 'org-1',
        userId: 'u-1',
        issuesPayload: {
          urgentToday: [],
          inProgress: [],
          overdue: [],
          stalled: [{ identifier: 'KORA-9', title: 'Застряла', daysIdle: 3 }],
        },
      });
      expect(result).toBeTruthy();
      expect(result).toContain('Застряли');
      expect(result).toContain('KORA-9');
      expect(result).toContain('3 дн');
    });
  });
});
