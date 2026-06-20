import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';

interface BlockQuote {
  blockId: string;
  normalized: string;
}

interface TaskRow {
  id: string;
  sourceQuote: string;
}

@Injectable()
export class TaskEvidenceLinkerService {
  private readonly logger = new Logger(TaskEvidenceLinkerService.name);

  private static readonly MIN_NORMALIZED_LENGTH = 12;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async linkForMeeting(args: {
    tenantId: string;
    meetingId: string;
  }): Promise<{ linked: number }> {
    const { tenantId, meetingId } = args;
    try {
      const tasks = await this.prisma.task.findMany({
        where: {
          meetingId,
          tenantId,
          evidenceBlockIds: { isEmpty: true },
          NOT: { sourceQuote: null },
        },
        select: { id: true, sourceQuote: true },
      });
      const candidates: TaskRow[] = [];
      for (const t of tasks) {
        const q = (t.sourceQuote ?? '').trim();
        if (q.length === 0) continue;
        candidates.push({ id: t.id, sourceQuote: q });
      }
      if (candidates.length === 0) return { linked: 0 };

      const blocks = await this.loadMeetingBlockQuotes(tenantId, meetingId);
      if (blocks.length === 0) return { linked: 0 };

      let linked = 0;
      for (const task of candidates) {
        const blockId = this.bestBlockMatch(task.sourceQuote, blocks);
        if (!blockId) continue;
        const res = await this.prisma.task.updateMany({
          where: { id: task.id, tenantId, evidenceBlockIds: { isEmpty: true } },
          data: { evidenceBlockIds: [blockId] },
        });
        if (res.count > 0) linked += 1;
      }
      if (linked > 0) {
        this.logger.debug(
          { meetingId, tenantId, linked, tasks: candidates.length, blocks: blocks.length },
          'task-evidence-linker: задачи привязаны к блокам-источникам',
        );
      }
      return { linked };
    } catch (err) {
      this.logger.warn(
        { meetingId, tenantId, err: err instanceof Error ? err.message : String(err) },
        'task-evidence-linker: непредвиденная ошибка — пропуск (graceful)',
      );
      return { linked: 0 };
    }
  }

  private async loadMeetingBlockQuotes(
    tenantId: string,
    meetingId: string,
  ): Promise<BlockQuote[]> {
    const rows = await this.prisma.ideaBlockEvidence.findMany({
      where: {
        block: { tenantId },
        rawEvent: { sourceType: 'meeting', sourceExternalId: meetingId, tenantId },
      },
      select: { blockId: true, quote: true },
      orderBy: [{ startMs: 'asc' }, { createdAt: 'asc' }],
    });
    const out: BlockQuote[] = [];
    for (const r of rows) {
      const normalized = normalizeQuote(r.quote);
      if (normalized.length < TaskEvidenceLinkerService.MIN_NORMALIZED_LENGTH) continue;
      out.push({ blockId: r.blockId, normalized });
    }
    return out;
  }

  private bestBlockMatch(taskQuote: string, blocks: BlockQuote[]): string | null {
    const needle = normalizeQuote(taskQuote);
    if (needle.length < TaskEvidenceLinkerService.MIN_NORMALIZED_LENGTH) return null;

    let bestBlockId: string | null = null;
    let bestOverlap = 0;
    for (const block of blocks) {
      const overlap = containmentOverlap(needle, block.normalized);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestBlockId = block.blockId;
      }
    }
    return bestBlockId;
  }
}

function normalizeQuote(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[«»"'`]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function containmentOverlap(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;
  if (b.includes(a)) return a.length;
  if (a.includes(b)) return b.length;
  return 0;
}
