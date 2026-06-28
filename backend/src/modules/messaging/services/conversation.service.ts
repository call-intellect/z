import { Inject, Injectable } from '@nestjs/common';
import type { Conversation, ConversationKind } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

interface CreateConversationArgs {
  tenantId: string;
  kind: ConversationKind;
  title?: string | null;
  createdByUserId: string;
  memberUserIds: string[];
  isMandatory?: boolean;
  feedsGraph?: boolean;
}

interface AddMemberArgs {
  conversationId: string;
  userId: string;
  role?: string;
}

@Injectable()
export class ConversationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createConversation(args: CreateConversationArgs): Promise<Conversation> {
    const memberIds = Array.from(new Set([args.createdByUserId, ...args.memberUserIds]));

    return this.prisma.conversation.create({
      data: {
        tenantId: args.tenantId,
        kind: args.kind,
        title: args.title ?? null,
        createdByUserId: args.createdByUserId,
        isMandatory: args.isMandatory ?? false,
        feedsGraph: args.feedsGraph ?? true,
        members: {
          create: memberIds.map((userId) => ({
            userId,
            role: userId === args.createdByUserId ? 'owner' : 'member',
          })),
        },
      },
    });
  }

  async addMember(args: AddMemberArgs): Promise<void> {
    await this.prisma.conversationMember.upsert({
      where: {
        conversationId_userId: {
          conversationId: args.conversationId,
          userId: args.userId,
        },
      },
      create: {
        conversationId: args.conversationId,
        userId: args.userId,
        role: args.role ?? 'member',
      },
      update: args.role ? { role: args.role } : {},
    });
  }

  async assertMember(conversationId: string, userId: string): Promise<boolean> {
    const member = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { id: true },
    });
    return member != null;
  }
}
