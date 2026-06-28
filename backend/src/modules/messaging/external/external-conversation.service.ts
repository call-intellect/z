import { randomBytes } from 'node:crypto';

import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { MailService } from '../../mail/mail.service';
import { MessageService } from '../services/message.service';

import { AccessLinkService } from './access-link.service';

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
