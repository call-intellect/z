import { Inject, Injectable, Logger } from '@nestjs/common';
import { ulid } from 'ulid';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { LivekitService } from '../../livekit/livekit.service';

import { ActivityRecorderService } from './activity-recorder.service';
import { IssuesService } from './issues.service';

/**
 * IssueMeetingsService — создание Meeting'а, привязанной к задаче трекера.
 *
 * Эндпоинт `POST /api/v1/issues/:id/start-meeting` (см. ТЗ §REST API):
 *   1. Находит задачу + tenant.
 *   2. Создаёт Meeting (ULID id, type='task_discussion', linkedIssueId=issue.id,
 *      ownerId=currentUser.id) + host-Participant в одной транзакции.
 *   3. Идемпотентно создаёт LiveKit room (best-effort).
 *   4. Генерирует host JWT.
 *   5. Пишет IssueActivity verb='meeting_started' с `{ meetingId }`.
 *
 * NOTE: НЕ используем `MeetingsService.createForUser` напрямую, потому что он
 *   - не поддерживает `linkedIssueId` (пришлось бы расширять сигнатуру),
 *   - списывает 1 встречу с MeetingsBalance (для встреч от задач этого не
 *     делаем — это автоматический системный сценарий, ТЗ 2026-05-27 Фаза 3).
 * Изначальная договорённость: «не модифицировать MeetingsService помимо
 * `create()`» → создаём напрямую.
 */
@Injectable()
export class IssueMeetingsService {
  private readonly logger = new Logger(IssueMeetingsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LivekitService) private readonly livekit: LivekitService,
    @Inject(IssuesService) private readonly issues: IssuesService,
    @Inject(ActivityRecorderService)
    private readonly activity: ActivityRecorderService,
  ) {}

  /**
   * Запустить встречу по задаче. Возвращает идентификатор встречи + URL +
   * host-токен LiveKit для немедленного входа.
   *
   * @param issueId          UUID задачи
   * @param tenantId         текущий Org (из X-Org-Id)
   * @param userId           инициатор (host)
   * @param inviteUserIds    опц. список user.id, которых нужно добавить как
   *                         participant'ов с ролью `guest`. Сразу записываем в
   *                         БД; нотификации (если есть) — отдельным каналом.
   */
  async startMeeting(args: {
    issueId: string;
    tenantId: string;
    userId: string;
    inviteUserIds?: string[];
  }): Promise<{ meetingId: string; meetingUrl: string; token: string }> {
    const { issueId, tenantId, userId, inviteUserIds = [] } = args;

    const issue = await this.issues.requireIssue(issueId, tenantId);

    // Достаём User host (для name + Participant.userId).
    const host = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });
    if (!host) {
      // Это уровень InternalError — токен авторизации действителен, а user исчез.
      // CookieAuthGuard это уже отсёк бы, но защищаемся.
      throw new Error('host_user_not_found');
    }

    // Уже валидируем приглашённых: только реальные user'ы того же tenant'а.
    let validInviteIds: string[] = [];
    if (inviteUserIds.length > 0) {
      const memberships = await this.prisma.membership.findMany({
        where: { orgId: tenantId, userId: { in: inviteUserIds } },
        select: { userId: true },
      });
      validInviteIds = memberships.map((m) => m.userId);
      // Тихо отбрасываем чужих — не валим запрос. Логируем для отладки.
      const dropped = inviteUserIds.filter((id) => !validInviteIds.includes(id));
      if (dropped.length > 0) {
        this.logger.warn(
          `start-meeting issue=${issueId}: отброшено ${dropped.length} ` +
            `non-member user.id (${dropped.join(',')})`,
        );
      }
    }

    const meetingId = ulid();
    const titleStub = issue.title.slice(0, 60);
    const meetingTitle = `Встреча по задаче ${issue.identifier}: ${titleStub}`;

    await this.prisma.$transaction(async (tx) => {
      await tx.meeting.create({
        data: {
          id: meetingId,
          title: meetingTitle,
          type: 'task_discussion',
          tenantId,
          ownerId: userId,
          roomName: meetingId,
          status: 'scheduled',
          recordByDefault: true,
          linkedIssueId: issueId,
        },
      });

      // host-Participant.
      await tx.participant.create({
        data: {
          meetingId,
          livekitIdentity: `host:${userId}`,
          name: host.name,
          role: 'host',
          isRegisteredUser: true,
          userId,
        },
      });

      // Приглашённые — guest-Participant'ы. Не падаем при дубликатах.
      if (validInviteIds.length > 0) {
        const invitedUsers = await tx.user.findMany({
          where: { id: { in: validInviteIds } },
          select: { id: true, name: true },
        });
        await tx.participant.createMany({
          data: invitedUsers.map((u) => ({
            meetingId,
            livekitIdentity: `guest:${u.id}`,
            name: u.name,
            role: 'guest' as const,
            isRegisteredUser: true,
            userId: u.id,
          })),
          skipDuplicates: true,
        });
      }

      // IssueActivity verb='meeting_started'.
      await this.activity.record({
        tenantId,
        issueId,
        actorUserId: userId,
        actorType: 'user',
        verb: 'meeting_started',
        newValue: { meetingId },
        metadata: {
          meetingId,
          type: 'task_discussion',
          inviteCount: validInviteIds.length,
        },
        tx,
      });
    });

    // LiveKit room (idempotent, best-effort — если SFU недоступен, auto-create
    // на стороне SFU подхватит при первом подключении).
    await this.livekit.ensureRoom({ id: meetingId });

    // host-токен.
    const token = await this.livekit.generateHostToken(
      { id: meetingId },
      `host:${userId}`,
      host.name,
    );

    // URL — относительный путь, конкретный домен фронт-знает сам.
    // Используем `/m/{meetingId}` — общий public URL встречи (см. positioning).
    const meetingUrl = `/m/${meetingId}`;

    this.logger.log(
      `Issue=${issueId} → создана встреча ${meetingId} (task_discussion), host=${userId}`,
    );
    return { meetingId, meetingUrl, token };
  }
}
