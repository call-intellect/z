import { createHash, randomBytes } from 'node:crypto';

import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { ConversationAccessLink } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';

const TTL_HOURS_KEY = 'external_link_ttl_hours';
const TTL_HOURS_DEFAULT = 168;

interface CreateLinkArgs {
  conversationId: string;
  createdByUserId: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  ttlHours?: number;
}

interface CreateLinkResult {
  id: string;
  rawToken: string;
  url: string;
}

interface VerifyTokenResult {
  accessLink: ConversationAccessLink;
  conversationId: string;
}

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

@Injectable()
export class AccessLinkService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async createLink(args: CreateLinkArgs): Promise<CreateLinkResult> {
    const ttlHours =
      args.ttlHours ??
      (await this.cfg.getDynamic<number>(TTL_HOURS_KEY, undefined, TTL_HOURS_DEFAULT));
    const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawToken);

    const created = await this.prisma.conversationAccessLink.create({
      data: {
        tokenHash,
        conversationId: args.conversationId,
        contactEmail: args.contactEmail ?? null,
        contactPhone: args.contactPhone ?? null,
        createdByUserId: args.createdByUserId,
        expiresAt,
      },
      select: { id: true },
    });

    return { id: created.id, rawToken, url: this.buildUrl(rawToken) };
  }

  async verifyToken(rawToken: string): Promise<VerifyTokenResult> {
    const tokenHash = hashToken(rawToken);
    const accessLink = await this.prisma.conversationAccessLink.findUnique({
      where: { tokenHash },
    });
    if (!accessLink) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'ACCESS_LINK_INVALID', message: 'Ссылка доступа недействительна' },
      });
    }
    if (accessLink.revokedAt) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'ACCESS_LINK_REVOKED', message: 'Ссылка доступа отозвана' },
      });
    }
    if (accessLink.expiresAt && accessLink.expiresAt.getTime() < Date.now()) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'ACCESS_LINK_EXPIRED', message: 'Срок действия ссылки истёк' },
      });
    }
    return { accessLink, conversationId: accessLink.conversationId };
  }

  async revokeLink(id: string): Promise<void> {
    await this.prisma.conversationAccessLink.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  async revokeLinksForConversation(conversationId: string): Promise<number> {
    const result = await this.prisma.conversationAccessLink.updateMany({
      where: { conversationId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  async claimLink(id: string, userId: string): Promise<void> {
    await this.prisma.conversationAccessLink.update({
      where: { id },
      data: { claimedByUserId: userId },
    });
  }

  private buildUrl(rawToken: string): string {
    return `${this.cfg.publicHostUrl}/c/${rawToken}`;
  }
}
