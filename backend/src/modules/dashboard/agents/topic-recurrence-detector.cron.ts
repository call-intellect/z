import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * Pulse Wave 6 §6.2 — Topic-Recurrence-Detector cron.
 *
 * Источник: plans/tz/2026-05-30-pulse-full.md §6.2.
 *
 * Weekly (`@Cron('0 5 * * 1')`, понедельник 05:00 UTC). Для каждой Org:
 *   1. Загружает `Theme` с `lastSignalAt > now-90d` (status='active').
 *   2. Для каждой Theme считает упоминания (`ThemeIdeaBlock.block.createdAt`
 *      в окне) и число distinct RawEvent'ов (proxy «в скольких разных встречах
 *      обсуждалось»).
 *   3. Проверяет — есть ли implemented `Decision` (status='approved' или
 *      'implemented'), у которого `sourceBlockIds` пересекается с блоками
 *      темы. Если нет — это «обсуждаем по кругу».
 *   4. Сохраняет `RecurringTopic` для Theme с `mentionCount >= 5` и
 *      `hasImplementedDecision = false`.
 *
 * Без LLM — чистая SQL-агрегация.
 * Best-effort: ошибка по одной Org не валит остальных.
 */
@Injectable()
export class TopicRecurrenceDetectorCron {
  private readonly logger = new Logger(TopicRecurrenceDetectorCron.name);
  private static readonly WINDOW_DAYS = 90;
  private static readonly WINDOW_MS =
    TopicRecurrenceDetectorCron.WINDOW_DAYS * 24 * 3600 * 1000;
  /** Минимум упоминаний, чтобы Theme попал в snapshot. */
  private static readonly MIN_MENTIONS = 5;
  /** Сколько блоков сохранить в blockIdsJson (для drill-down). */
  private static readonly BLOCK_IDS_LIMIT = 50;
  private static readonly MAX_ORGS_PER_RUN = 5_000;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Weekly Mon 05:00 UTC. */
  @Cron('0 5 * * 1')
  async run(): Promise<void> {
    try {
      const stats = await this.runOnce();
      this.logger.debug(stats, 'topic-recurrence-detector.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        `topic-recurrence-detector.cron fail: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async runOnce(): Promise<{
    orgsProcessed: number;
    snapshotsCreated: number;
    errors: number;
  }> {
    const now = new Date();
    const windowStart = new Date(
      now.getTime() - TopicRecurrenceDetectorCron.WINDOW_MS,
    );

    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
      take: TopicRecurrenceDetectorCron.MAX_ORGS_PER_RUN,
    });

    let orgsProcessed = 0;
    let snapshotsCreated = 0;
    let errors = 0;

    for (const org of orgs) {
      orgsProcessed++;
      try {
        snapshotsCreated += await this.processOrg({
          tenantId: org.id,
          windowStart,
          windowEnd: now,
        });
      } catch (err) {
        errors++;
        this.logger.warn(
          `topic-recurrence-detector org ${org.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { orgsProcessed, snapshotsCreated, errors };
  }

  private async processOrg(args: {
    tenantId: string;
    windowStart: Date;
    windowEnd: Date;
  }): Promise<number> {
    const { tenantId, windowStart, windowEnd } = args;

    const themes = await this.prisma.theme.findMany({
      where: {
        tenantId,
        status: 'active',
        lastSignalAt: { gte: windowStart },
      },
      select: { id: true, name: true },
    });
    if (themes.length === 0) return 0;

    let created = 0;
    for (const theme of themes) {
      // Все блоки темы за окно — мы считаем упоминания/встречи только по этим.
      const themeBlocks = await this.prisma.themeIdeaBlock.findMany({
        where: {
          themeId: theme.id,
          block: {
            createdAt: { gte: windowStart, lte: windowEnd },
            tenantId,
          },
        },
        select: {
          blockId: true,
          block: {
            select: {
              id: true,
              evidence: { select: { rawEventId: true }, take: 50 },
            },
          },
        },
      });

      const mentionCount = themeBlocks.length;
      if (mentionCount < TopicRecurrenceDetectorCron.MIN_MENTIONS) continue;

      // meetingCount: уникальные rawEventId через evidence — proxy «обсуждалось
      // в N разных источниках». RawEvent чаще всего соответствует Meeting,
      // но также может быть чат-сообщением — для §6.2 этого достаточно.
      const meetingIds = new Set<string>();
      const blockIds: string[] = [];
      for (const tb of themeBlocks) {
        blockIds.push(tb.blockId);
        for (const ev of tb.block.evidence) {
          meetingIds.add(ev.rawEventId);
        }
      }
      const meetingCount = meetingIds.size;

      // Implemented Decision: status IN ('approved','implemented'),
      // sourceBlockIds пересекается с блоками темы.
      const hasImplementedDecision = await this.hasImplementedDecision({
        tenantId,
        blockIds,
      });
      if (hasImplementedDecision) continue;

      await this.prisma.recurringTopic.create({
        data: {
          tenantId,
          themeId: theme.id,
          themeName: theme.name,
          mentionCount,
          meetingCount,
          hasImplementedDecision,
          blockIdsJson: {
            ids: blockIds.slice(0, TopicRecurrenceDetectorCron.BLOCK_IDS_LIMIT),
          } as unknown as Prisma.InputJsonValue,
          windowStart,
          windowEnd,
        },
      });
      created++;
    }

    return created;
  }

  /**
   * Decision считается implemented если status IN ('approved','implemented')
   * И sourceBlockIds (массив cuid) пересекается хотя бы с одним блоком темы.
   */
  private async hasImplementedDecision(args: {
    tenantId: string;
    blockIds: string[];
  }): Promise<boolean> {
    if (args.blockIds.length === 0) return false;
    const count = await this.prisma.decision.count({
      where: {
        tenantId: args.tenantId,
        status: { in: ['approved', 'implemented'] },
        sourceBlockIds: { hasSome: args.blockIds },
      },
    });
    return count > 0;
  }
}
