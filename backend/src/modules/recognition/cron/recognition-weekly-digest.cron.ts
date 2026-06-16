import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { RecognitionService } from '../services/recognition.service';

/**
 * Wave 2 — RecognitionWeeklyDigestCron.
 *
 * `@Cron('0 9 * * 1')` — каждый понедельник 09:00 UTC. Recognition Agent
 * формирует weekly summary:
 *   - Для каждого user'а с активностью за прошедшую неделю — enqueue
 *     Recognition type='weekly_summary' (через worker → LLM формулирует).
 *   - Для руководителей (owner/admin Membership) — отдельный мини-дайджест
 *     (TODO: на 2026-05-24 — оставляем только заметку. Полная реализация
 *     требует Notification API для руководителя и Slack/email каналов;
 *     это часть γ-фазы).
 *
 * Probe-trigger'ы (см. ТЗ §5):
 *   - low_team_engagement      — у команды thanksReceivedWeek < 3 на N member'ов.
 *     Требует понятия «команда» (Department / Team). Сейчас просто проверяем
 *     по Org-уровню (Membership), генерируем заметку.
 *   - unrecognized_high_contributor — у user'а helpfulComments ≥ 10 + thanksReceived = 0.
 *     Если совпало — emit Recognition + проба руководителю (TODO).
 *
 * NB: «не шли пустых благодарностей» (ТЗ §4): если user не имел значимой
 * активности за неделю — НЕ enqueue weekly_summary. «Значимая активность»:
 *   - thanksReceivedWeek ≥ 1 ИЛИ
 *   - helpfulComments прирос за неделю ≥ 1 (TODO: точное сравнение требует
 *     prevSnapshot — на MVP используем absolute helpfulComments > 0).
 */
@Injectable()
export class RecognitionWeeklyDigestCron {
  private readonly logger = new Logger(RecognitionWeeklyDigestCron.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(RecognitionService)
    private readonly recognition: RecognitionService,
  ) {}

  @Cron('0 9 * * 1')
  async run(): Promise<void> {
    try {
      const startedAt = Date.now();
      const week = this.isoWeek(new Date());

      // 1. Идём по всем active member'ам всех Org'ов.
      const memberships = await this.prisma.membership.findMany({
        select: { userId: true, orgId: true },
        distinct: ['userId', 'orgId'],
      });

      let weeklyEnqueued = 0;
      let unrecognizedFlagged = 0;
      for (const m of memberships) {
        try {
          const snap = await this.prisma.contributionSnapshot.findUnique({
            where: { userId: m.userId },
          });
          if (!snap) continue;
          // Значимая активность? Если нет — НЕ шлём weekly_summary.
          const hasMeaningfulActivity =
            snap.thanksReceivedWeek > 0 ||
            snap.helpfulComments > 0 ||
            snap.ideasInDevelopment > 0;
          if (hasMeaningfulActivity) {
            await this.recognition.enqueueFormulate({
              tenantId: m.orgId,
              type: 'weekly_summary',
              toUserId: m.userId,
              fromUserId: null,
              contextEntityType: null,
              contextEntityId: week,
              visibility: 'private',
              contextPayload: {
                thanksReceivedWeek: snap.thanksReceivedWeek,
                helpfulComments: snap.helpfulComments,
                ideasInDevelopment: snap.ideasInDevelopment,
                probeQuestionsAnswered: snap.probeQuestionsAnswered,
              },
            });
            weeklyEnqueued += 1;
          }
          // unrecognized_high_contributor: helpfulComments ≥ 10, thanksReceived = 0.
          if (snap.helpfulComments >= 10 && snap.thanksReceived === 0) {
            unrecognizedFlagged += 1;
            // TODO(probe-trigger): эмитнуть probe-event 'unrecognized_high_contributor'
            //   через ProbeService.suggest(...) — требует подключения ProbeModule.
            //   На MVP — лог + Recognition с visibility='private' от AI.
            await this.recognition.enqueueFormulate({
              tenantId: m.orgId,
              type: 'thanks_helpfulness',
              toUserId: m.userId,
              fromUserId: null,
              contextEntityType: null,
              contextEntityId: `unrecognized_${week}`,
              visibility: 'private',
              contextPayload: {
                helpfulComments: snap.helpfulComments,
                note: 'unrecognized_high_contributor',
              },
            });
          }
        } catch (err) {
          this.logger.warn(
            {
              userId: m.userId,
              orgId: m.orgId,
              err: err instanceof Error ? err.message : String(err),
            },
            'weekly-digest: ошибка по member — пропускаю',
          );
        }
      }
      // 2. low_team_engagement — TODO: требует Department/Team aggregate.
      //    На β-8 / γ-фазе подключим через `OperationsDashboardService`.
      this.logger.debug(
        `weekly-digest: members=${memberships.length} weeklyEnqueued=${weeklyEnqueued} unrecognized=${unrecognizedFlagged} in ${Date.now() - startedAt}ms`,
      );
    } catch (err) {
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'weekly-digest: глобальная ошибка прохода',
      );
    }
  }

  /** ISO-week label: `YYYY-WXX` для уникальности jobId. */
  private isoWeek(d: Date): string {
    // Простой ISO week (RFC). Достаточно для уникальности jobId.
    const date = new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    );
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }
}
