import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * Pulse Wave 6 §6.7 — Knowledge-Velocity-Tracker cron.
 *
 * Источник: plans/tz/2026-05-30-pulse-full.md §6.7.
 *
 * Weekly (`@Cron('0 5 * * 1')`). Для каждой Org:
 *   1. Загружает `IdeaBlock` с `signalType='knowledge_gap'` за 90 дней.
 *   2. Считает «отвеченным» блок, у которого `trustedAnswer` непустой,
 *      длиннее порога (`MIN_ANSWER_LEN`) и `updatedAt - createdAt > 1 минута`.
 *   3. Median(answerHours) среди resolved.
 *   4. Top responders — Person'ы, упомянутые в IdeaBlockEntity блоков-ответов
 *      (role IN 'subject'|'object'), агрегированные по resolvedCount.
 *
 * Без LLM. Best-effort: ошибка по одной Org не валит остальных.
 *
 * Замечание про источник «когда появился ответ»: в текущей схеме нет
 * отдельной модели `IdeaBlockAnswer`, поэтому используем proxy:
 * `updatedAt > createdAt + 1 минута` при наличии нетривиального
 * `trustedAnswer`. Это даёт верхнюю оценку времени до ответа.
 */
@Injectable()
export class KnowledgeVelocityTrackerCron {
  private readonly logger = new Logger(KnowledgeVelocityTrackerCron.name);
  private static readonly WINDOW_DAYS = 90;
  private static readonly WINDOW_MS =
    KnowledgeVelocityTrackerCron.WINDOW_DAYS * 24 * 3600 * 1000;
  private static readonly RESOLVE_DELAY_MS = 60 * 1000; // 1 минута
  /** Минимальная длина trustedAnswer, чтобы считать блок отвеченным. */
  private static readonly MIN_ANSWER_LEN = 8;
  /** Сколько responders сохранить в snapshot. */
  private static readonly TOP_RESPONDERS = 10;
  private static readonly MAX_ORGS_PER_RUN = 5_000;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Weekly Mon 05:00 UTC. */
  @Cron('0 5 * * 1')
  async run(): Promise<void> {
    try {
      const stats = await this.runOnce();
      this.logger.debug(stats, 'knowledge-velocity-tracker.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        `knowledge-velocity-tracker.cron fail: ${err instanceof Error ? err.message : String(err)}`,
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
      now.getTime() - KnowledgeVelocityTrackerCron.WINDOW_MS,
    );

    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
      take: KnowledgeVelocityTrackerCron.MAX_ORGS_PER_RUN,
    });

    let orgsProcessed = 0;
    let snapshotsCreated = 0;
    let errors = 0;

    for (const org of orgs) {
      orgsProcessed++;
      try {
        const created = await this.processOrg({
          tenantId: org.id,
          windowStart,
          windowEnd: now,
        });
        if (created) snapshotsCreated++;
      } catch (err) {
        errors++;
        this.logger.warn(
          `knowledge-velocity-tracker org ${org.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { orgsProcessed, snapshotsCreated, errors };
  }

  private async processOrg(args: {
    tenantId: string;
    windowStart: Date;
    windowEnd: Date;
  }): Promise<boolean> {
    const { tenantId, windowStart, windowEnd } = args;

    const gaps = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId,
        signalType: 'knowledge_gap',
        createdAt: { gte: windowStart, lt: windowEnd },
      },
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        trustedAnswer: true,
        entities: {
          where: { entity: { type: 'person' } },
          select: {
            role: true,
            entity: {
              select: {
                persons: {
                  where: { deletedAt: null },
                  select: { id: true, name: true },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });
    if (gaps.length === 0) return false;

    const answeredHours: number[] = [];
    let openGapsCount = 0;
    const respondersCount = new Map<
      string,
      { name: string; count: number }
    >();

    for (const g of gaps) {
      if (this.isResolved(g)) {
        const hours =
          (g.updatedAt.getTime() - g.createdAt.getTime()) / 3600 / 1000;
        answeredHours.push(hours);
        // Responders — те, кто связан с блоком (role='subject'|'object'),
        // но не его автор. В нашей схеме автор гэпа = subject, ответчик чаще
        // помечается mentioned/object. Если нет таких связей — пропускаем.
        for (const e of g.entities) {
          const person = e.entity?.persons?.[0];
          if (!person) continue;
          // Учитываем только role !== 'subject' как responder (subject = автор гэпа).
          if (e.role === 'subject') continue;
          const cur = respondersCount.get(person.id);
          if (cur) {
            cur.count++;
          } else {
            respondersCount.set(person.id, { name: person.name, count: 1 });
          }
        }
      } else {
        openGapsCount++;
      }
    }

    const resolvedGapsCount = answeredHours.length;
    const medianHoursToAnswer =
      resolvedGapsCount > 0 ? median(answeredHours) : null;

    const topResponders = [...respondersCount.entries()]
      .map(([personId, v]) => ({
        personId,
        name: v.name,
        resolvedCount: v.count,
      }))
      .sort((a, b) => b.resolvedCount - a.resolvedCount)
      .slice(0, KnowledgeVelocityTrackerCron.TOP_RESPONDERS);

    if (resolvedGapsCount === 0 && openGapsCount === 0) {
      return false;
    }

    await this.prisma.knowledgeVelocitySnapshot.create({
      data: {
        tenantId,
        medianHoursToAnswer:
          medianHoursToAnswer !== null
            ? new Prisma.Decimal(round2(medianHoursToAnswer))
            : null,
        resolvedGapsCount,
        openGapsCount,
        topRespondersJson: {
          responders: topResponders,
        } as unknown as Prisma.InputJsonValue,
        windowStart,
        windowEnd,
      },
    });
    return true;
  }

  private isResolved(g: {
    createdAt: Date;
    updatedAt: Date;
    trustedAnswer: string;
  }): boolean {
    if (!g.trustedAnswer) return false;
    if (g.trustedAnswer.trim().length < KnowledgeVelocityTrackerCron.MIN_ANSWER_LEN) {
      return false;
    }
    return (
      g.updatedAt.getTime() - g.createdAt.getTime() >=
      KnowledgeVelocityTrackerCron.RESOLVE_DELAY_MS
    );
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
