import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  type CardSpecialistHandler,
  type CardSpecialistResult,
  CardSpecialistRegistry,
} from '../services/card-specialist-registry.service';

/**
 * Tracker Phase 3 part C (Wave 3, 2026-05-24) — обработчик `CardSpecialistRegistry`
 * для задач трекера. Регистрируется как 'issue'.
 *
 * Контракт:
 *   - `getCardsForQuery` (CardSpecialistHandler) — основной API, который
 *     дергает `ChatV2OrchestrationService` при синтезе ответа: возвращает Issue,
 *     у которых `Issue.sourceBlockIds` пересекаются с candidateBlockIds
 *     retrieval'а chat-v2 (паттерн как у Specialist31/34CardHandler).
 *   - `getCitations(blockIds)` — public helper для будущего ChatV2RetrievalService
 *     (расширенный retrieval): возвращает структуру для построения цитат.
 *   - `formatForChat(issue)` — public helper: рендерит карточку задачи как
 *     короткую строку для prompt'а.
 *
 * Tenant isolation — обязательно во всех запросах. На любую ошибку — `[]`.
 */
@Injectable()
export class IssueCardHandler implements OnModuleInit, CardSpecialistHandler {
  private readonly logger = new Logger(IssueCardHandler.name);
  static readonly SPECIALIST_NAME = 'issue';
  private static readonly DEFAULT_CONFIDENCE = 0.7;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CardSpecialistRegistry)
    private readonly registry: CardSpecialistRegistry,
  ) {}

  onModuleInit(): void {
    this.registry.register(IssueCardHandler.SPECIALIST_NAME, this);
    this.logger.log(
      `IssueCardHandler зарегистрирован как '${IssueCardHandler.SPECIALIST_NAME}' в CardSpecialistRegistry`,
    );
  }

  /**
   * Возвращает Issue-карточки, релевантные query. Берём те, у которых
   * `sourceBlockIds` пересекаются с `candidateBlockIds` retrieval'а (тот же
   * паттерн что в Specialist31/34CardHandler).
   *
   * confidence считаем из Issue.confidence (если задача создана AI с
   * рейтингом уверенности) + бонус за overlap.
   */
  async getCardsForQuery(args: {
    tenantId: string;
    query: string;
    candidateBlockIds: readonly string[];
    limit: number;
  }): Promise<readonly CardSpecialistResult[]> {
    try {
      if (args.candidateBlockIds.length === 0 || args.limit <= 0) {
        return [];
      }
      const blockIds = args.candidateBlockIds.slice(0, 200);
      const blockSet = new Set(blockIds);
      const issues = await this.prisma.issue.findMany({
        where: {
          tenantId: args.tenantId,
          deletedAt: null,
          sourceBlockIds: { hasSome: [...blockIds] },
        },
        select: {
          id: true,
          identifier: true,
          title: true,
          descriptionStripped: true,
          description: true,
          sourceBlockIds: true,
          confidence: true,
          stateId: true,
          completedAt: true,
          projectId: true,
          dueDate: true,
          priority: true,
        },
        take: Math.max(args.limit * 3, 30),
      });

      interface Candidate {
        result: CardSpecialistResult;
        score: number;
      }
      const candidates: Candidate[] = [];
      for (const i of issues) {
        const overlap = i.sourceBlockIds.filter((b) => blockSet.has(b)).length;
        const base =
          i.confidence !== null
            ? Number(i.confidence)
            : IssueCardHandler.DEFAULT_CONFIDENCE;
        const final = Math.min(1, base + Math.min(0.1, overlap * 0.02));
        const text =
          i.descriptionStripped ?? i.description ?? '(без описания)';
        candidates.push({
          result: {
            id: i.id,
            type: 'issue',
            title: `${i.identifier} — ${i.title}`,
            text: text.slice(0, 800),
            sourceBlockIds: i.sourceBlockIds,
            confidence: final,
          },
          score: overlap + 1,
        });
      }
      candidates.sort((a, b) => b.score - a.score);
      return candidates.slice(0, args.limit).map((c) => c.result);
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'IssueCardHandler.getCardsForQuery упал — возвращаю []',
      );
      return [];
    }
  }

  /**
   * Public helper: получить структуру цитат для списка blockId'ов.
   * Используется при формировании ответа chat-v2: после retrieval по
   * candidateBlockIds можем поднять Issue, которые ссылаются на них.
   *
   * Контракт: для каждого Issue, у которого `sourceBlockIds` пересекается
   * хотя бы с одним из переданных `blockIds`, возвращаем `IssueCitation`.
   * tenantId обязателен для cross-tenant защиты.
   */
  async getCitations(args: {
    tenantId: string;
    blockIds: readonly string[];
    limit?: number;
  }): Promise<IssueCitation[]> {
    if (args.blockIds.length === 0) return [];
    const limit = args.limit ?? 10;
    try {
      const issues = await this.prisma.issue.findMany({
        where: {
          tenantId: args.tenantId,
          deletedAt: null,
          sourceBlockIds: { hasSome: [...args.blockIds] },
        },
        select: {
          id: true,
          identifier: true,
          title: true,
          descriptionStripped: true,
          description: true,
          projectId: true,
          stateId: true,
          completedAt: true,
          priority: true,
          dueDate: true,
        },
        take: Math.max(limit, 1),
      });
      return issues.map((i) => ({
        id: i.id,
        identifier: i.identifier,
        title: i.title,
        description: i.descriptionStripped ?? i.description ?? null,
        projectId: i.projectId,
        stateId: i.stateId,
        completedAt: i.completedAt ? i.completedAt.toISOString() : null,
        priority: i.priority,
        dueDate: i.dueDate ? i.dueDate.toISOString() : null,
      }));
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'IssueCardHandler.getCitations упал — возвращаю []',
      );
      return [];
    }
  }

  /**
   * Public helper: форматирует Issue как короткую карточку для prompt'а.
   * Не делает дополнительных запросов — рендерит то, что передано.
   *
   *   "📋 KORA-123 — Завершить релиз v2 (статус: В работе, дедлайн: 2026-06-01, приоритет: high)"
   */
  formatForChat(args: {
    identifier: string;
    title: string;
    stateName?: string | null;
    completedAt?: string | null;
    priority?: string | null;
    dueDate?: string | null;
  }): string {
    const segments: string[] = [];
    if (args.completedAt) {
      segments.push('завершена');
    } else if (args.stateName) {
      segments.push(`статус: ${args.stateName}`);
    }
    if (args.priority && args.priority !== 'none') {
      segments.push(`приоритет: ${args.priority}`);
    }
    if (args.dueDate) {
      const date = args.dueDate.slice(0, 10);
      segments.push(`дедлайн: ${date}`);
    }
    const meta = segments.length ? ` (${segments.join(', ')})` : '';
    return `📋 ${args.identifier} — ${args.title}${meta}`;
  }
}

/**
 * Структура цитаты Issue, отдаваемая в `getCitations`. Используется фронтом
 * для рендера ссылок «Источник: KORA-123».
 */
export interface IssueCitation {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  projectId: string;
  stateId: string | null;
  completedAt: string | null;
  priority: string;
  dueDate: string | null;
}
