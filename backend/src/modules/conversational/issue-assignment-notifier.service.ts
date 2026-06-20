import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { TypedConfigService } from '../../common/config/typed-config.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  TrackerEmitterService,
  type TrackerEventPayload,
} from '../tracker/services/tracker-emitter.service';

import { ConversationalService } from './conversational.service';

@Injectable()
export class IssueAssignmentNotifierService {
  private readonly logger = new Logger(IssueAssignmentNotifierService.name);

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConversationalService) private readonly conversational: ConversationalService,
  ) {}

  @OnEvent(TrackerEmitterService.EVENT_NAME, { async: true })
  async onTrackerEvent(payload: TrackerEventPayload): Promise<void> {
    if (payload.type !== 'issue.assignee_changed') return;
    if (payload.meta?.action !== 'added') return;
    if (!this.assignmentNotificationsEnabled()) return;

    const assigneeUserId = String(payload.meta?.assigneeUserId ?? '');
    const actorUserId = payload.actor.userId;
    if (!assigneeUserId || !actorUserId || assigneeUserId === actorUserId) return;

    try {
      const byName = await this.resolveUserName(actorUserId);
      const dueDate = payload.issue.dueDate ? payload.issue.dueDate.slice(0, 10) : null;
      await this.conversational.sendNotification({
        tenantId: payload.tenantId,
        recipientUserId: assigneeUserId,
        eventType: 'issue.assigned',
        payload: {
          issueId: payload.issue.id,
          issueIdentifier: payload.issue.identifier,
          issueTitle: payload.issue.title,
          byUserId: actorUserId,
          byName,
          dueDate,
          actionUrl: `/issues/${payload.issue.id}`,
        },
        dataClass: 'internal',
      });
    } catch (err) {
      this.logger.warn(
        {
          issueId: payload.issue.id,
          assigneeUserId,
          err: err instanceof Error ? err.message : String(err),
        },
        'issue-assignment-notifier: уведомление не отправлено (fire-and-forget)',
      );
    }
  }

  private assignmentNotificationsEnabled(): boolean {
    try {
      return this.cfg.tracker.assignmentNotificationsEnabled !== false;
    } catch {
      return true;
    }
  }

  private async resolveUserName(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    return user?.name ?? '';
  }
}
