import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Idea } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { ProbeService } from '../../probe/probe.service';

@Injectable()
export class Specialist36ProbeService {
  private readonly logger = new Logger(Specialist36ProbeService.name);

  static readonly SPECIALIST_NAME = '3-6-ideas';
  private static readonly STATUS_UNCLEAR_DAYS = 14;
  private static readonly CRON_BATCH_LIMIT = 50;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProbeService) private readonly probe: ProbeService,
  ) {}

  async emitSupportRequest(idea: Idea): Promise<void> {
    try {
      if (idea.supporterCount > 1) return;
      const memberships = await this.prisma.membership.findMany({
        where: { orgId: idea.tenantId },
        select: { userId: true },
        take: 50,
      });
      const candidates = memberships
        .map((m) => m.userId)
        .filter((id) => id !== idea.createdByUserId);
      if (candidates.length === 0) return;
      await this.probe.suggest({
        tenantId: idea.tenantId,
        emittedByService: Specialist36ProbeService.SPECIALIST_NAME,
        reason: 'idea.support_request',
        payload: {
          message: `Появилась новая идея: «${idea.statement.slice(0, 200)}». Поддержать?`,
          suggestedActions: ['Поддержать', 'Не моё'],
          contextCardId: idea.id,
          contextCardKind: 'idea',
          contextCardTitle: idea.statement.slice(0, 100),
          objectName: idea.statement.slice(0, 80),
          objectKindRu: 'идея',
          actionUrl: `/ideas/${idea.id}`,
          dataClass: idea.dataClass,
        },
        recipientCandidates: candidates,
        priorityHint: 0.3,
        dataClass: idea.dataClass,
      });
    } catch (err) {
      this.logger.warn(
        {
          ideaId: idea.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'specialist-3-6 probe.support_request: ошибка — пропускаю',
      );
    }
  }

  async checkStatusUnclearForOrg(tenantId: string): Promise<number> {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - Specialist36ProbeService.STATUS_UNCLEAR_DAYS);
    const ideas = await this.prisma.idea.findMany({
      where: {
        tenantId,
        status: 'in_discussion',
        firstProposedAt: { lt: cutoff },
        statusChangedAt: null,
      },
      take: Specialist36ProbeService.CRON_BATCH_LIMIT,
    });
    let emitted = 0;
    for (const idea of ideas) {
      try {
        const recipients = await this.findOrgAdminsUserIds(idea.tenantId);
        if (recipients.length === 0) continue;
        const result = await this.probe.suggest({
          tenantId: idea.tenantId,
          emittedByService: Specialist36ProbeService.SPECIALIST_NAME,
          reason: 'idea.status_unclear',
          payload: {
            message: `Идея «${idea.statement.slice(0, 120)}» в обсуждении уже больше ${Specialist36ProbeService.STATUS_UNCLEAR_DAYS} дней — что с ней решили?`,
            suggestedActions: ['Принять', 'Отклонить', 'Отложить'],
            contextCardId: idea.id,
            contextCardKind: 'idea',
            contextCardTitle: idea.statement.slice(0, 100),
            objectName: idea.statement.slice(0, 80),
            objectKindRu: 'идея',
            actionUrl: `/ideas/${idea.id}`,
            dataClass: idea.dataClass,
          },
          recipientCandidates: recipients,
          priorityHint: 0.5,
          dataClass: idea.dataClass,
        });
        if ('ok' in result) emitted += 1;
      } catch (err) {
        this.logger.warn(
          {
            ideaId: idea.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'specialist-3-6 probe.status_unclear: ошибка идеи — пропускаю',
        );
      }
    }
    return emitted;
  }

  private async findOrgAdminsUserIds(tenantId: string): Promise<string[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { orgId: tenantId, role: { in: ['owner', 'admin'] } },
      select: { userId: true },
      take: 20,
    });
    return memberships.map((m) => m.userId);
  }
}
