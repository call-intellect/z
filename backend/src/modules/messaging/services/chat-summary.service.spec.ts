import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { CryptoService } from '../../../common/crypto/crypto.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import { CHAT_SUMMARY_SYSTEM_PROMPT } from '../prompts/chat-summary.prompt';

import { ChatSummaryService } from './chat-summary.service';

function makeMessage(seq: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `msg-${seq}`,
    seq: BigInt(seq),
    authorUserId: 'author-1',
    content: `gcm:v1:сообщение ${seq}`,
    voiceTranscript: null,
    ...overrides,
  };
}

function build(opts: {
  member?: { lastReadSeq: bigint } | null;
  messages?: ReturnType<typeof makeMessage>[];
  minMessages?: number;
  llmText?: string;
}) {
  const messageRows = opts.messages ?? [];
  const findMany = vi.fn().mockResolvedValue(messageRows);
  const memberFindUnique = vi
    .fn()
    .mockResolvedValue(opts.member === undefined ? { lastReadSeq: 3n } : opts.member);
  const callFn = vi
    .fn()
    .mockResolvedValue({ text: opts.llmText ?? 'сводка [MSG:msg-4]' });

  const prisma = {
    conversationMember: { findUnique: memberFindUnique },
    message: { findMany },
    conversation: {
      findUnique: vi.fn().mockResolvedValue({ title: 'Маркетинг', tenantId: 'org-1' }),
    },
    person: { findMany: vi.fn().mockResolvedValue([{ userId: 'author-1', name: 'Аня' }]) },
  } as unknown as PrismaService;

  const crypto = {
    decrypt: vi.fn((v: string) => v.replace(/^gcm:v1:/, '')),
  } as unknown as CryptoService;

  const cfg = {
    getDynamic: vi.fn(async () => opts.minMessages ?? 5),
  } as unknown as TypedConfigService;

  const llm = { call: callFn } as unknown as LlmRouterService;

  const service = new ChatSummaryService(prisma, crypto, cfg, llm);
  return { service, callFn, findMany };
}

describe('ChatSummaryService.summarizeUnread', () => {
  it('count < min → skipped=too_few, LLM не вызван', async () => {
    const { service, callFn } = build({
      member: { lastReadSeq: 3n },
      messages: [makeMessage(4), makeMessage(5)],
      minMessages: 5,
    });

    const result = await service.summarizeUnread({ conversationId: 'conv-1', userId: 'u-1' });

    expect(result).toEqual({ skipped: 'too_few' });
    expect(callFn).not.toHaveBeenCalled();
  });

  it('count >= min → llm.call(taskType=chat-summary) со стабильным SYSTEM, summary возвращён', async () => {
    const msgs = [4, 5, 6, 7, 8, 9].map((s) => makeMessage(s));
    const { service, callFn } = build({
      member: { lastReadSeq: 3n },
      messages: msgs,
      minMessages: 5,
      llmText: 'кратко [MSG:msg-9]',
    });

    const result = await service.summarizeUnread({ conversationId: 'conv-1', userId: 'u-1' });

    expect(callFn).toHaveBeenCalledTimes(1);
    const arg = callFn.mock.calls[0]![0];
    expect(arg.taskType).toBe('chat-summary');
    expect(arg.systemPrompt).toBe(CHAT_SUMMARY_SYSTEM_PROMPT);
    expect(arg.dataClass).toBe('internal');
    expect(arg.userMessage).toContain('[MSG:msg-9]');
    expect('summary' in result && result.summary).toBe('кратко [MSG:msg-9]');
    expect('toSeq' in result && result.toSeq).toBe('9');
    expect('fromSeq' in result && result.fromSeq).toBe('4');
    expect('messageCount' in result && result.messageCount).toBe(6);
  });

  it('система-сообщения исключены из выборки (where authorType not system)', async () => {
    const msgs = [4, 5, 6, 7, 8].map((s) => makeMessage(s));
    const { service, findMany } = build({
      member: { lastReadSeq: 3n },
      messages: msgs,
      minMessages: 5,
    });

    await service.summarizeUnread({ conversationId: 'conv-1', userId: 'u-1' });

    const where = findMany.mock.calls[0]![0].where;
    expect(where.authorType).toEqual({ not: 'system' });
    expect(where.deletedAt).toBeNull();
  });

  it('не член → 403', async () => {
    const { service, callFn } = build({ member: null });

    await expect(
      service.summarizeUnread({ conversationId: 'conv-1', userId: 'u-1' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(callFn).not.toHaveBeenCalled();
  });
});
