import { BadRequestException, Inject, Injectable } from '@nestjs/common';
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

@Injectable()
export class MeetingVisibilityService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(KnowledgeAccessResolver) private readonly resolver: KnowledgeAccessResolver,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async resolveContext(tenantId: string, userId: string): Promise<MeetingVisibilityCtx> {
    return this.resolver.resolveDirectGroupIds({ tenantId, userId });
  }

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

  buildListWhere(
    ctx: MeetingVisibilityCtx,
    tenantId: string,
    userId: string,
  ): Prisma.MeetingWhereInput {
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

  async getVisibility(meeting: {
    id: string;
    tenantId: string;
    visibilityScope: string;
  }): Promise<{
    scope: string;
    grants: { granteeType: string; granteeId: string; name: string }[];
  }> {
    const grants = await this.prisma.meetingAccessGrant.findMany({
      where: { meetingId: meeting.id },
      select: { granteeType: true, granteeId: true },
    });
    const personIds = grants.filter((g) => g.granteeType === 'person').map((g) => g.granteeId);
    const groupIds = grants.filter((g) => g.granteeType === 'group').map((g) => g.granteeId);
    const [persons, groups] = await Promise.all([
      personIds.length
        ? this.prisma.person.findMany({
            where: { id: { in: personIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as { id: string; name: string }[]),
      groupIds.length
        ? this.prisma.knowledgeGroup.findMany({
            where: { id: { in: groupIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as { id: string; name: string }[]),
    ]);
    const pName = new Map(persons.map((p) => [p.id, p.name]));
    const gName = new Map(groups.map((g) => [g.id, g.name]));
    return {
      scope: meeting.visibilityScope,
      grants: grants.map((g) => ({
        granteeType: g.granteeType,
        granteeId: g.granteeId,
        name:
          g.granteeType === 'person'
            ? (pName.get(g.granteeId) ?? '—')
            : (gName.get(g.granteeId) ?? '—'),
      })),
    };
  }

  async setVisibility(
    meeting: { id: string; tenantId: string },
    userId: string,
    dto: {
      scope: 'owner_only' | 'participants' | 'custom' | 'org';
      grants?: { granteeType: 'person' | 'group'; granteeId: string }[];
    },
  ): Promise<void> {
    let grants: { granteeType: 'person' | 'group'; granteeId: string }[] = [];
    if (dto.scope === 'custom') {
      if (!dto.grants || dto.grants.length === 0) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'grants_required_for_custom',
            message: 'Для режима «Выбрать людей и группы» укажите хотя бы одного получателя',
          },
        });
      }
      const seen = new Set<string>();
      grants = dto.grants.filter((g) => {
        const k = `${g.granteeType}:${g.granteeId}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      const personIds = grants.filter((g) => g.granteeType === 'person').map((g) => g.granteeId);
      const groupIds = grants.filter((g) => g.granteeType === 'group').map((g) => g.granteeId);
      const [vp, vg] = await Promise.all([
        personIds.length
          ? this.prisma.person.findMany({
              where: { tenantId: meeting.tenantId, id: { in: personIds }, deletedAt: null },
              select: { id: true },
            })
          : Promise.resolve([] as { id: string }[]),
        groupIds.length
          ? this.prisma.knowledgeGroup.findMany({
              where: { tenantId: meeting.tenantId, id: { in: groupIds } },
              select: { id: true },
            })
          : Promise.resolve([] as { id: string }[]),
      ]);
      const vps = new Set(vp.map((p) => p.id));
      const vgs = new Set(vg.map((g) => g.id));
      for (const g of grants) {
        const ok = g.granteeType === 'person' ? vps.has(g.granteeId) : vgs.has(g.granteeId);
        if (!ok) {
          throw new BadRequestException({
            ok: false,
            error: { code: 'invalid_grantee', message: 'Получатель не найден в этой компании' },
          });
        }
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.meeting.update({ where: { id: meeting.id }, data: { visibilityScope: dto.scope } });
      await tx.meetingAccessGrant.deleteMany({ where: { meetingId: meeting.id } });
      if (dto.scope === 'custom' && grants.length) {
        await tx.meetingAccessGrant.createMany({
          data: grants.map((g) => ({
            tenantId: meeting.tenantId,
            meetingId: meeting.id,
            granteeType: g.granteeType,
            granteeId: g.granteeId,
            grantedById: userId,
          })),
          skipDuplicates: true,
        });
      }
    });
  }
}
