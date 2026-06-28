import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
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
    await this.assertUsersInTenant(args.tenantId, memberIds);

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
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: args.conversationId },
      select: { tenantId: true },
    });
    if (!conversation) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'CONVERSATION_NOT_FOUND', message: 'Разговор не найден' },
      });
    }
    await this.assertUsersInTenant(conversation.tenantId, [args.userId]);
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

  private async assertUsersInTenant(tenantId: string, userIds: string[]): Promise<void> {
    const unique = Array.from(new Set(userIds));
    if (unique.length === 0) return;
    const found = await this.prisma.membership.findMany({
      where: { orgId: tenantId, userId: { in: unique } },
      select: { userId: true },
      distinct: ['userId'],
    });
    if (found.length !== unique.length) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'USER_NOT_IN_TENANT', message: 'Участник не принадлежит организации' },
      });
    }
  }

  async assertMember(conversationId: string, userId: string): Promise<boolean> {
    const member = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { id: true },
    });
    return member != null;
  }

  async getMemberRole(conversationId: string, userId: string): Promise<string | null> {
    const member = await this.prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
      select: { role: true },
    });
    return member?.role ?? null;
  }

  async isMandatory(conversationId: string): Promise<boolean> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { isMandatory: true },
    });
    return conversation?.isMandatory ?? false;
  }

  async removeMember(conversationId: string, userId: string): Promise<void> {
    await this.prisma.conversationMember.deleteMany({
      where: { conversationId, userId },
    });
  }

  async ensureCompanyChannel(tenantId: string, creatorUserId: string): Promise<Conversation> {
    const memberships = await this.prisma.membership.findMany({
      where: { orgId: tenantId, user: { deletedAt: null } },
      select: { userId: true, role: true },
    });
    const userIds = Array.from(new Set([creatorUserId, ...memberships.map((m) => m.userId)]));
    const ownerIds = new Set(
      memberships.filter((m) => m.role === 'owner').map((m) => m.userId),
    );

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.conversation.findFirst({
        where: { tenantId, kind: 'channel', isMandatory: true },
      });

      const channel =
        existing ??
        (await tx.conversation.create({
          data: {
            tenantId,
            kind: 'channel',
            title: 'Вся компания',
            isMandatory: true,
            feedsGraph: true,
            createdByUserId: creatorUserId,
          },
        }));

      for (const userId of userIds) {
        const role = ownerIds.has(userId) || userId === creatorUserId ? 'owner' : 'member';
        await tx.conversationMember.upsert({
          where: { conversationId_userId: { conversationId: channel.id, userId } },
          create: {
            conversationId: channel.id,
            userId,
            role,
            source: 'auto',
          },
          update: {},
        });
      }

      return channel;
    });
  }
}
