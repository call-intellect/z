import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * Pulse Wave 6 §6.5 — Promise-Network-Analyzer cron.
 *
 * Источник: plans/tz/2026-05-30-pulse-full.md §6.5.
 *
 * Weekly (`@Cron('0 5 * * 1')`). Для каждой Org:
 *   1. Загружает `IdeaBlock` с `signalType='commitment'` за 30 дней.
 *   2. Автор обещания = Person через `IdeaBlockEntity.role='subject'`,
 *      получатель = `commitmentRecipientPersonId`.
 *   3. Строит directed-граф edge: author → recipient (count повторений).
 *   4. Считает per-node: `inDegree` (сколько обещано этому), `outDegree`
 *      (сколько обещал сам), `balance = inDegree - outDegree`.
 *   5. Помечает `role`:
 *        - 'accumulator' (inDegree ≥ 3 × outDegree, обещают много)
 *        - 'donor'       (outDegree ≥ 3 × inDegree, раздаёт обещания)
 *        - 'isolated'    (inDegree + outDegree ≤ 1)
 *        - 'balanced'    (иначе)
 *
 * Без LLM — чистая агрегация. Best-effort.
 */
@Injectable()
export class PromiseNetworkAnalyzerCron {
  private readonly logger = new Logger(PromiseNetworkAnalyzerCron.name);
  private static readonly WINDOW_DAYS = 30;
  private static readonly WINDOW_MS =
    PromiseNetworkAnalyzerCron.WINDOW_DAYS * 24 * 3600 * 1000;
  private static readonly MAX_ORGS_PER_RUN = 5_000;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Weekly Mon 05:00 UTC. */
  @Cron('0 5 * * 1')
  async run(): Promise<void> {
    try {
      const stats = await this.runOnce();
      this.logger.log(stats, 'promise-network-analyzer.cron: проход завершён');
    } catch (err) {
      this.logger.error(
        `promise-network-analyzer.cron fail: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async runOnce(): Promise<{
    orgsProcessed: number;
    snapshotsCreated: number;
    errors: number;
  }> {
    const now = new Date();
    const periodStart = new Date(
      now.getTime() - PromiseNetworkAnalyzerCron.WINDOW_MS,
    );

    const orgs = await this.prisma.org.findMany({
      where: { deletedAt: null },
      select: { id: true },
      take: PromiseNetworkAnalyzerCron.MAX_ORGS_PER_RUN,
    });

    let orgsProcessed = 0;
    let snapshotsCreated = 0;
    let errors = 0;

    for (const org of orgs) {
      orgsProcessed++;
      try {
        const created = await this.processOrg({
          tenantId: org.id,
          periodStart,
          periodEnd: now,
        });
        if (created) snapshotsCreated++;
      } catch (err) {
        errors++;
        this.logger.warn(
          `promise-network-analyzer org ${org.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return { orgsProcessed, snapshotsCreated, errors };
  }

  private async processOrg(args: {
    tenantId: string;
    periodStart: Date;
    periodEnd: Date;
  }): Promise<boolean> {
    const { tenantId, periodStart, periodEnd } = args;

    const commitments = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId,
        signalType: 'commitment',
        createdAt: { gte: periodStart, lte: periodEnd },
      },
      select: {
        id: true,
        commitmentRecipientPersonId: true,
        commitmentRecipient: { select: { id: true, name: true } },
        // Автор через IdeaBlockEntity с role='subject' → Entity.persons.
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
    if (commitments.length === 0) return false;

    // Узлы графа: personId → { name, inDegree, outDegree }.
    const nodes = new Map<
      string,
      { name: string; inDegree: number; outDegree: number }
    >();
    // Edges: "fromId|toId" → count.
    const edgesMap = new Map<
      string,
      { fromPersonId: string; toPersonId: string; count: number }
    >();

    let validCommitments = 0;
    for (const block of commitments) {
      const recipient = block.commitmentRecipient;
      if (!recipient) continue;
      const author = pickAuthor(block.entities);
      if (!author) continue;
      // Self-promise — игнорируем.
      if (author.personId === recipient.id) continue;

      validCommitments++;
      upsertNode(nodes, author.personId, author.name);
      upsertNode(nodes, recipient.id, recipient.name);

      const fromNode = nodes.get(author.personId)!;
      const toNode = nodes.get(recipient.id)!;
      fromNode.outDegree++;
      toNode.inDegree++;

      const key = `${author.personId}|${recipient.id}`;
      const edge = edgesMap.get(key);
      if (edge) {
        edge.count++;
      } else {
        edgesMap.set(key, {
          fromPersonId: author.personId,
          toPersonId: recipient.id,
          count: 1,
        });
      }
    }

    if (nodes.size === 0) return false;

    const graphNodes = [...nodes.entries()].map(([personId, node]) => {
      const balance = node.inDegree - node.outDegree;
      const role = classifyRole(node.inDegree, node.outDegree);
      return {
        personId,
        name: node.name,
        role,
        inDegree: node.inDegree,
        outDegree: node.outDegree,
        balance,
      };
    });

    const graphJson = {
      nodes: graphNodes,
      edges: [...edgesMap.values()],
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
    } as unknown as Prisma.InputJsonValue;

    await this.prisma.promiseNetworkSnapshot.create({
      data: {
        tenantId,
        graphJson,
        totalCommitments: validCommitments,
      },
    });
    return true;
  }
}

/**
 * Из связанных IdeaBlockEntity достаём первого «лучшего» автора.
 * Предпочитаем role='subject'; иначе берём первого Person'а.
 * Аналог `CommitmentsService.extractAuthor`.
 */
function pickAuthor(
  entities: Array<{
    role: string | null;
    entity: { persons: Array<{ id: string; name: string }> } | null;
  }>,
): { personId: string; name: string } | null {
  if (!entities || entities.length === 0) return null;
  const subjects = entities.filter((e) => e.role === 'subject');
  const pool = subjects.length > 0 ? subjects : entities;
  for (const e of pool) {
    const p = e.entity?.persons?.[0];
    if (p) return { personId: p.id, name: p.name };
  }
  return null;
}

function upsertNode(
  nodes: Map<string, { name: string; inDegree: number; outDegree: number }>,
  personId: string,
  name: string,
): void {
  if (!nodes.has(personId)) {
    nodes.set(personId, { name, inDegree: 0, outDegree: 0 });
  }
}

/**
 * Pulse §6.5 классификатор узла:
 *   - accumulator: inDegree ≥ 3 × outDegree (получает много).
 *   - donor:       outDegree ≥ 3 × inDegree (раздаёт).
 *   - isolated:    in + out ≤ 1.
 *   - balanced:    иначе.
 */
export function classifyRole(
  inDegree: number,
  outDegree: number,
): 'accumulator' | 'donor' | 'isolated' | 'balanced' {
  if (inDegree + outDegree <= 1) return 'isolated';
  if (inDegree >= 3 * Math.max(1, outDegree) && inDegree >= 3)
    return 'accumulator';
  if (outDegree >= 3 * Math.max(1, inDegree) && outDegree >= 3) return 'donor';
  return 'balanced';
}
