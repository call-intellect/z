import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { OrgInvitation } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { MailService } from '../../mail/mail.service';

@Injectable()
export class OrgInvitationRemindersCron {
  private readonly logger = new Logger(OrgInvitationRemindersCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MailService) private readonly mail: MailService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  @Cron('0 * * * *')
  async sweep(): Promise<void> {
    try {
      await Promise.all([this.sendReminders(), this.notifyDirectors()]);
    } catch (e) {
      this.logger.error(
        { err: e instanceof Error ? e.message : String(e) },
        'OrgInvitationRemindersCron — sweep упал',
      );
    }
  }

  private async sendReminders(): Promise<void> {
    const reminderDays = this.cfg.invites.reminderDays;
    const threshold = new Date(Date.now() - reminderDays * 86_400_000);

    const candidates = await this.prisma.orgInvitation.findMany({
      where: {
        status: 'pending',
        createdAt: { lt: threshold },
        reminderSentAt: null,
        email: { not: null },
      },
      include: {
        org: { select: { name: true } },
        inviter: { select: { name: true } },
      },
      take: 100,
    });

    if (candidates.length === 0) return;

    let sent = 0;
    for (const invite of candidates) {
      const result = await this.sendOneReminder(invite);
      if (result) sent += 1;
    }
    this.logger.debug(
      { found: candidates.length, sent },
      'OrgInvitationRemindersCron — напоминания сотрудникам отправлены',
    );
  }

  private async sendOneReminder(
    invite: OrgInvitation & {
      org: { name: string };
      inviter: { name: string } | null;
    },
  ): Promise<boolean> {
    if (!invite.email) return false;
    if (!invite.linkCode || !invite.magicTokenHash) {
      this.logger.warn(
        { invitationId: invite.id },
        'sendReminders: пропуск legacy-приглашения без linkCode/magicToken',
      );
      await this.prisma.orgInvitation.update({
        where: { id: invite.id },
        data: { reminderSentAt: new Date() },
      });
      return false;
    }

    const displayName: string = invite.email.split('@')[0] ?? 'Сотрудник';
    const daysLeft = Math.max(1, Math.ceil((invite.expiresAt.getTime() - Date.now()) / 86_400_000));
    const magicLinkUrl = this.buildMagicLinkUrlFromInvite(invite);
    const telegramDeepLink = this.buildTelegramDeepLink(invite.linkCode);

    const result = await this.mail.sendInviteReminder({
      to: invite.email,
      name: displayName,
      inviterName: invite.inviter?.name ?? 'Руководитель',
      orgName: invite.org.name,
      daysLeft,
      magicLinkUrl,
      telegramDeepLink,
    });
    await this.prisma.orgInvitation.update({
      where: { id: invite.id },
      data: { reminderSentAt: new Date() },
    });
    if (result.ok) {
      this.metrics.incInviteReminderSent({ day: 7 });
      return true;
    }
    this.logger.warn(
      { email: invite.email, err: result.error },
      'sendReminders: ошибка отправки напоминания',
    );
    return false;
  }

  private async notifyDirectors(): Promise<void> {
    const ttlDays = this.cfg.invites.ttlDays;
    const threshold = new Date(Date.now() - ttlDays * 86_400_000);

    const candidates = await this.prisma.orgInvitation.findMany({
      where: {
        status: 'pending',
        createdAt: { lt: threshold },
        directorNotifiedAt: null,
      },
      include: {
        org: { select: { name: true } },
        inviter: { select: { name: true, email: true } },
      },
      take: 100,
    });

    if (candidates.length === 0) return;

    const teamPageBase = `${this.cfg.auth.publicFrontendUrl.replace(/\/+$/, '')}/team`;
    let notified = 0;
    let expiredMarked = 0;

    for (const invite of candidates) {
      const inviterEmail = invite.inviter?.email;
      if (inviterEmail) {
        const result = await this.mail.sendInviteDirectorTimeout({
          to: inviterEmail,
          directorName: invite.inviter?.name ?? 'Руководитель',
          employeeName: invite.email
            ? (invite.email.split('@')[0] ?? 'Приглашённый сотрудник')
            : 'Приглашённый сотрудник',
          employeeEmail: invite.email,
          orgName: invite.org.name,
          teamPageUrl: teamPageBase,
        });
        if (result.ok) {
          notified += 1;
          this.metrics.incInviteReminderSent({ day: 14 });
        } else {
          this.logger.warn(
            { email: inviterEmail, err: result.error },
            'notifyDirectors: ошибка отправки уведомления',
          );
        }
      }
      await this.prisma.orgInvitation.update({
        where: { id: invite.id },
        data: {
          status: 'expired',
          directorNotifiedAt: new Date(),
        },
      });
      this.metrics.incInviteExpired();
      expiredMarked += 1;
    }

    this.logger.debug(
      { found: candidates.length, notified, expiredMarked },
      'OrgInvitationRemindersCron — директора уведомлены, приглашения помечены expired',
    );
  }

  private buildMagicLinkUrlFromInvite(invite: OrgInvitation): string {
    const base = this.cfg.auth.publicFrontendUrl.replace(/\/+$/, '');
    return `${base}/invitations/${invite.token}`;
  }

  private buildTelegramDeepLink(linkCode: string): string {
    const username = this.cfg.invites.botUsername;
    return `https://t.me/${username}?start=${linkCode}`;
  }
}
