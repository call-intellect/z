import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { MessageReport } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class MessageReportService {
  private readonly logger = new Logger(MessageReportService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async report(args: {
    tenantId: string;
    messageId: string;
    reporterUserId: string;
    reason?: string | null;
  }): Promise<MessageReport> {
    const message = await this.prisma.message.findUnique({
      where: { id: args.messageId },
      select: { id: true, tenantId: true, conversationId: true },
    });
    if (!message || message.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'MESSAGE_NOT_FOUND', message: 'Сообщение не найдено' },
      });
    }

    const member = await this.prisma.conversationMember.findUnique({
      where: {
        conversationId_userId: {
          conversationId: message.conversationId,
          userId: args.reporterUserId,
        },
      },
      select: { id: true },
    });
    if (!member) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'NOT_MEMBER', message: 'Вы не участник этого разговора' },
      });
    }

    const created = await this.prisma.messageReport.create({
      data: {
        tenantId: args.tenantId,
        messageId: message.id,
        conversationId: message.conversationId,
        reporterUserId: args.reporterUserId,
        reason: args.reason ?? null,
      },
    });
    this.logger.log(
      `report: messageId=${message.id} reporter=${args.reporterUserId} conv=${message.conversationId}`,
    );
    return created;
  }
}
