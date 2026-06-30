import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';

import type { ConversationService } from './conversation.service';
import type { MessageService } from './message.service';
import { PollService } from './poll.service';

function makeService(overrides: {
  isMember?: boolean;
  poll?: unknown;
  options?: Array<{ id: string; text: string }>;
  tally?: Array<{ optionId: string; _count: { optionId: number } }>;
} = {}) {
  const pollCreate = vi.fn().mockResolvedValue({ id: 'poll-1' });
  const pollFindUnique = vi.fn().mockResolvedValue(overrides.poll ?? null);
  const pollUpdate = vi.fn().mockResolvedValue({ id: 'poll-1' });
  const pollVoteUpsert = vi.fn().mockResolvedValue({ id: 'vote-1' });
  const pollVoteGroupBy = vi.fn().mockResolvedValue(overrides.tally ?? []);
  const pollOptionFindMany = vi.fn().mockResolvedValue(overrides.options ?? []);
  const ideaBlockCreate = vi.fn().mockResolvedValue({ id: 'block-1' });

  const prisma = {
    poll: {
      create: pollCreate,
      findUnique: pollFindUnique,
      update: pollUpdate,
    },
    pollVote: {
      upsert: pollVoteUpsert,
      groupBy: pollVoteGroupBy,
    },
    pollOption: {
      findMany: pollOptionFindMany,
    },
    ideaBlock: {
      create: ideaBlockCreate,
    },
  } as unknown as PrismaService;

  const assertMember = vi.fn().mockResolvedValue(overrides.isMember ?? true);
  const conversations = { assertMember } as unknown as ConversationService;

  const appendSystemMessage = vi
    .fn()
    .mockResolvedValue({ messageId: 'sys-1', seq: '1', deduped: false });
  const messages = { appendSystemMessage } as unknown as MessageService;

  const svc = new PollService(prisma, conversations, messages);

  return {
    svc,
    assertMember,
    pollCreate,
    pollUpdate,
    pollVoteUpsert,
    ideaBlockCreate,
    appendSystemMessage,
  };
}

