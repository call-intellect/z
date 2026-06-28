import { randomBytes, randomInt } from 'node:crypto';

import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { MailService } from '../../mail/mail.service';
import { ConversationService } from '../services/conversation.service';
import { MessageService } from '../services/message.service';

import { AccessLinkService } from './access-link.service';

const REGISTER_CODE_TTL_SECONDS = 600;
const INBOUND_RATE_LIMIT_KEY = 'external_inbound_rate_limit';
const INBOUND_RATE_LIMIT_DEFAULT = 30;

interface ClientContact {
  email?: string | null;
  phone?: string | null;
}

interface StartExternalConversationArgs {
  tenantId: string;
  createdByUserId: string;
  clientContact: ClientContact;
  title?: string | null;
  message?: string | null;
}

interface StartExternalConversationResult {
  conversationId: string;
  inviteLink: string;
}

interface EnsureShadowClientUserArgs {
  contactEmail?: string | null;
  contactPhone?: string | null;
  name?: string | null;
}

@Injectable()
export class ExternalConversationService {
  private readonly logger = new Logger(ExternalConversationService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(MessageService) private readonly messages: MessageService,
    @Inject(AccessLinkService) private readonly accessLinks: AccessLinkService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(ConversationService) private readonly conversations: ConversationService,
  ) {}

