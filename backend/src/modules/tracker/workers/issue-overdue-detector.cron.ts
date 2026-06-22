import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational/conversational.service';
import { TrackerEmitterService } from '../services/tracker-emitter.service';

@Injectable()
export class IssueOverdueDetectorCron {
  private readonly logger = new Logger(IssueOverdueDetectorCron.name);

  static readonly RE_EMIT_DEBOUNCE_MS = 7 * 24 * 3600 * 1000;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TrackerEmitterService)
    private readonly emitter: TrackerEmitterService,
    @Optional()
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService | null = null,
    @Optional()
    @Inject(TypedConfigService)
    private readonly cfg: TypedConfigService | null = null,
  ) {}

  @Cron('0 9 * * *', { timeZone: 'Europe/Moscow' })
  async detectOverdue(): Promise<void> {
    try {
      await this.run();
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'issue-overdue-detector: непойманная ошибка',
      );
    }
  }

  async run(): Promise<{ scanned: number; emitted: number }> {
    const now = new Date();
    const debounceBefore = new Date(now.getTime() - IssueOverdueDetectorCron.RE_EMIT_DEBOUNCE_MS);
    const candidates = await this.prisma.issue.findMany({
      where: {
        deletedAt: null,
        dueDate: { lt: now },
        OR: [{ lastOverdueDetectedAt: null }, { lastOverdueDetectedAt: { lt: debounceBefore } }],
        state: {
          category: { notIn: ['completed', 'cancelled'] },
        },
      },
      take: 5000,
    });
    let emitted = 0;
    for (const issue of candidates) {
      if (!issue.dueDate) continue;
      const daysOverdue = Math.max(
        1,
        Math.floor((now.getTime() - issue.dueDate.getTime()) / (24 * 3600 * 1000)),
      );
      try {
        this.emitter.emitIssueOverdueDetected({ issue, daysOverdue });
        await this.notifyAssignees({ issue, daysOverdue });
        await this.prisma.issue.update({
          where: { id: issue.id },
          data: { lastOverdueDetectedAt: now },
        });
        emitted++;
      } catch (err) {
        this.logger.warn(
          {
            issueId: issue.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'issue-overdue-detector: пропустил задачу — продолжаем',
        );
      }
    }
    this.logger.debug(
      { scanned: candidates.length, emitted },
      'issue-overdue-detector: проход завершён',
    );
    return { scanned: candidates.length, emitted };
  }

  private async notifyAssignees(args: {
    issue: { id: string; tenantId: string; identifier: string; title: string; dueDate: Date | null };
    daysOverdue: number;
  }): Promise<void> {
    if (!this.conversational || !this.cfg?.tracker.overdueNotifyEnabled) return;
    const conversational = this.conversational;
    const { issue, daysOverdue } = args;
    try {
      const assignees = await this.prisma.issueAssignee.findMany({
        where: { issueId: issue.id },
        select: { userId: true },
      });
      for (const assignee of assignees) {
        try {
          await conversational.sendNotification({
            tenantId: issue.tenantId,
            recipientUserId: assignee.userId,
            eventType: 'issue.overdue',
            payload: {
              issueId: issue.id,
              issueIdentifier: issue.identifier,
              issueTitle: issue.title,
              daysOverdue,
              dueDate: issue.dueDate?.toISOString() ?? null,
              actionUrl: `/issues/${issue.id}`,
            },
            dataClass: 'internal',
          });
        } catch (err) {
          this.logger.warn(
            {
              issueId: issue.id,
              userId: assignee.userId,
              err: err instanceof Error ? err.message : String(err),
            },
            'issue-overdue-detector: уведомление исполнителю не отправлено — продолжаем',
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        {
          issueId: issue.id,
          err: err instanceof Error ? err.message : String(err),
        },
        'issue-overdue-detector: не удалось получить исполнителей — пропускаем уведомления',
      );
    }
  }
}
