import { Inject, Injectable } from '@nestjs/common';
import type { Meeting } from '@prisma/client';
import type { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../common/config/index';
import { MeetingNotFoundError, NotAuthorizedError } from '../../common/errors/domain-errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { KnowledgeAccessResolver } from '../rbac/knowledge-access-resolver.service';

export interface MeetingVisibilityCtx {
  personId: string | null;
  isBypass: boolean;
  groupIds: string[];
}

/**
 * ТЗ 2026-06-10 meeting-visibility — предикат «Кому видно» для READ-поверхностей
 * встречи. ОТДЕЛЬНАЯ подсистема: НЕ пересекается с knowledge-access (граф знаний).
 */
@Injectable()
export class MeetingVisibilityService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeAccessResolver) private readonly resolver: KnowledgeAccessResolver,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  /** Резолв контекста доступа пользователя (прямые группы + bypass + personId). */
  async resolveContext(tenantId: string, userId: string): Promise<MeetingVisibilityCtx> {
    return this.resolver.resolveDirectGroupIds({ tenantId, userId });
  }

  /** Чистый предикат видимости (kill-switch → legacy owner-only). */
  canView(args: {
    meeting: {
      ownerId: string;
      visibilityScope: string;
      accessGrants: { granteeType: string; granteeId: string }[];
    };
    userId: string;
    ctx: MeetingVisibilityCtx;
    isParticipant: boolean;
  }): boolean {
    const { meeting, userId, ctx, isParticipant } = args;
    if (!this.cfg.meetingVisibilityEnabled) return meeting.ownerId === userId;
    if (ctx.isBypass) return true;
    if (meeting.ownerId === userId) return true;
    if (meeting.visibilityScope === 'org') return true;
    if (
      (meeting.visibilityScope === 'participants' || meeting.visibilityScope === 'custom') &&
      isParticipant
    ) {
      return true;
    }
    if (meeting.visibilityScope === 'custom') {
      const groupSet = new Set(ctx.groupIds);
      return meeting.accessGrants.some(
        (g) =>
          (g.granteeType === 'person' && ctx.personId !== null && g.granteeId === ctx.personId) ||
          (g.granteeType === 'group' && groupSet.has(g.granteeId)),
      );
    }
    return false;
  }

  /**
   * Загружает встречу (+ гранты), резолвит ctx, проверяет canView.
   * throws NotAuthorizedError('meeting_not_visible') / MeetingNotFoundError.
   * Возвращает саму встречу (для дальнейшего использования вызывающим).
   */
  async assertCanView(meetingId: string, userId: string): Promise<Meeting> {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id: meetingId },
      include: { accessGrants: { select: { granteeType: true, granteeId: true } } },
    });
    if (!meeting || meeting.deletedAt) throw new MeetingNotFoundError(meetingId);

    if (!this.cfg.meetingVisibilityEnabled) {
      if (meeting.ownerId !== userId) throw new NotAuthorizedError('meeting_not_visible');
      return meeting;
    }

    const ctx = await this.resolver.resolveDirectGroupIds({ tenantId: meeting.tenantId, userId });
    let isParticipant = false;
    if (
      !ctx.isBypass &&
      meeting.ownerId !== userId &&
      (meeting.visibilityScope === 'participants' || meeting.visibilityScope === 'custom')
    ) {
      const p = await this.prisma.participant.findFirst({
        where: { meetingId, userId },
        select: { id: true },
      });
      isParticipant = !!p;
    }

    const visible = this.canView({ meeting, userId, ctx, isParticipant });
    if (!visible) throw new NotAuthorizedError('meeting_not_visible');
    return meeting;
  }

  /** Where-фрагмент списка встреч (видимые пользователю). kill-switch → legacy owner-only. */
  buildListWhere(ctx: MeetingVisibilityCtx, tenantId: string, userId: string): Prisma.MeetingWhereInput {
    if (!this.cfg.meetingVisibilityEnabled) return { ownerId: userId };
    if (ctx.isBypass) return { tenantId };
    return {
      tenantId,
      OR: [
        { ownerId: userId },
        { visibilityScope: 'org' },
        {
          visibilityScope: { in: ['participants', 'custom'] },
          participants: { some: { userId } },
        },
        {
          visibilityScope: 'custom',
          accessGrants: {
            some: {
              OR: [
                { granteeType: 'person', granteeId: ctx.personId ?? '__none__' },
                {
                  granteeType: 'group',
                  granteeId: { in: ctx.groupIds.length ? ctx.groupIds : ['__none__'] },
                },
              ],
            },
          },
        },
      ],
    };
  }
}
