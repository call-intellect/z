import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';

import { PrismaService } from '../../../common/prisma/prisma.service';

import { MessageService } from './message.service';

interface AppendMessageArgs {
  issueId: string;
  authorUserId: string;
  content: string;
  contentHtml?: string | null;
  contentStripped?: string | null;
  access?: string;
  authorType?: string;
  parentMessageId?: string | null;
  voice?: { url?: string | null; duration?: number | null; transcript?: string | null } | null;
  mentions?: string[];
  clientMessageId?: string;
}

interface AppendMessageResult {
  messageId: string;
  conversationId: string;
  seq: string;
}

interface LinkedIssue {
  id: string;
  identifier: string;
  title: string;
}

@Injectable()
export class WorkChatService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MessageService) private readonly messages: MessageService,
  ) {}

  async ensureWorkChat(issueId: string): Promise<{ conversationId: string }> {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      select: {
        id: true,
        tenantId: true,
        identifier: true,
        title: true,
        conversationId: true,
        createdById: true,
        assignees: { select: { userId: true } },
        subscribers: { select: { userId: true } },
        mentions: { select: { mentionedUserId: true } },
      },
    });
    if (!issue) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'issue_not_found', message: 'Задача не найдена' },
      });
    }
    if (issue.conversationId) {
      return { conversationId: issue.conversationId };
    }

    const memberIds = Array.from(
      new Set([
        issue.createdById,
        ...issue.assignees.map((a) => a.userId),
        ...issue.subscribers.map((s) => s.userId),
        ...issue.mentions.map((m) => m.mentionedUserId),
      ]),
    );

    try {
      const conversationId = await this.prisma.$transaction(async (tx) => {
        const conversation = await tx.conversation.create({
          data: {
            tenantId: issue.tenantId,
            kind: 'work_chat',
            title: `${issue.identifier} · ${issue.title}`,
            createdByUserId: issue.createdById,
            feedsGraph: true,
            members: {
              create: memberIds.map((userId) => ({
                userId,
                role: userId === issue.createdById ? 'owner' : 'member',
                source: 'auto',
              })),
            },
          },
        });
        await tx.issue.update({
          where: { id: issue.id },
          data: { conversationId: conversation.id },
        });
        return conversation.id;
      });
      return { conversationId };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const raced = await this.prisma.issue.findUnique({
          where: { id: issueId },
          select: { conversationId: true },
        });
        if (raced?.conversationId) {
          return { conversationId: raced.conversationId };
        }
      }
      throw err;
    }
  }

  async appendMessage(args: AppendMessageArgs): Promise<AppendMessageResult> {
    const { conversationId } = await this.ensureWorkChat(args.issueId);
    const issue = await this.prisma.issue.findUnique({
      where: { id: args.issueId },
      select: { tenantId: true },
    });
    if (!issue) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'issue_not_found', message: 'Задача не найдена' },
      });
    }

    const clientMessageId = args.clientMessageId ?? `wc:${nanoid()}`;
    const result = await this.messages.sendMessage({
      tenantId: issue.tenantId,
      conversationId,
      authorUserId: args.authorUserId,
      content: args.content,
      contentHtml: args.contentHtml ?? null,
      contentStripped: args.contentStripped ?? null,
      clientMessageId,
      parentMessageId: args.parentMessageId ?? null,
      access: args.access,
      authorType: args.authorType,
      voice: args.voice ?? null,
      mentions: args.mentions ?? [],
    });

    return {
      messageId: result.message.id,
      conversationId,
      seq: result.message.seq,
    };
  }

  async getLinkedIssue(conversationId: string): Promise<LinkedIssue | null> {
    const issue = await this.prisma.issue.findFirst({
      where: { conversationId },
      select: { id: true, identifier: true, title: true },
    });
    return issue ?? null;
  }
}