  async startExternalConversation(
    args: StartExternalConversationArgs,
  ): Promise<StartExternalConversationResult> {
    if (!this.cfg.externalChat.enabled) {
      throw new ServiceUnavailableException({
        ok: false,
        error: {
          code: 'EXTERNAL_CHAT_DISABLED',
          message: 'Внешний чат с клиентами временно недоступен',
        },
      });
    }

    const contactEmail = this.normalize(args.clientContact.email);
    const contactPhone = this.normalize(args.clientContact.phone);
    if (!contactEmail && !contactPhone) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'EXTERNAL_CONTACT_REQUIRED',
          message: 'Нужен email или телефон клиента',
        },
      });
    }

    const conversation = await this.prisma.conversation.create({
      data: {
        tenantId: args.tenantId,
        kind: 'external',
        title: args.title ?? null,
        createdByUserId: args.createdByUserId,
        feedsGraph: true,
        members: {
          create: [{ userId: args.createdByUserId, role: 'owner' }],
        },
      },
      select: { id: true },
    });

    if (args.message && args.message.trim().length > 0) {
      await this.messages.appendTicketMessage({
        tenantId: args.tenantId,
        conversationId: conversation.id,
        authorUserId: args.createdByUserId,
        content: args.message,
        access: 'external',
        authorType: 'human',
      });
    }

    const accessLink = await this.accessLinks.createLink({
      conversationId: conversation.id,
      createdByUserId: args.createdByUserId,
      contactEmail,
      contactPhone,
    });

    await this.sendInvite({ contactEmail, contactPhone, url: accessLink.url });

    return { conversationId: conversation.id, inviteLink: accessLink.url };
  }

  async ensureShadowClientUser(args: EnsureShadowClientUserArgs): Promise<{ userId: string }> {
    const email = this.normalize(args.contactEmail);
    if (email) {
      const existing = await this.prisma.user.findFirst({
        where: { email, kind: 'external_client' },
        select: { id: true },
      });
      if (existing) return { userId: existing.id };
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      const placeholderEmail = email ?? `noemail-${randomBytes(16).toString('hex')}@kora.local`;
      try {
        const created = await this.prisma.user.create({
          data: {
            email: placeholderEmail,
            name: args.name ?? 'Клиент',
            phone: this.normalize(args.contactPhone),
            kind: 'external_client',
            verified: false,
          },
          select: { id: true },
        });
        return { userId: created.id };
      } catch (err) {
        const code = err instanceof Error ? (err as Error & { code?: string }).code : undefined;
        if (code === 'P2002' && !email && attempt < 2) {
          continue;
        }
        if (code === 'P2002' && email) {
          const raced = await this.prisma.user.findFirst({
            where: { email, kind: 'external_client' },
            select: { id: true },
          });
          if (raced) return { userId: raced.id };
        }
        throw err;
      }
    }
    throw new Error('ensureShadowClientUser: исчерпаны попытки создания теневого аккаунта');
  }

  async addClientMember(conversationId: string, userId: string): Promise<void> {
    await this.prisma.conversationMember.upsert({
      where: { conversationId_userId: { conversationId, userId } },
      create: { conversationId, userId, role: 'client' },
      update: {},
    });
  }

  async getConversationTenantId(conversationId: string): Promise<string> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { tenantId: true },
    });
    if (!conversation) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'CONVERSATION_NOT_FOUND', message: 'Разговор не найден' },
      });
    }
    return conversation.tenantId;
  }

  async assertInboundRateLimit(args: {
    conversationId: string;
    userId: string;
  }): Promise<void> {
    const limit = await this.cfg.getDynamic<number>(
      INBOUND_RATE_LIMIT_KEY,
      undefined,
      INBOUND_RATE_LIMIT_DEFAULT,
    );
    const key = `extrate:${args.conversationId}:${args.userId}`;
    const count = await this.redis.client.incr(key);
    if (count === 1) {
      await this.redis.client.expire(key, 60 * 60);
    }
    if (count > limit) {
      throw new HttpException(
        {
          ok: false,
          error: {
            code: 'EXTERNAL_RATE_LIMITED',
            message: 'Слишком много сообщений, попробуйте позже',
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async requestRegisterCode(args: {
    accessLinkId: string;
    email?: string | null;
    phone?: string | null;
  }): Promise<void> {
    const email = this.normalize(args.email);
    const phone = this.normalize(args.phone);
    const contact = email ?? phone;
    if (!contact) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'EXTERNAL_CONTACT_REQUIRED', message: 'Нужен email или телефон' },
      });
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const key = this.registerCodeKey(args.accessLinkId, contact);
    await this.redis.client.set(key, code, 'EX', REGISTER_CODE_TTL_SECONDS);

    if (email) {
      const text = [
        'Здравствуйте!',
        '',
        `Ваш код для подтверждения переписки в Коре: ${code}`,
        '',
        'Код действует 10 минут.',
        '',
        '—',
        'Кора — память компании.',
      ].join('\n');
      try {
        await this.mail.sendPlain({
          to: email,
          subject: 'Кора — код подтверждения',
          text,
          template: 'external-chat-register-code',
        });
      } catch (err) {
        this.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'requestRegisterCode: отправка кода email упала — код сохранён в Redis',
        );
      }
      return;
    }

    this.logger.warn(
      { contactPhone: phone },
      'requestRegisterCode: доставка кода по телефону не реализована (заглушка) — передать вручную',
    );
  }

  async register(args: {
    accessLinkId: string;
    userId: string;
    email?: string | null;
    phone?: string | null;
    code: string;
  }): Promise<void> {
    const email = this.normalize(args.email);
    const phone = this.normalize(args.phone);
    const contact = email ?? phone;
    if (!contact) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'EXTERNAL_CONTACT_REQUIRED', message: 'Нужен email или телефон' },
      });
    }

    const key = this.registerCodeKey(args.accessLinkId, contact);
    const stored = await this.redis.client.getdel(key);
    if (!stored || stored !== args.code) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'EXTERNAL_CODE_INVALID', message: 'Неверный или истёкший код' },
      });
    }

    const emailFree =
      email == null
        ? true
        : (await this.prisma.user.findFirst({
            where: { email, id: { not: args.userId } },
            select: { id: true },
          })) == null;

    await this.prisma.user.update({
      where: { id: args.userId },
      data: {
        verified: true,
        consentDataProcessing: true,
        consentAcceptedAt: new Date(),
        ...(email && emailFree ? { email } : {}),
        ...(phone ? { phone } : {}),
      },
    });

    if (email && !emailFree) {
      this.logger.warn(
        { userId: args.userId },
        'register: email уже занят другим аккаунтом — не перетираю, помечаю verified без смены email',
      );
    }
  }

  async reportConversation(args: { conversationId: string; userId: string }): Promise<void> {
    const key = `extabuse:report:${args.conversationId}`;
    await this.redis.client.incr(key);
    this.logger.warn(
      { conversationId: args.conversationId, userId: args.userId },
      'reportConversation: клиент пожаловался на переписку',
    );
  }

  async blockConversation(args: { conversationId: string; tenantId: string }): Promise<void> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: args.conversationId, tenantId: args.tenantId, kind: 'external' },
      select: { id: true },
    });
    if (!conversation) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'CONVERSATION_NOT_FOUND', message: 'Разговор не найден' },
      });
    }

    await this.accessLinks.revokeLinksForConversation(args.conversationId);

    const clientMembers = await this.prisma.conversationMember.findMany({
      where: { conversationId: args.conversationId, role: 'client' },
      select: { userId: true },
    });
    for (const member of clientMembers) {
      await this.conversations.removeMember(args.conversationId, member.userId);
    }
  }

  private registerCodeKey(accessLinkId: string, contact: string): string {
    return `extreg:${accessLinkId}:${contact}`;
  }

  private async sendInvite(args: {
    contactEmail: string | null;
    contactPhone: string | null;
    url: string;
  }): Promise<void> {
    if (args.contactEmail) {
      const text = [
        'Здравствуйте!',
        '',
        'С вами хотят связаться через Кору. Чтобы открыть переписку, перейдите по ссылке ниже.',
        '',
        args.url,
        '',
        '—',
        'Кора — память компании.',
      ].join('\n');
      try {
        await this.mail.sendPlain({
          to: args.contactEmail,
          subject: 'Кора — приглашение в переписку',
          text,
          template: 'external-chat-invite',
        });
      } catch (err) {
        this.logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'sendInvite: отправка email-приглашения упала — ссылка создана, продолжаю',
        );
      }
      return;
    }

    this.logger.warn(
      { contactPhone: args.contactPhone },
      'sendInvite: доставка приглашения по телефону не реализована (Ф3.5b) — ссылка создана, передать вручную',
    );
  }

  private normalize(value?: string | null): string | null {
    if (!value) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
}
