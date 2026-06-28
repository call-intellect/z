import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { CryptoService } from '../../../common/crypto/crypto.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { IntakeService } from '../../tracker/services/intake.service';

interface MessageToTaskArgs {
  tenantId: string;
  userId: string;
  conversationId: string;
  messageId: string;
  title?: string | null;
}

interface MessageToDecisionArgs {
  tenantId: string;
  userId: string;
  conversationId: string;
  messageId: string;
}

@Injectable()
export class MessageActionsService {
  private readonly logger = new Logger(MessageActionsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(IntakeService) private readonly intake: IntakeService,
  ) {}

  async messageToTask(args: MessageToTaskArgs): Promise<{ issueId: string }> {
    const message = await this.requireMember(args);
    const text = this.crypto.decrypt(message.content).trim();
    const body = text.length > 0 ? text : (message.voiceTranscript ?? '').trim();
    if (body.length === 0) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'MESSAGE_EMPTY', message: 'Пустое сообщение нельзя превратить в задачу' },
      });
    }

    const title = (args.title?.trim() || body).slice(0, 500);

    const intake = await this.intake.create(
      {
        source: 'chat',
        rawContent: body,
        extractedTitle: title.slice(0, 120),
        extractedDescription: body,
        externalSource: 'chat',
        externalId: `msg:${args.messageId}`,
        suggestedAssigneeId: message.authorUserId,
        suggestedLabels: [],
        sourceBlockIds: [],
      },
      args.tenantId,
    );

    return { issueId: intake.id };
  }

  async messageToDecision(args: MessageToDecisionArgs): Promise<{ decisionId: string }> {
    const message = await this.requireMember(args);
    const text = this.crypto.decrypt(message.content).trim();
    const statement = text.length > 0 ? text : (message.voiceTranscript ?? '').trim();
    if (statement.length === 0) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'MESSAGE_EMPTY', message: 'Пустое сообщение нельзя превратить в решение' },
      });
    }

    const author = await this.prisma.person.findFirst({
      where: { tenantId: args.tenantId, userId: message.authorUserId },
      select: { id: true },
    });

    const decision = await this.prisma.decision.create({
      data: {
        tenantId: args.tenantId,
        externalSource: 'chat',
        statement,
        text: statement.slice(0, 1000),
        status: 'proposed',
        dataClass: 'internal',
        decidedByPersonIds: author ? [author.id] : [],
        previewQuote: statement.slice(0, 1000),
        previewSourceRef: {
          sourceType: 'chat',
          sourceExternalId: `msg:${args.messageId}`,
          conversationId: args.conversationId,
          messageId: args.messageId,
        },
      },
      select: { id: true },
    });

    return { decisionId: decision.id };
  }

  private async requireMember(args: {
    tenantId: string;
    userId: string;
    conversationId: string;
    messageId: string;
  }): Promise<{
    id: string;
    content: string;
    voiceTranscript: string | null;
    authorUserId: string;
  }> {
    const member = await this.prisma.conversationMember.findUnique({
      where: {
        conversationId_userId: { conversationId: args.conversationId, userId: args.userId },
      },
      select: { id: true },
    });
    if (!member) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'NOT_MEMBER', message: 'Вы не участник этого разговора' },
      });
    }

    const message = await this.prisma.message.findUnique({
      where: { id: args.messageId },
      select: {
        id: true,
        conversationId: true,
        tenantId: true,
        content: true,
        voiceTranscript: true,
        authorUserId: true,
        deletedAt: true,
      },
    });
    if (!message || message.deletedAt || message.conversationId !== args.conversationId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'MESSAGE_NOT_FOUND', message: 'Сообщение не найдено' },
      });
    }

    return {
      id: message.id,
      content: message.content,
      voiceTranscript: message.voiceTranscript,
      authorUserId: message.authorUserId,
    };
  }
}
