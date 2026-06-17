import { Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  PromiseNetworkDto,
  PromiseNetworkNodeDto,
} from '../dto/promise-network.dto';

/**
 * ТЗ coo-orphan-agents Ф7 — чтение последнего PromiseNetworkSnapshot и выдача
 * перегруженных ответственностью (accumulators). Снапшот пишет
 * PromiseNetworkAnalyzerCron (weekly); здесь только read + защитный парс.
 */
@Injectable()
export class PromiseNetworkService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getLatest(args: { tenantId: string }): Promise<PromiseNetworkDto> {
    const snap = await this.prisma.promiseNetworkSnapshot.findFirst({
      where: { tenantId: args.tenantId },
      orderBy: { snapshotAt: 'desc' },
    });
    if (!snap) {
      return { hasData: false, snapshotAt: null, totalCommitments: 0, accumulators: [] };
    }
    const nodes = this.parseAccumulators(snap.graphJson);
    if (nodes === null) {
      // graphJson битый — не падаем, отдаём «нет данных».
      return {
        hasData: false,
        snapshotAt: snap.snapshotAt.toISOString(),
        totalCommitments: snap.totalCommitments,
        accumulators: [],
      };
    }
    return {
      hasData: true,
      snapshotAt: snap.snapshotAt.toISOString(),
      totalCommitments: snap.totalCommitments,
      accumulators: nodes,
    };
  }

  /** Защитный парс graphJson.nodes → accumulators (sort inDegree DESC). null при битом JSON. */
  private parseAccumulators(json: unknown): PromiseNetworkNodeDto[] | null {
    if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
    const nodesRaw = (json as { nodes?: unknown }).nodes;
    if (!Array.isArray(nodesRaw)) return null;
    const out: PromiseNetworkNodeDto[] = [];
    for (const n of nodesRaw) {
      if (!n || typeof n !== 'object') continue;
      const o = n as Record<string, unknown>;
      if (o.role !== 'accumulator') continue;
      if (
        typeof o.personId !== 'string' ||
        typeof o.name !== 'string' ||
        typeof o.inDegree !== 'number' ||
        typeof o.outDegree !== 'number' ||
        typeof o.balance !== 'number'
      ) {
        continue;
      }
      out.push({
        personId: o.personId,
        name: o.name,
        inDegree: o.inDegree,
        outDegree: o.outDegree,
        balance: o.balance,
      });
    }
    out.sort((a, b) => b.inDegree - a.inDegree);
    return out;
  }
}
