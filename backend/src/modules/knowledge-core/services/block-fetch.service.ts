import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DataClass, IdeaBlock, Prisma, SignalType, SourceType } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

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
  authorLabel: string | null;
}

@Injectable()
export class BlockFetchService {
  private readonly logger = new Logger(BlockFetchService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getCanonicalBlocksForMeeting(meetingId: string, tenantId: string): Promise<MeetingBlock[]> {
    return this.getCanonicalBlocksForSource(tenantId, 'meeting', meetingId);
  }

  async getCanonicalBlocksForSource(
    tenantId: string,
    sourceType: string,
    externalId: string,
  ): Promise<MeetingBlock[]> {
    const rawEvents = await this.prisma.rawEvent.findMany({
      where: {
        tenantId,
        sourceType: sourceType as SourceType,
        sourceExternalId: externalId,
      },
      select: { id: true },
    });
    if (rawEvents.length === 0) {
      this.logger.debug(
        { sourceType, externalId, tenantId },
        'block-fetch: RawEvent источника не найден',
      );
      return [];
    }
    const rawEventIds = rawEvents.map((r) => r.id);

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
        authorLabel: true,
      },
      orderBy: [{ startMs: 'asc' }, { createdAt: 'asc' }],
    });

    const evidenceByBlock = new Map<string, MeetingBlockEvidence[]>();
    for (const ev of allEvidence) {
      const arr = evidenceByBlock.get(ev.blockId) ?? [];
      arr.push({
        id: ev.id,
        startMs: ev.startMs,
        endMs: ev.endMs,
        quote: ev.quote,
        sourceTimestamp: ev.sourceTimestamp,
        authorLabel: ev.authorLabel,
      });
      evidenceByBlock.set(ev.blockId, arr);
    }

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

@Injectable()
export class KnowledgeBlockResolver {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  buildActiveWhere(at?: Date): Prisma.IdeaBlockWhereInput {
    if (!at) {
      return { validUntil: null };
    }
    return {
      AND: [
        { OR: [{ validFrom: null }, { validFrom: { lte: at } }] },
        { OR: [{ validUntil: null }, { validUntil: { gt: at } }] },
      ],
    };
  }

  async getActive(args: {
    tenantId: string;
    at?: Date;
    signalTypes?: SignalType[];
    take?: number;
  }): Promise<IdeaBlock[]> {
    return this.prisma.ideaBlock.findMany({
      where: {
        tenantId: args.tenantId,
        status: 'canonical',
        ...(args.signalTypes && args.signalTypes.length > 0
          ? { signalType: { in: args.signalTypes } }
          : {}),
        ...this.buildActiveWhere(args.at),
      },
      take: args.take ?? 100,
      orderBy: { updatedAt: 'desc' },
    });
  }
}
