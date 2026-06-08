import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { TypedConfigService } from '../../common/config/index';
import { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { tryParseJson } from '../ai/services/json-extract.util';
import { LlmRouterService } from '../ai/services/llm-router.service';
import {
  withInjectionGuard,
  wrapUserData,
} from '../ai/services/prompts/common';
import { EmbeddingFallbackService } from '../embeddings/services/embedding-fallback.service';
import {
  TASK_DEDUPE_JSON_SCHEMA,
  TASK_DEDUPE_SCHEMA_NAME,
  TASK_DEDUPE_SYSTEM_PROMPT,
  TASK_DEDUPE_USER_TEMPLATE,
  TaskDedupeResponseSchema,
} from '../knowledge-core/prompts/task-dedupe.prompt';

/**
 * MeetingTaskDedupeService (Ф5 Р2, 2026-06-08) — семантический дедуп задач
 * встречи.
 *
 * Контракт NON-LOSSY:
 *   - canonical-задачи (Task.extractorVersion IS NULL) НИКОГДА не удаляются.
 *   - fast-задачи (Task.extractorVersion='fast') — это черновики. Если
 *     fast-черновик семантически совпадает с canonical-задачей ТОЙ ЖЕ встречи —
 *     удаляется ТОЛЬКО черновик (сама задача остаётся как canonical, данные
 *     не теряются). fast-черновик без canonical-эквивалента не трогаем.
 *
 * РИСКОВО (может скрыть задачу) → весь сервис под флагом
 * `cfg.knowledgeCore.taskDedupeEnabled` (дефолт FALSE). Любая ошибка дедупа —
 * best-effort (warn-лог), вызывающий воркер не падает.
 *
 * Алгоритм:
 *   1. flag OFF → no-op.
 *   2. embed заголовки canonical + drafts одним батчем.
 *   3. для каждого draft — max cosine по canonical:
 *      - sim >= threshold              → дубль (knn_merged), удалить черновик;
 *      - [threshold-0.07, threshold)   → LLM-арбитр task-dedupe (серая зона):
 *                                        verdict='same' → llm_merged, удалить;
 *                                        иначе → kept;
 *      - sim < threshold-0.07          → kept.
 *   4. deleteMany помеченных черновиков.
 */
@Injectable()
export class MeetingTaskDedupeService {
  private readonly logger = new Logger(MeetingTaskDedupeService.name);

  /** Ширина «серой зоны» под порогом, где решение делегируется LLM-арбитру. */
  private static readonly GRAY_BAND = 0.07;
  /** Максимум попыток вызова+парсинга LLM-арбитра (зеркалит block-link). */
  private static readonly LLM_RETRIES = 2;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EmbeddingFallbackService)
    private readonly embeddings: EmbeddingFallbackService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics?: BusinessMetricsService,
  ) {}

  /**
   * Дедуп fast-черновиков встречи против canonical-задач. Возвращает число
   * удалённых черновиков. Никогда не бросает — на любой сбой возвращает
   * `{ merged: 0 }` (best-effort).
   */
  async dedupeForMeeting(args: {
    tenantId: string | null;
    meetingId: string;
  }): Promise<{ merged: number }> {
    try {
      if (!this.isEnabled()) return { merged: 0 };

      const rows = await this.prisma.task.findMany({
        where: {
          meetingId: args.meetingId,
          ...(args.tenantId ? { tenantId: args.tenantId } : {}),
        },
        select: {
          id: true,
          title: true,
          description: true,
          assigneeRaw: true,
          assigneeUserId: true,
          extractorVersion: true,
        },
      });

      const drafts = rows.filter((r) => r.extractorVersion === 'fast');
      const canonical = rows.filter((r) => r.extractorVersion !== 'fast');
      if (drafts.length === 0 || canonical.length === 0) {
        return { merged: 0 };
      }

      const threshold = this.threshold();

      // Эмбеддинг заголовков ОДНИМ батчем: [canonical..., drafts...].
      let vectors: number[][];
      try {
        vectors = await this.embeddings.embed([
          ...canonical.map((r) => this.titleText(r)),
          ...drafts.map((r) => this.titleText(r)),
        ]);
      } catch (err) {
        this.metrics?.incTaskDedupe({ result: 'skipped' });
        this.logger.warn(
          {
            meetingId: args.meetingId,
            err: err instanceof Error ? err.message : String(err),
          },
          'task-dedupe: embed упал — пропуск',
        );
        return { merged: 0 };
      }
      if (vectors.length !== canonical.length + drafts.length) {
        this.metrics?.incTaskDedupe({ result: 'skipped' });
        this.logger.warn(
          { meetingId: args.meetingId },
          'task-dedupe: длина embedding-батча не совпала — пропуск',
        );
        return { merged: 0 };
      }
      const canonVecs = vectors.slice(0, canonical.length);
      const draftVecs = vectors.slice(canonical.length);

      const toDelete: string[] = [];
      for (let i = 0; i < drafts.length; i++) {
        const draft = drafts[i]!;
        const dv = draftVecs[i]!;

        // max cosine по canonical + индекс лучшего кандидата (для LLM-арбитра).
        let bestSim = -Infinity;
        let bestIdx = -1;
        for (let j = 0; j < canonical.length; j++) {
          const sim = this.cosine(dv, canonVecs[j]!);
          if (sim > bestSim) {
            bestSim = sim;
            bestIdx = j;
          }
        }

        if (bestSim >= threshold) {
          toDelete.push(draft.id);
          this.metrics?.incTaskDedupe({ result: 'knn_merged' });
          continue;
        }

        if (bestSim >= threshold - MeetingTaskDedupeService.GRAY_BAND && bestIdx >= 0) {
          // Серая зона — один LLM-вызов на пару (draft, лучший canonical).
          const same = await this.judgeSame(
            args.tenantId,
            args.meetingId,
            draft,
            canonical[bestIdx]!,
          );
          if (same) {
            toDelete.push(draft.id);
            this.metrics?.incTaskDedupe({ result: 'llm_merged' });
          } else {
            this.metrics?.incTaskDedupe({ result: 'kept' });
          }
          continue;
        }

        this.metrics?.incTaskDedupe({ result: 'kept' });
      }

      if (toDelete.length === 0) return { merged: 0 };

      await this.prisma.task.deleteMany({
        where: { id: { in: toDelete }, meetingId: args.meetingId },
      });
      this.logger.log(
        { meetingId: args.meetingId, merged: toDelete.length },
        'task-dedupe: удалены fast-черновики (дубли canonical)',
      );
      return { merged: toDelete.length };
    } catch (err) {
      // Best-effort: ошибка дедупа НЕ должна валить вызывающий воркер.
      this.metrics?.incTaskDedupe({ result: 'skipped' });
      this.logger.warn(
        {
          meetingId: args.meetingId,
          err: err instanceof Error ? err.message : String(err),
        },
        'task-dedupe: непредвиденная ошибка — пропуск',
      );
      return { merged: 0 };
    }
  }

  // ─────────────────────────── helpers ─────────────────────────────────────

  private isEnabled(): boolean {
    try {
      return this.cfg.knowledgeCore.taskDedupeEnabled === true;
    } catch {
      return false;
    }
  }

  private threshold(): number {
    try {
      const t = this.cfg.knowledgeCore.taskDedupeThreshold;
      return Number.isFinite(t) ? t : 0.85;
    } catch {
      return 0.85;
    }
  }

  /** Текст для эмбеддинга: title + (description, обрезано до ~200). */
  private titleText(row: { title: string; description?: string | null }): string {
    const title = (row.title ?? '').trim();
    const desc = (row.description ?? '').trim();
    if (!desc) return title;
    return `${title}. ${desc.slice(0, 200)}`;
  }

  private cosine(a: number[], b: number[]): number {
    const n = Math.min(a.length, b.length);
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < n; i++) {
      const x = a[i]!;
      const y = b[i]!;
      dot += x * y;
      na += x * x;
      nb += y * y;
    }
    if (na === 0 || nb === 0) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  /**
   * LLM-арбитр для серой зоны: один вызов task-dedupe на пару (draft, canonical).
   * verdict='same' → true (дубль). Зеркалит block-link: retry×2 + validate +
   * tryParseJson + Zod. Любая неудача после ретраев → false (kept, non-lossy).
   */
  private async judgeSame(
    tenantId: string | null,
    meetingId: string,
    draft: { id: string; title: string; assigneeRaw: string | null },
    canonical: { id: string; title: string; assigneeRaw: string | null },
  ): Promise<boolean> {
    const userMessage = TASK_DEDUPE_USER_TEMPLATE({
      a: { title: canonical.title, assignee: canonical.assigneeRaw },
      b: { title: draft.title, assignee: draft.assigneeRaw },
    });

    for (let attempt = 0; attempt < MeetingTaskDedupeService.LLM_RETRIES; attempt++) {
      try {
        const out = await this.llm.call({
          taskType: 'task-dedupe',
          tenantId,
          systemPrompt: withInjectionGuard(TASK_DEDUPE_SYSTEM_PROMPT),
          userMessage: wrapUserData(userMessage),
          responseFormat: {
            type: 'json_schema',
            name: TASK_DEDUPE_SCHEMA_NAME,
            strict: true,
            schema: TASK_DEDUPE_JSON_SCHEMA,
          },
          sourceRef: { type: 'task', id: draft.id },
          dataClass: 'internal',
          validate: (text) => this.parseVerdict(text) !== null,
        });
        const verdict = this.parseVerdict(out.text);
        if (verdict !== null) return verdict === 'same';
        this.logger.warn(
          { meetingId, draftId: draft.id, attempt },
          'task-dedupe: невалидный JSON арбитра — повтор',
        );
      } catch (err) {
        this.logger.warn(
          {
            meetingId,
            draftId: draft.id,
            attempt,
            err: err instanceof Error ? err.message : String(err),
          },
          'task-dedupe: LLM-арбитр упал — повтор',
        );
      }
    }
    // После ретраев — консервативно НЕ удаляем (non-lossy).
    return false;
  }

  private parseVerdict(text: string): 'same' | 'different' | null {
    const raw = tryParseJson(text);
    const parsed = TaskDedupeResponseSchema.safeParse(raw);
    if (!parsed.success) return null;
    return parsed.data.verdict;
  }
}
