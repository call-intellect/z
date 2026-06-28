import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ulid } from 'ulid';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LivekitService } from '../../livekit/livekit.service';

import { ConversationService } from './conversation.service';
import { MessageService } from './message.service';

interface StartHuddleArgs {
  tenantId: string;
  conversationId: string;
  userId: string;
}

interface StartHuddleResult {
  meetingId: string;
  roomToken: string;
  joinUrl: string;
}

interface JoinHuddleArgs {
  tenantId: string;
  conversationId: string;
  userId: string;
}

interface JoinHuddleResult {
  meetingId: string;
  roomToken: string;
  joinUrl: string;
}

@Injectable()
export class HuddleService {
  private readonly logger = new Logger(HuddleService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(LivekitService) private readonly livekit: LivekitService,
    @Inject(ConversationService) private readonly conversations: ConversationService,
    @Inject(MessageService) private readonly messages: MessageService,
  ) {}

  async startHuddle(args: StartHuddleArgs): Promise<StartHuddleResult> {
    if (!this.cfg.huddles.enabled) {
      throw new ServiceUnavailableException({
        code: 'HUDDLES_DISABLED',
        message: 'Созвоны отключены',
      });
    }
    await this.assertMember(args.conversationId, args.userId);

    const user = await this.prisma.user.findUnique({
      where: { id: args.userId },
      select: { name: true },
    });
    if (!user) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'USER_NOT_FOUND', message: 'Пользователь не найден' },
      });
    }

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: args.conversationId },
      select: { title: true },
    });

    const meetingId = ulid();
    const title = conversation?.title
      ? `Созвон · ${conversation.title}`.slice(0, 300)
      : 'Созвон из чата';

    const meeting = await this.prisma.meeting.create({
      data: {
        id: meetingId,
        roomName: meetingId,
        title,
        type: 'team',
        ownerId: args.userId,
        tenantId: args.tenantId,
        recordByDefault: true,
        status: 'scheduled',
        huddleConversationId: args.conversationId,
        participants: {
          create: {
            livekitIdentity: `host:${args.userId}`,
            name: user.name,
            role: 'host',
            isRegisteredUser: true,
            userId: args.userId,
          },
        },
      },
      select: { id: true, endedAt: true },
    });

    await this.livekit.ensureRoom({ id: meeting.id });
    const roomToken = await this.livekit.generateHostToken(
      { id: meeting.id, endedAt: meeting.endedAt },
      `host:${args.userId}`,
      user.name,
    );

    const joinUrl = this.buildJoinUrl(meeting.id);
    await this.messages.appendSystemMessage({
      tenantId: args.tenantId,
      conversationId: args.conversationId,
      authorUserId: args.userId,
      content: `Начат созвон. Присоединиться: ${joinUrl}`,
      access: 'normal',
      clientMessageId: `huddle-started:${meeting.id}`,
    });

    return { meetingId: meeting.id, roomToken, joinUrl };
  }

  async joinHuddle(args: JoinHuddleArgs): Promise<JoinHuddleResult> {
    if (!this.cfg.huddles.enabled) {
      throw new ServiceUnavailableException({
        code: 'HUDDLES_DISABLED',
        message: 'Созвоны отключены',
      });
    }
    await this.assertMember(args.conversationId, args.userId);

    const meeting = await this.prisma.meeting.findFirst({
      where: {
        huddleConversationId: args.conversationId,
        tenantId: args.tenantId,
        deletedAt: null,
        status: { in: ['scheduled', 'active'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, endedAt: true, ownerId: true },
    });
    if (!meeting) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'HUDDLE_NOT_ACTIVE', message: 'Активный созвон не найден' },
      });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: args.userId },
      select: { name: true },
    });
    if (!user) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'USER_NOT_FOUND', message: 'Пользователь не найден' },
      });
    }

    await this.assertParticipantLimit(meeting.id);

    const isHost = meeting.ownerId === args.userId;
    const identity = isHost ? `host:${args.userId}` : `member:${args.userId}`;
    const roomToken = isHost
      ? await this.livekit.generateHostToken(
          { id: meeting.id, endedAt: meeting.endedAt },
          identity,
          user.name,
        )
      : await this.livekit.generateGuestToken(
          { id: meeting.id, endedAt: meeting.endedAt },
          identity,
          user.name,
        );

    return { meetingId: meeting.id, roomToken, joinUrl: this.buildJoinUrl(meeting.id) };
  }

  private async assertParticipantLimit(meetingId: string): Promise<void> {
    const maxParticipants = await this.cfg.getDynamic<number>(
      'huddle_max_participants',
      undefined,
      10,
    );
    const present = await this.prisma.participant.count({
      where: { meetingId, leftAt: null },
    });
    if (present >= maxParticipants) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'HUDDLE_FULL',
          message: `Достигнут лимит участников созвона (${maxParticipants})`,
        },
      });
    }
  }

  private buildJoinUrl(meetingId: string): string {
    const base = this.cfg.auth.publicFrontendUrl.replace(/\/+$/, '');
    return `${base}/m/${meetingId}`;
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
