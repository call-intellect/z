import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';

import { ConversationService } from './conversation.service';
import { MessageService } from './message.service';

interface CreatePollArgs {
  tenantId: string;
  conversationId: string;
  userId: string;
  question: string;
  options: string[];
}

interface CreatePollResult {
  pollId: string;
}

interface VoteArgs {
  pollId: string;
  userId: string;
  optionId: string;
}

interface ClosePollArgs {
  pollId: string;
  userId: string;
}

interface ClosePollResult {
  pollId: string;
  status: string;
  decisionBlockId: string | null;
  winningOptionId: string | null;
}

interface PollOptionView {
  id: string;
  text: string;
  sortOrder: number;
  voteCount: number;
}

interface PollView {
  id: string;
  conversationId: string;
  question: string;
  status: string;
  closedAt: string | null;
  decisionBlockId: string | null;
  createdByUserId: string;
  totalVotes: number;
  options: PollOptionView[];
}

@Injectable()
export class PollService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConversationService) private readonly conversations: ConversationService,
    @Inject(MessageService) private readonly messages: MessageService,
  ) {}

  async createPoll(args: CreatePollArgs): Promise<CreatePollResult> {
    await this.assertMember(args.conversationId, args.userId);

    const question = args.question.trim();
    if (question.length === 0) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'POLL_QUESTION_EMPTY', message: 'Вопрос опроса не может быть пустым' },
      });
    }

    const options = args.options
      .map((text) => text.trim())
      .filter((text) => text.length > 0);
    if (options.length < 2) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'POLL_OPTIONS_TOO_FEW', message: 'Нужно минимум два варианта ответа' },
      });
    }

    const poll = await this.prisma.poll.create({
      data: {
        tenantId: args.tenantId,
        conversationId: args.conversationId,
        question,
        createdByUserId: args.userId,
        options: {
          create: options.map((text, index) => ({ text, sortOrder: index })),
        },
      },
      select: { id: true },
    });

    await this.messages.appendSystemMessage({
      tenantId: args.tenantId,
      conversationId: args.conversationId,
      authorUserId: args.userId,
      content: `Опрос: ${question}`,
      access: 'normal',
      clientMessageId: `poll-created:${poll.id}`,
    });

    return { pollId: poll.id };
  }

  async vote(args: VoteArgs): Promise<{ ok: true }> {
    const poll = await this.prisma.poll.findUnique({
      where: { id: args.pollId },
      select: {
        id: true,
        conversationId: true,
        status: true,
        options: { select: { id: true } },
      },
    });
    if (!poll) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'POLL_NOT_FOUND', message: 'Опрос не найден' },
      });
    }
    await this.assertMember(poll.conversationId, args.userId);

    if (poll.status !== 'open') {
      throw new BadRequestException({
        ok: false,
        error: { code: 'POLL_CLOSED', message: 'Опрос закрыт' },
      });
    }
    if (!poll.options.some((o) => o.id === args.optionId)) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'POLL_OPTION_NOT_FOUND', message: 'Вариант ответа не найден в опросе' },
      });
    }

    await this.prisma.pollVote.upsert({
      where: { pollId_userId: { pollId: args.pollId, userId: args.userId } },
      create: {
        pollId: args.pollId,
        optionId: args.optionId,
        userId: args.userId,
      },
      update: { optionId: args.optionId },
    });

    return { ok: true };
  }

  async closePoll(args: ClosePollArgs): Promise<ClosePollResult> {
    const poll = await this.prisma.poll.findUnique({
      where: { id: args.pollId },
      select: {
        id: true,
        tenantId: true,
        conversationId: true,
        question: true,
        status: true,
        decisionBlockId: true,
      },
    });
    if (!poll) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'POLL_NOT_FOUND', message: 'Опрос не найден' },
      });
    }
    await this.assertMember(poll.conversationId, args.userId);

    if (poll.status === 'closed') {
      return {
        pollId: poll.id,
        status: poll.status,
        decisionBlockId: poll.decisionBlockId,
        winningOptionId: null,
      };
    }

    const tally = await this.prisma.pollVote.groupBy({
      by: ['optionId'],
      where: { pollId: poll.id },
      _count: { optionId: true },
    });
    const countByOption = new Map(tally.map((t) => [t.optionId, t._count.optionId]));

    const options = await this.prisma.pollOption.findMany({
      where: { pollId: poll.id },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, text: true },
    });

    let winner: { id: string; text: string } | null = null;
    let winnerVotes = -1;
    for (const option of options) {
      const votes = countByOption.get(option.id) ?? 0;
      if (votes > winnerVotes) {
        winnerVotes = votes;
        winner = option;
      }
    }

    const decisionBlockId = winner
      ? await this.createDecisionBlock(poll.tenantId, poll.question, winner.text, winnerVotes)
      : null;

    await this.prisma.poll.update({
      where: { id: poll.id },
      data: {
        status: 'closed',
        closedAt: new Date(),
        decisionBlockId,
      },
    });

    const summaryLine = winner
      ? `Опрос закрыт. Решение: «${winner.text}» (${winnerVotes} голос(ов)).`
      : 'Опрос закрыт без голосов.';
    await this.messages.appendSystemMessage({
      tenantId: poll.tenantId,
      conversationId: poll.conversationId,
      authorUserId: args.userId,
      content: `${summaryLine}\n\nВопрос: ${poll.question}`,
      access: 'normal',
      clientMessageId: `poll-closed:${poll.id}`,
    });

    return {
      pollId: poll.id,
      status: 'closed',
      decisionBlockId,
      winningOptionId: winner?.id ?? null,
    };
  }

  async getPoll(pollId: string): Promise<PollView> {
    const poll = await this.prisma.poll.findUnique({
      where: { id: pollId },
      select: {
        id: true,
        conversationId: true,
        question: true,
        status: true,
        closedAt: true,
        decisionBlockId: true,
        createdByUserId: true,
        options: {
          orderBy: { sortOrder: 'asc' },
          select: { id: true, text: true, sortOrder: true, _count: { select: { votes: true } } },
        },
        _count: { select: { votes: true } },
      },
    });
    if (!poll) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'POLL_NOT_FOUND', message: 'Опрос не найден' },
      });
    }

    return {
      id: poll.id,
      conversationId: poll.conversationId,
      question: poll.question,
      status: poll.status,
      closedAt: poll.closedAt ? poll.closedAt.toISOString() : null,
      decisionBlockId: poll.decisionBlockId,
      createdByUserId: poll.createdByUserId,
      totalVotes: poll._count.votes,
      options: poll.options.map((o) => ({
        id: o.id,
        text: o.text,
        sortOrder: o.sortOrder,
        voteCount: o._count.votes,
      })),
    };
  }

  private async createDecisionBlock(
    tenantId: string,
    question: string,
    winningOption: string,
    votes: number,
  ): Promise<string> {
    const block = await this.prisma.ideaBlock.create({
      data: {
        tenantId,
        externalSource: 'chat-poll',
        name: question.slice(0, 500),
        criticalQuestion: question,
        trustedAnswer: `Решение команды по итогам опроса: ${winningOption} (${votes} голос(ов)).`,
        signalType: 'decision',
        status: 'canonical',
        dataClass: 'internal',
      },
      select: { id: true },
    });
    return block.id;
  }

  private async assertMember(conversationId: string, userId: string): Promise<void> {
    const ok = await this.conversations.assertMember(conversationId, userId);
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'NOT_MEMBER', message: 'Вы не участник этого разговора' },
      });
    }
  }
}