describe('PollService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('createPoll', () => {
    it('не-член разговора → 403', async () => {
      const { svc } = makeService({ isMember: false });
      await expect(
        svc.createPoll({
          tenantId: 'org-1',
          conversationId: 'conv-1',
          userId: 'u-1',
          question: 'Куда едем?',
          options: ['Сочи', 'Алтай'],
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('меньше 2 вариантов → 400', async () => {
      const { svc, pollCreate } = makeService({ isMember: true });
      await expect(
        svc.createPoll({
          tenantId: 'org-1',
          conversationId: 'conv-1',
          userId: 'u-1',
          question: 'Куда едем?',
          options: ['Сочи'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(pollCreate).not.toHaveBeenCalled();
    });

    it('создаёт Poll + системное сообщение «Опрос: …»', async () => {
      const { svc, pollCreate, appendSystemMessage } = makeService({ isMember: true });
      const res = await svc.createPoll({
        tenantId: 'org-1',
        conversationId: 'conv-1',
        userId: 'u-1',
        question: 'Куда едем?',
        options: ['Сочи', 'Алтай'],
      });
      expect(res.pollId).toBe('poll-1');
      const createArg = pollCreate.mock.calls[0]![0];
      expect(createArg.data.options.create).toHaveLength(2);
      expect(appendSystemMessage).toHaveBeenCalledTimes(1);
      const msgArg = appendSystemMessage.mock.calls[0]![0];
      expect(msgArg.content).toContain('Опрос: Куда едем?');
      expect(msgArg.clientMessageId).toBe('poll-created:poll-1');
    });
  });

  describe('vote', () => {
    it('upsert: один голос на юзера, смена допустима', async () => {
      const { svc, pollVoteUpsert } = makeService({
        isMember: true,
        poll: {
          id: 'poll-1',
          conversationId: 'conv-1',
          status: 'open',
          options: [{ id: 'opt-1' }, { id: 'opt-2' }],
        },
      });
      await svc.vote({ pollId: 'poll-1', userId: 'u-1', optionId: 'opt-2' });
      expect(pollVoteUpsert).toHaveBeenCalledTimes(1);
      const arg = pollVoteUpsert.mock.calls[0]![0];
      expect(arg.where.pollId_userId).toEqual({ pollId: 'poll-1', userId: 'u-1' });
      expect(arg.create.optionId).toBe('opt-2');
      expect(arg.update.optionId).toBe('opt-2');
    });

    it('вариант не из опроса → 400', async () => {
      const { svc, pollVoteUpsert } = makeService({
        isMember: true,
        poll: {
          id: 'poll-1',
          conversationId: 'conv-1',
          status: 'open',
          options: [{ id: 'opt-1' }],
        },
      });
      await expect(
        svc.vote({ pollId: 'poll-1', userId: 'u-1', optionId: 'opt-X' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(pollVoteUpsert).not.toHaveBeenCalled();
    });

    it('закрытый опрос → 400', async () => {
      const { svc } = makeService({
        isMember: true,
        poll: {
          id: 'poll-1',
          conversationId: 'conv-1',
          status: 'closed',
          options: [{ id: 'opt-1' }],
        },
      });
      await expect(
        svc.vote({ pollId: 'poll-1', userId: 'u-1', optionId: 'opt-1' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('closePoll', () => {
    it('закрывает + создаёт IdeaBlock(decision) с decisionBlockId по победителю', async () => {
      const { svc, pollUpdate, ideaBlockCreate, appendSystemMessage } = makeService({
        isMember: true,
        poll: {
          id: 'poll-1',
          tenantId: 'org-1',
          conversationId: 'conv-1',
          question: 'Куда едем?',
          status: 'open',
          decisionBlockId: null,
        },
        options: [
          { id: 'opt-1', text: 'Сочи' },
          { id: 'opt-2', text: 'Алтай' },
        ],
        tally: [
          { optionId: 'opt-1', _count: { optionId: 1 } },
          { optionId: 'opt-2', _count: { optionId: 3 } },
        ],
      });

      const res = await svc.closePoll({ pollId: 'poll-1', userId: 'u-1' });

      expect(ideaBlockCreate).toHaveBeenCalledTimes(1);
      const blockArg = ideaBlockCreate.mock.calls[0]![0];
      expect(blockArg.data.signalType).toBe('decision');
      expect(blockArg.data.tenantId).toBe('org-1');
      expect(blockArg.data.trustedAnswer).toContain('Алтай');

      expect(pollUpdate).toHaveBeenCalledTimes(1);
      const updArg = pollUpdate.mock.calls[0]![0];
      expect(updArg.data.status).toBe('closed');
      expect(updArg.data.decisionBlockId).toBe('block-1');

      expect(res.status).toBe('closed');
      expect(res.decisionBlockId).toBe('block-1');
      expect(res.winningOptionId).toBe('opt-2');

      expect(appendSystemMessage).toHaveBeenCalledTimes(1);
      expect(appendSystemMessage.mock.calls[0]![0].clientMessageId).toBe('poll-closed:poll-1');
    });

    it('уже закрыт → no-op (не создаёт блок повторно)', async () => {
      const { svc, ideaBlockCreate, pollUpdate } = makeService({
        isMember: true,
        poll: {
          id: 'poll-1',
          tenantId: 'org-1',
          conversationId: 'conv-1',
          question: 'Куда едем?',
          status: 'closed',
          decisionBlockId: 'block-old',
        },
      });
      const res = await svc.closePoll({ pollId: 'poll-1', userId: 'u-1' });
      expect(ideaBlockCreate).not.toHaveBeenCalled();
      expect(pollUpdate).not.toHaveBeenCalled();
      expect(res.decisionBlockId).toBe('block-old');
    });
  });

  describe('getPoll', () => {
    it('возвращает вопрос + варианты со счётчиками голосов', async () => {
      const { svc } = makeService({
        poll: {
          id: 'poll-1',
          conversationId: 'conv-1',
          question: 'Куда едем?',
          status: 'open',
          closedAt: null,
          decisionBlockId: null,
          createdByUserId: 'u-1',
          options: [
            { id: 'opt-1', text: 'Сочи', sortOrder: 0, _count: { votes: 1 } },
            { id: 'opt-2', text: 'Алтай', sortOrder: 1, _count: { votes: 3 } },
          ],
          _count: { votes: 4 },
        },
      });
      const view = await svc.getPoll('poll-1');
      expect(view.totalVotes).toBe(4);
      expect(view.options).toHaveLength(2);
      expect(view.options[1]!.voteCount).toBe(3);
    });
  });
});
