import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DataClass, SignalType } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * Минимальное представление IdeaBlock + evidence, нужное v2-агентам Фазы 5
 * (Tasks-2.0/Chapters-2.0/Summary-2.0). Плоская структура без relations
 * Prisma — извлекается одним findMany + одним findMany по evidence.
 *
 * `dataClass` (Фаза 11) — нужен для LlmRouter dataClass-routing'а:
 * v2-агенты считают max по входным блокам и передают в `LlmCallParams.dataClass`.
 */
export interface MeetingBlock {
  id: string;
  name: string;
  criticalQuestion: string;
  trustedAnswer: string;
  signalType: SignalType;
  tags: string[];
  dataClass: DataClass;
  evidence: MeetingBlockEvidence[];
}

export interface MeetingBlockEvidence {
  id: string;
  startMs: number | null;
  endMs: number | null;
  quote: string;
  sourceTimestamp: Date | null;
}

/**
 * BlockFetchService — общий хелпер для v2-агентов Фазы 5. Достаёт
 * canonical-IdeaBlock'и встречи через цепочку
 * `RawEvent (sourceType='meeting', sourceExternalId=meetingId)`
 *  → `IdeaBlockEvidence.rawEventId`
 *  → `IdeaBlock.id` (status='canonical', tenantId match).
 *
 * Сортирует блоки по min `evidence.startMs` (хронология встречи).
 * Без LLM-вызовов — чистый Prisma.
 */
@Injectable()
export class BlockFetchService {
  private readonly logger = new Logger(BlockFetchService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Возвращает canonical-блоки встречи в хронологическом порядке.
   * Если встреча не имеет RawEvent (legacy до Фазы 1) или ни одного блока —
   * возвращает пустой массив.
   *
   * Соответствует контрактам meeting-analyze-v2.worker:
   *   - tenantId передаётся отдельно (worker уже его проверил),
   *     метод дополнительно фильтрует tenantId на стороне БД.
   */
  async getCanonicalBlocksForMeeting(
    meetingId: string,
    tenantId: string,
  ): Promise<MeetingBlock[]> {
    // 1) Найти RawEvent встречи. Может не существовать (legacy / ingest не отработал).
    const rawEvents = await this.prisma.rawEvent.findMany({
      where: {
        tenantId,
        sourceType: 'meeting',
        sourceExternalId: meetingId,
      },
      select: { id: true },
    });
    if (rawEvents.length === 0) {
      this.logger.debug(
        { meetingId, tenantId },
        'block-fetch: RawEvent встречи не найден',
      );
      return [];
    }
    const rawEventIds = rawEvents.map((r) => r.id);

    // 2) Через evidence найти blockId-ы.
    const evidenceRows = await this.prisma.ideaBlockEvidence.findMany({
      where: { rawEventId: { in: rawEventIds } },
      select: { blockId: true },
    });
    if (evidenceRows.length === 0) {
      return [];
    }
    const blockIdSet = new Set<string>();
    for (const r of evidenceRows) blockIdSet.add(r.blockId);
    const blockIds = [...blockIdSet];

    // 3) Загрузить canonical-блоки tenant'а одним запросом.
    //    Если блок был мёрджнут в canonical после ingest — берём только canonical
    //    (UI всегда работает с canonical, evidence остаётся на старом id, но
    //    canonical блок имеет своё evidence через mergedFrom — мы его уже не
    //    подтягиваем тут, чтобы не размывать хронологию).
    const blocks = await this.prisma.ideaBlock.findMany({
      where: {
        id: { in: blockIds },
        tenantId,
        status: 'canonical',
      },
      select: {
        id: true,
        name: true,
        criticalQuestion: true,
        trustedAnswer: true,
        signalType: true,
        tags: true,
        dataClass: true,
      },
    });
    if (blocks.length === 0) {
      return [];
    }
    const canonicalBlockIds = blocks.map((b) => b.id);

    // 4) Загрузить evidence ровно для этих блоков (только из rawEvent встречи).
    const allEvidence = await this.prisma.ideaBlockEvidence.findMany({
      where: {
        blockId: { in: canonicalBlockIds },
        rawEventId: { in: rawEventIds },
      },
      select: {
        id: true,
        blockId: true,
        startMs: true,
        endMs: true,
        quote: true,
        sourceTimestamp: true,
      },
      orderBy: [{ startMs: 'asc' }, { createdAt: 'asc' }],
    });

    // 5) Группируем evidence по blockId.
    const evidenceByBlock = new Map<string, MeetingBlockEvidence[]>();
    for (const ev of allEvidence) {
      const arr = evidenceByBlock.get(ev.blockId) ?? [];
      arr.push({
        id: ev.id,
        startMs: ev.startMs,
        endMs: ev.endMs,
        quote: ev.quote,
        sourceTimestamp: ev.sourceTimestamp,
      });
      evidenceByBlock.set(ev.blockId, arr);
    }

    // 6) Собираем результат + сортируем по min startMs (хронология).
    const enriched: MeetingBlock[] = blocks.map((b) => ({
      id: b.id,
      name: b.name,
      criticalQuestion: b.criticalQuestion,
      trustedAnswer: b.trustedAnswer,
      signalType: b.signalType,
      tags: b.tags,
      dataClass: b.dataClass,
      evidence: evidenceByBlock.get(b.id) ?? [],
    }));
    enriched.sort((a, b) => minStartMs(a) - minStartMs(b));
    return enriched;
  }
}

function minStartMs(block: MeetingBlock): number {
  let min = Number.POSITIVE_INFINITY;
  for (const ev of block.evidence) {
    if (ev.startMs !== null && ev.startMs < min) min = ev.startMs;
  }
  return Number.isFinite(min) ? min : Number.MAX_SAFE_INTEGER;
}
