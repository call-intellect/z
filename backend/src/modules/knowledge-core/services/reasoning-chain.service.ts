import { Inject, Injectable, Logger } from '@nestjs/common';
import type { IdeaBlockLinkType } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * KC-Temporal W3.2 (2026-05-25) — Reasoning chains first-class.
 *
 * Цель: построить цепочку «решение ← обоснование ← факты» вокруг конкретного
 * блока, чтобы LLM (Chat-v2) и UI могли отрисовать «почему мы выбрали X».
 *
 * BFS по `IdeaBlockLink` (status='active') в обе стороны по белому списку
 * relationType'ов:
 *   - `consequences_of` — A — следствие B (B → A через consequences_of).
 *   - `causes`          — A — причина B.
 *   - `develops`        — A развивает B.
 *   - `question_answered_by` — A — вопрос, на который B — ответ.
 *
 * Эти 4 типа описывают логические цепочки рассуждения. Остальные
 * (`shares_topic` / `shares_entity` / `contradicts` / `supersedes` /
 * `resolves`) — не reasoning-связи (общая тема, конфликт, замещение).
 *
 * Защита от циклов — Set visited по id. Лимит — `MAX_NODES = 50` (защита от
 * больших графов: на тенант'ах с тысячами IdeaBlock'ов BFS depth=3 может
 * экспоненциально раздуваться).
 */

/** Белый список relationType'ов для reasoning-chain. */
const REASONING_LINK_TYPES: ReadonlyArray<IdeaBlockLinkType> = [
  'consequences_of',
  'causes',
  'develops',
  'question_answered_by',
];

/** Максимум узлов в цепочке (защита от больших графов). */
const MAX_NODES = 50;

/**
 * Краткое представление узла цепочки. Полные данные блока подгружаются
 * только для seed-блока (caller) — в цепочке нам важны только id/name/
 * signalType/criticalQuestion/trustedAnswer/dataClass (для prompt'а LLM).
 */
export interface BlockSummary {
  id: string;
  name: string;
  signalType: string;
  criticalQuestion: string;
  trustedAnswer: string;
  /** Глубина BFS от seed-блока (0 — сам seed, 1 — соседи, ...). */
  depth: number;
}

/**
 * Краткое представление ребра цепочки.
 */
export interface LinkSummary {
  fromBlockId: string;
  toBlockId: string;
  relationType: IdeaBlockLinkType;
  confidence: number;
}

export interface ReasoningChain {
  /** Все узлы цепочки, включая seed (depth=0). */
  nodes: BlockSummary[];
  /** Все ребра, попавшие в цепочку (active, reasoning-typed). */
  edges: LinkSummary[];
}

@Injectable()
export class ReasoningChainService {
  private readonly logger = new Logger(ReasoningChainService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  /**
   * Строит reasoning-chain вокруг блока через BFS.
   *
   *   - `blockId` — seed.
   *   - `maxDepth` — 1..3. 0 → только seed. Больше 3 — приводим к 3 (защита
   *     от перебора).
   *
   * Возвращает `{ nodes, edges }`. Если seed не существует / не canonical /
   * чужого тенанта — caller должен проверить это до вызова; здесь возвращаем
   * пустую цепочку.
   */
  async buildChain(
    blockId: string,
    maxDepth = 3,
  ): Promise<ReasoningChain> {
    const depthLimit = Math.max(0, Math.min(3, maxDepth));

    // Seed.
    const seed = await this.prisma.ideaBlock.findUnique({
      where: { id: blockId },
      select: {
        id: true,
        name: true,
        signalType: true,
        criticalQuestion: true,
        trustedAnswer: true,
        tenantId: true,
        status: true,
      },
    });
    if (!seed || seed.status !== 'canonical') {
      return { nodes: [], edges: [] };
    }

    const tenantId = seed.tenantId;
    const nodes = new Map<string, BlockSummary>();
    const edges: LinkSummary[] = [];
    const edgeKeys = new Set<string>();

    nodes.set(seed.id, {
      id: seed.id,
      name: seed.name,
      signalType: seed.signalType,
      criticalQuestion: seed.criticalQuestion,
      trustedAnswer: seed.trustedAnswer,
      depth: 0,
    });

    // BFS frontier: блок'и текущего уровня.
    let frontier: string[] = [seed.id];

    for (let depth = 1; depth <= depthLimit; depth++) {
      if (frontier.length === 0) break;
      if (nodes.size >= MAX_NODES) break;

      // Подтянем все active reasoning-рёбра, идущие из/в frontier.
      const links = await this.prisma.ideaBlockLink.findMany({
        where: {
          tenantId,
          status: 'active',
          relationType: { in: [...REASONING_LINK_TYPES] },
          OR: [
            { fromBlockId: { in: frontier } },
            { toBlockId: { in: frontier } },
          ],
        },
        select: {
          fromBlockId: true,
          toBlockId: true,
          relationType: true,
          confidence: true,
        },
      });
      if (links.length === 0) break;

      // Соберём новых соседей.
      const newNeighbours = new Set<string>();
      const edgesByNeighbour = new Map<string, LinkSummary[]>();
      for (const l of links) {
        const key = `${l.fromBlockId}|${l.toBlockId}|${l.relationType}`;
        if (edgeKeys.has(key)) continue;
        const summary: LinkSummary = {
          fromBlockId: l.fromBlockId,
          toBlockId: l.toBlockId,
          relationType: l.relationType,
          confidence: numberFromDecimal(l.confidence),
        };
        // Сосед — тот конец ребра, которого ещё нет в nodes.
        const otherId = nodes.has(l.fromBlockId)
          ? l.toBlockId
          : l.fromBlockId;
        // Сосед уже в nodes? Тогда это «обратная» связь — добавляем ребро
        // для полноты графа, но не добавляем в frontier.
        if (nodes.has(otherId)) {
          edgeKeys.add(key);
          edges.push(summary);
          continue;
        }
        newNeighbours.add(otherId);
        const arr = edgesByNeighbour.get(otherId) ?? [];
        arr.push(summary);
        edgesByNeighbour.set(otherId, arr);
        edgeKeys.add(key);
      }
      if (newNeighbours.size === 0) break;

      // Подгружаем самих новых соседей.
      const neighbourBlocks = await this.prisma.ideaBlock.findMany({
        where: {
          id: { in: [...newNeighbours] },
          tenantId,
          status: 'canonical',
        },
        select: {
          id: true,
          name: true,
          signalType: true,
          criticalQuestion: true,
          trustedAnswer: true,
        },
      });

      const nextFrontier: string[] = [];
      for (const nb of neighbourBlocks) {
        if (nodes.size >= MAX_NODES) break;
        nodes.set(nb.id, {
          id: nb.id,
          name: nb.name,
          signalType: nb.signalType,
          criticalQuestion: nb.criticalQuestion,
          trustedAnswer: nb.trustedAnswer,
          depth,
        });
        // Добавляем все рёбра, которые вели к этому соседу.
        const nbEdges = edgesByNeighbour.get(nb.id);
        if (nbEdges) edges.push(...nbEdges);
        nextFrontier.push(nb.id);
      }
      frontier = nextFrontier;
    }

    return { nodes: [...nodes.values()], edges };
  }
}

// ─────────────────────────── helpers ───────────────────────────

function numberFromDecimal(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  if (v && typeof (v as { toString?: () => string }).toString === 'function') {
    const n = Number((v as { toString: () => string }).toString());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
