import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * Agent-chain overhaul Фаза 0a (2026-06-07, plans/tz/2026-06-07-agent-chain-overhaul.md).
 *
 * GraphMaterializationService — наблюдаемость материализации графа знаний:
 * «видно ли, что из конкретной встречи материализовались Decision/Idea/Goal».
 *
 * Связь встреча → материализованные записи строится по цепочке:
 *   RawEvent(sourceType='meeting', sourceExternalId=<meetingId>, tenantId)
 *     → IdeaBlockEvidence(rawEventId, blockId)
 *       → IdeaBlock(id, signalType, status, tenantId)
 *         → Decision/Idea/Goal.sourceBlockIds[] (hasSome blockIds)
 *
 * «Расхождение» (gap) = блоки с signalType (decision/idea) есть, а
 * соответствующая запись (Decision/Idea) не материализовалась (count=0).
 * Это read-only сервис: никаких записей в граф.
 */

/** Результат разбора материализации одной встречи. */
export interface MeetingMaterialization {
  meetingId: string;
  tenantId: string;
  blockCount: number;
  /** signalType → count (по блокам встречи). */
  signalTypeDistribution: Record<string, number>;
  /** status → count (canonical/draft/merged_into/archived). */
  statusDistribution: Record<string, number>;
  materialized: { decisions: number; ideas: number; goals: number };
  /**
   * Расхождения: блоков с сигналом много, а записей 0/мало.
   * Сейчас отслеживаем decision/idea (для них есть прямой signalType).
   */
  gaps: Array<{
    type: 'decision' | 'idea';
    blocksWithSignal: number;
    materialized: number;
  }>;
}

@Injectable()
export class GraphMaterializationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  /**
   * Разбирает материализацию одной встречи: распределение блоков по
   * signalType/status, счётчики Decision/Idea/Goal и расхождения.
   *
   * Если у встречи нет RawEvent (в граф ничего не уходило) — возвращает
   * нулевой результат без лишних запросов.
   */
  async getMeetingMaterialization(
    tenantId: string,
    meetingId: string,
  ): Promise<MeetingMaterialization> {
    const empty: MeetingMaterialization = {
      meetingId,
      tenantId,
      blockCount: 0,
      signalTypeDistribution: {},
      statusDistribution: {},
      materialized: { decisions: 0, ideas: 0, goals: 0 },
      gaps: [],
    };

    // 1. RawEvent'ы встречи.
    const rawEvents = await this.prisma.rawEvent.findMany({
      where: {
        tenantId,
        sourceType: 'meeting',
        sourceExternalId: meetingId,
      },
      select: { id: true },
    });
    if (rawEvents.length === 0) return empty;
    const rawEventIds = rawEvents.map((r) => r.id);

    // 2. Evidence → blockIds (уникальные).
    const evidence = await this.prisma.ideaBlockEvidence.findMany({
      where: { rawEventId: { in: rawEventIds } },
      select: { blockId: true },
    });
    const blockIds = [...new Set(evidence.map((e) => e.blockId))];
    if (blockIds.length === 0) return empty;

    // 3. Блоки → распределения по signalType / status.
    const blocks = await this.prisma.ideaBlock.findMany({
      where: { id: { in: blockIds }, tenantId },
      select: { signalType: true, status: true },
    });
    const signalTypeDistribution: Record<string, number> = {};
    const statusDistribution: Record<string, number> = {};
    for (const b of blocks) {
      const sig = String(b.signalType);
      const st = String(b.status);
      signalTypeDistribution[sig] = (signalTypeDistribution[sig] ?? 0) + 1;
      statusDistribution[st] = (statusDistribution[st] ?? 0) + 1;
    }

    // 4. Материализованные записи: пересечение sourceBlockIds с blockIds.
    const [decisions, ideas, goals] = await Promise.all([
      this.prisma.decision.count({
        where: { tenantId, sourceBlockIds: { hasSome: blockIds } },
      }),
      this.prisma.idea.count({
        where: { tenantId, sourceBlockIds: { hasSome: blockIds } },
      }),
      this.prisma.goal.count({
        where: { tenantId, sourceBlockIds: { hasSome: blockIds } },
      }),
    ]);

    // 5. Расхождения: сигнал есть, записи нет.
    const gaps: MeetingMaterialization['gaps'] = [];
    const decisionBlocks = signalTypeDistribution['decision'] ?? 0;
    if (decisionBlocks > 0 && decisions === 0) {
      gaps.push({
        type: 'decision',
        blocksWithSignal: decisionBlocks,
        materialized: decisions,
      });
    }
    const ideaBlocks = signalTypeDistribution['idea'] ?? 0;
    if (ideaBlocks > 0 && ideas === 0) {
      gaps.push({
        type: 'idea',
        blocksWithSignal: ideaBlocks,
        materialized: ideas,
      });
    }

    return {
      meetingId,
      tenantId,
      blockCount: blocks.length,
      signalTypeDistribution,
      statusDistribution,
      materialized: { decisions, ideas, goals },
      gaps,
    };
  }
}
