import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ProbeService } from '../../probe/probe.service';
import { HolidayService } from '../../tracker/services/holiday.service';
import { resolveOperationsTenantTop } from '../utils/tenant-top';

@Injectable()
export class Specialist39PromiseKeeperService {
  private readonly logger = new Logger(Specialist39PromiseKeeperService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(ProbeService) private readonly probe: ProbeService,
    @Inject(HolidayService) private readonly holidays: HolidayService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  async findFollowupCandidates(args: { tenantId: string; now: Date }): Promise<
    Array<{
      id: string;
      tenantId: string;
      criticalQuestion: string;
      trustedAnswer: string;
      commitmentDueDate: Date | null;
      commitmentRecipientPersonId: string | null;
      authorUserIds: string[];
    }>
  > {
    const today = new Date(
      Date.UTC(
        args.now.getUTCFullYear(),
        args.now.getUTCMonth(),
        args.now.getUTCDate(),
        0,
        0,
        0,
        0,
      ),
    );

    const blocks = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId: args.tenantId,
        signalType: 'commitment',
        commitmentStatus: 'open',
        commitmentDueDate: { lt: today },
      },
      select: {
        id: true,
        tenantId: true,
        criticalQuestion: true,
        trustedAnswer: true,
        commitmentDueDate: true,
        commitmentRecipientPersonId: true,
      },
      take: 500,
    });

    if (blocks.length === 0) return [];

    const out: Array<{
      id: string;
      tenantId: string;
      criticalQuestion: string;
      trustedAnswer: string;
      commitmentDueDate: Date | null;
      commitmentRecipientPersonId: string | null;
      authorUserIds: string[];
    }> = [];

    for (const block of blocks) {
      const due = block.commitmentDueDate;
      if (!due) continue;
      const dayAfter = new Date(due.getTime());
      dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
      try {
        const nextWorkday = await this.holidays.nextBusinessDay({
          tenantId: block.tenantId,
          date: dayAfter,
        });
        if (nextWorkday.getTime() >= today.getTime()) {
          continue;
        }
      } catch (err) {
        this.logger.debug(
          {
            blockId: block.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'PromiseKeeper: HolidayService.nextBusinessDay упал — считаем срок просрочен',
        );
      }

      const authorUserIds = await this.resolveAuthorUserIds({
        tenantId: block.tenantId,
        blockId: block.id,
      });
      if (authorUserIds.length === 0) {
        continue;
      }
      out.push({ ...block, authorUserIds });
    }
    return out;
  }

  async findEscalationCandidates(args: { tenantId: string; now: Date }): Promise<
    Array<{
      id: string;
      tenantId: string;
      criticalQuestion: string;
      trustedAnswer: string;
      commitmentDueDate: Date | null;
      commitmentAskedAt: Date | null;
      authorUserIds: string[];
    }>
  > {
    const escalationDays = this.cfg.betaOps.commitmentEscalationDays;
    const threshold = new Date(args.now.getTime() - escalationDays * 24 * 3600 * 1000);

    const blocks = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId: args.tenantId,
        signalType: 'commitment',
        commitmentStatus: 'asked',
        commitmentAskedAt: { lt: threshold },
        commitmentEscalatedAt: null,
      },
      select: {
        id: true,
        tenantId: true,
        criticalQuestion: true,
        trustedAnswer: true,
        commitmentDueDate: true,
        commitmentAskedAt: true,
      },
      take: 500,
    });
    if (blocks.length === 0) return [];

    const out: Array<{
      id: string;
      tenantId: string;
      criticalQuestion: string;
      trustedAnswer: string;
      commitmentDueDate: Date | null;
      commitmentAskedAt: Date | null;
      authorUserIds: string[];
    }> = [];
    for (const block of blocks) {
      const authorUserIds = await this.resolveAuthorUserIds({
        tenantId: block.tenantId,
        blockId: block.id,
      });
      out.push({ ...block, authorUserIds });
    }
    return out;
  }

  async sendFollowupForBlock(args: {
    blockId: string;
    tenantId: string;
    authorUserIds: string[];
    questionText: string;
    contextSummary: string;
  }): Promise<{ sent: boolean }> {
    const message = `Привет! ${args.contextSummary}. Получилось закрыть? Если нет — какой блокер?`;
    const result = await this.probe.suggest({
      tenantId: args.tenantId,
      emittedByService: '3-9-promise-keeper',
      reason: 'commitment.followup',
      payload: {
        message,
        suggestedQuestion: args.questionText,
        suggestedActions: ['Сделано', 'Не сделано', 'Продлеваю срок'],
        contextBlockId: args.blockId,
      },
      recipientCandidates: args.authorUserIds,
      priorityHint: 0.6,
    });
    if ('dropped' in result) {
      this.logger.debug(
        { blockId: args.blockId, dropped: result.dropped },
        'PromiseKeeper.sendFollowup: probe dropped',
      );
      return { sent: false };
    }
    try {
      await this.prisma.ideaBlock.update({
        where: { id: args.blockId },
        data: {
          commitmentStatus: 'asked',
          commitmentAskedAt: new Date(),
        },
      });
      this.metrics?.incCommitmentsAsked({
        tenantTop: resolveOperationsTenantTop(args.tenantId),
      });
      return { sent: true };
    } catch (err) {
      this.logger.warn(
        {
          blockId: args.blockId,
          err: err instanceof Error ? err.message : String(err),
        },
        'PromiseKeeper.sendFollowup: update commitmentStatus упал — probe ушёл, но статус не обновлён',
      );
      return { sent: false };
    }
  }

  async sendEscalationForBlock(args: {
    blockId: string;
    tenantId: string;
    authorUserIds: string[];
    questionText: string;
    contextSummary: string;
  }): Promise<{ sent: boolean }> {
    const memberships = await this.prisma.membership.findMany({
      where: {
        orgId: args.tenantId,
        role: { in: ['owner', 'coo'] },
      },
      select: { userId: true },
    });
    const recipientCandidates = memberships
      .map((m) => m.userId)
      .filter((uid) => !args.authorUserIds.includes(uid));
    if (recipientCandidates.length === 0) {
      this.logger.debug(
        { blockId: args.blockId },
        'PromiseKeeper.sendEscalation: нет COO/owner для эскалации',
      );
      return { sent: false };
    }
    const message = `Сотрудник не отвечает на followup по обещанию: «${args.contextSummary}». Молчит ${this.cfg.betaOps.commitmentEscalationDays} дн.`;
    const result = await this.probe.suggest({
      tenantId: args.tenantId,
      emittedByService: '3-9-promise-keeper',
      reason: 'commitment.silence_escalation',
      payload: {
        message,
        suggestedQuestion: args.questionText,
        contextBlockId: args.blockId,
      },
      recipientCandidates,
      priorityHint: 0.7,
    });
    if ('dropped' in result) {
      this.logger.debug(
        { blockId: args.blockId, dropped: result.dropped },
        'PromiseKeeper.sendEscalation: probe dropped',
      );
      return { sent: false };
    }
    try {
      await this.prisma.ideaBlock.update({
        where: { id: args.blockId },
        data: { commitmentEscalatedAt: new Date() },
      });
      this.metrics?.incCommitmentsEscalated({
        tenantTop: resolveOperationsTenantTop(args.tenantId),
      });
      return { sent: true };
    } catch (err) {
      this.logger.warn(
        {
          blockId: args.blockId,
          err: err instanceof Error ? err.message : String(err),
        },
        'PromiseKeeper.sendEscalation: update commitmentEscalatedAt упал — probe ушёл, но флаг не обновлён',
      );
      return { sent: false };
    }
  }

  private async resolveAuthorUserIds(args: {
    tenantId: string;
    blockId: string;
  }): Promise<string[]> {
    const links = await this.prisma.ideaBlockEntity.findMany({
      where: {
        blockId: args.blockId,
        entity: {
          type: 'person',
          tenantId: args.tenantId,
          persons: {
            some: {
              relationship: 'employee',
              deletedAt: null,
              userId: { not: null },
            },
          },
        },
      },
      select: {
        role: true,
        entity: {
          select: {
            persons: {
              where: {
                relationship: 'employee',
                deletedAt: null,
                userId: { not: null },
              },
              select: { userId: true },
            },
          },
        },
      },
    });
    if (links.length === 0) return [];
    const subjects = links.filter((l) => l.role === 'subject');
    const pool = subjects.length > 0 ? subjects : links;
    const userIds = new Set<string>();
    for (const l of pool) {
      for (const p of l.entity?.persons ?? []) {
        if (p.userId) userIds.add(p.userId);
      }
    }
    return Array.from(userIds);
  }
}
