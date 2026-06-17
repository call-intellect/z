import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';

export interface MeetingMaterialization {
  meetingId: string;
  tenantId: string;
  blockCount: number;
  signalTypeDistribution: Record<string, number>;
  statusDistribution: Record<string, number>;
  materialized: { decisions: number; ideas: number; goals: number };
  gaps: Array<{
    type: 'decision' | 'idea';
    blocksWithSignal: number;
    materialized: number;
  }>;
}

@Injectable()
export class GraphMaterializationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

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

    const evidence = await this.prisma.ideaBlockEvidence.findMany({
      where: { rawEventId: { in: rawEventIds } },
      select: { blockId: true },
    });
    const blockIds = [...new Set(evidence.map((e) => e.blockId))];
    if (blockIds.length === 0) return empty;

    const blocks = await this.prisma.ideaBlock.findMany({
      where: { id: { in: blockIds }, tenantId },
      select: { signalType: true, status: true },
    });
    const signalTypeDistribution: Record<string, number> = {};
    const statusDistribution: Record<string, number> = {};
    const canonicalBySignalType: Record<string, number> = {};
    for (const b of blocks) {
      const sig = String(b.signalType);
      const st = String(b.status);
      signalTypeDistribution[sig] = (signalTypeDistribution[sig] ?? 0) + 1;
      statusDistribution[st] = (statusDistribution[st] ?? 0) + 1;
      if (st === 'canonical') {
        canonicalBySignalType[sig] = (canonicalBySignalType[sig] ?? 0) + 1;
      }
    }

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

    const gaps: MeetingMaterialization['gaps'] = [];
    const decisionGap = buildGap('decision', canonicalBySignalType['decision'] ?? 0, decisions);
    if (decisionGap) gaps.push(decisionGap);
    const ideaGap = buildGap('idea', canonicalBySignalType['idea'] ?? 0, ideas);
    if (ideaGap) gaps.push(ideaGap);

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

function buildGap(
  type: 'decision' | 'idea',
  canonicalCount: number,
  materialized: number,
): MeetingMaterialization['gaps'][number] | null {
  if (canonicalCount > 0 && materialized === 0) {
    return { type, blocksWithSignal: canonicalCount, materialized };
  }
  return null;
}
