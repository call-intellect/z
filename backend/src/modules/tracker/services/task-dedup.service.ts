import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { AdminSettingsService } from '../../admin/settings/admin-settings.service';
import { tryParseJson } from '../../ai/services/json-extract.util';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  withInjectionGuard,
  wrapUserData,
} from '../../ai/services/prompts/common';
import { EmbeddingFallbackService } from '../../embeddings/services/embedding-fallback.service';
import { ConfidenceCalibrationService } from '../../knowledge-core/services/confidence-calibration.service';
import {
  TASK_DEDUP_ARBITER_JSON_SCHEMA,
  TASK_DEDUP_ARBITER_SCHEMA_NAME,
  TASK_DEDUP_ARBITER_SYSTEM_PROMPT,
  TASK_DEDUP_ARBITER_USER_TEMPLATE,
  TaskDedupArbiterResponseSchema,
} from '../prompts/task-dedup-arbiter.prompt';

import { SimilarIssuesService } from './similar-issues.service';

/** Вердикт дедупа задачи-кандидата (TZ task-dedup, 2026-06-16). */
export interface TaskDedupResult {
  /**
   * 'same' — кандидат дублирует `matchedIssueId` (suggest, НЕ авто-merge);
   * 'different' / 'nil' — создаём новую задачу как есть. При любом сбое
   * (embed-таймаут, нет арбитра, ошибка) — 'nil' (best-effort, R4).
   */
  verdict: 'same' | 'different' | 'nil';
  /** Issue, признанная дублем (только при verdict='same'). */
  matchedIssueId: string | null;
  /** cosine similarity лучшего матча (для лога/подсказки). */
  similarity: number | null;
  /** Откалиброванная уверенность арбитра. */
  confidence: number | null;
  /** Человеческое объяснение от арбитра (для подсказки человеку/лога). */
  rationale: string | null;
}

const NIL_RESULT: TaskDedupResult = {
  verdict: 'nil',
  matchedIssueId: null,
  similarity: null,
  confidence: null,
  rationale: null,
};

/**
 * TaskDedupService (TZ task-dedup, 2026-06-16, Ф1) — единый дедуп-гейт ПЕРЕД
 * записью задачи в трекер. Два уровня входа (intake + прямой create) зовут
 * один и тот же `evaluate`.
 *
 * Алгоритм:
 *   1. Синхронный embed текста кандидата (title + desc) с таймаутом
 *      `taskDedup.embedTimeoutMs`. Best-effort (R4): таймаут/ошибка → 'nil',
 *      создание НЕ блокируется, лог WARN.
 *   2. KNN среди ОТКРЫТЫХ задач (`findSimilarByVector`, openOnly).
 *   3. Лучший матч с similarity ≥ `taskDedup.suggestThreshold` →
 *      LLM-арбитр `task-dedup-arbiter` (NIL первым). Иначе — 'nil'.
 *   4. verdict='same' → возвращаем matchedIssueId (suggest). Авто-merge
 *      ЗАПРЕЩЁН (R13) — это решает вызывающий код через человека.
 *
 * Весь сервис под аварийным kill-switch `taskDedup.enabled` (default ON).
 * Любая ошибка — 'nil' (никогда не валит создание задачи).
 */
@Injectable()
export class TaskDedupService {
  private readonly logger = new Logger(TaskDedupService.name);

  /** Code-fallback'и крутилок (§7.6). Источник правды — AdminSetting. */
  private static readonly DEFAULT_SUGGEST_THRESHOLD = 0.88;
  private static readonly DEFAULT_EMBED_TIMEOUT_MS = 2500;
  /** Максимум кандидатов в промпт арбитра (человеческие заголовки). */
  private static readonly ARBITER_CANDIDATE_LIMIT = 5;
  private static readonly LLM_RETRIES = 2;

  constructor(
    @Inject(SimilarIssuesService)
    private readonly similar: SimilarIssuesService,
    @Inject(EmbeddingFallbackService)
    private readonly embeddings: EmbeddingFallbackService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(AdminSettingsService)
    private readonly settings: AdminSettingsService,
    @Optional()
    @Inject(ConfidenceCalibrationService)
    private readonly calibration?: ConfidenceCalibrationService,
  ) {}

  /**
   * Оценить кандидата на дубль среди открытых задач Org. Никогда не бросает —
   * при любом сбое возвращает NIL (создание задачи не блокируется, R4).
   */
  async evaluate(args: {
    tenantId: string;
    title: string;
    description?: string | null;
    /** Исключить из поиска (например, уже созданную задачу при уровне B). */
    excludeIssueId?: string;
  }): Promise<TaskDedupResult> {
    try {
      if (!(await this.isEnabled())) return NIL_RESULT;

      const text = this.buildText(args.title, args.description);
      if (text.length === 0) return NIL_RESULT;

      // 1. Синхронный embed с таймаутом — best-effort (R4).
      const embedding = await this.embedWithTimeout(text);
      if (!embedding) {
        // Таймаут/ошибка уже залогированы; пропускаем гейт, не блокируем.
        return NIL_RESULT;
      }

      // 2. KNN среди ОТКРЫТЫХ задач.
      const similar = await this.similar.findSimilarByVector({
        tenantId: args.tenantId,
        embedding,
        limit: TaskDedupService.ARBITER_CANDIDATE_LIMIT,
        excludeIssueId: args.excludeIssueId,
        openOnly: true,
      });
      if (similar.length === 0) return NIL_RESULT;

      // 3. Гейт по порогу: арбитра зовём, только если лучший матч близок.
      const best = similar[0]!;
      const threshold = await this.suggestThreshold();
      if (best.similarity < threshold) return NIL_RESULT;

      // 4. LLM-арбитр (NIL первым). Best-effort: сбой → NIL.
      const arbiter = await this.judge(args, similar);
      if (!arbiter || arbiter.verdict !== 'same') {
        return {
          verdict: arbiter?.verdict ?? 'nil',
          matchedIssueId: null,
          similarity: best.similarity,
          confidence: arbiter?.confidence ?? null,
          rationale: arbiter?.rationale ?? null,
        };
      }

      // verdict='same': sameWithRef — 1-based номер из переданного списка.
      const ref = arbiter.sameWithRef;
      const matched =
        ref >= 1 && ref <= similar.length ? similar[ref - 1]! : null;
      if (!matched) {
        // Арбитр сказал «дубль», но номер вне диапазона — консервативно NIL.
        this.logger.warn(
          { tenantId: args.tenantId, ref, count: similar.length },
          'task-dedup: арбитр вернул same с номером вне диапазона — NIL',
        );
        return NIL_RESULT;
      }
      const confidence = await this.calibrate(arbiter.confidence);
      return {
        verdict: 'same',
        matchedIssueId: matched.id,
        similarity: matched.similarity,
        confidence,
        rationale: arbiter.rationale,
      };
    } catch (err) {
      this.logger.warn(
        {
          tenantId: args.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'task-dedup: непредвиденная ошибка — NIL (создание не блокируется)',
      );
      return NIL_RESULT;
    }
  }

  // ─────────────────────────── helpers ─────────────────────────────────────

  private async isEnabled(): Promise<boolean> {
    const v = await this.settings
      .get<boolean>('taskDedup.enabled')
      .catch(() => undefined);
    return v ?? true; // kill-switch, default ON (Ship-On)
  }

  private async suggestThreshold(): Promise<number> {
    const v = await this.settings
      .get<number>('taskDedup.suggestThreshold')
      .catch(() => undefined);
    return typeof v === 'number' && Number.isFinite(v)
      ? v
      : TaskDedupService.DEFAULT_SUGGEST_THRESHOLD;
  }

  private async embedTimeoutMs(): Promise<number> {
    const v = await this.settings
      .get<number>('taskDedup.embedTimeoutMs')
      .catch(() => undefined);
    return typeof v === 'number' && Number.isFinite(v) && v > 0
      ? v
      : TaskDedupService.DEFAULT_EMBED_TIMEOUT_MS;
  }

  /** Текст для embedding'а: title + (description, обрезано). */
  private buildText(title: string, description?: string | null): string {
    const t = (title ?? '').trim();
    const d = (description ?? '').trim();
    if (!d) return t;
    return `${t}\n\n${d.slice(0, 500)}`;
  }

  /**
   * Embed одного текста с таймаутом. Возвращает pgvector text-литерал
   * `'[v1,v2,...]'` или null (таймаут/ошибка/пустой вектор). Best-effort (R4).
   */
  private async embedWithTimeout(text: string): Promise<string | null> {
    const timeoutMs = await this.embedTimeoutMs();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`embed timeout ${timeoutMs}ms`)),
          timeoutMs,
        );
      });
      const vectors = await Promise.race([
        this.embeddings.embed([text]),
        timeout,
      ]);
      const vector = vectors[0];
      if (!vector || vector.length === 0) return null;
      return `[${vector.join(',')}]`;
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'task-dedup: embed кандидата не посчитался — пропуск гейта (R4)',
      );
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * LLM-арбитр дедупа. Зеркалит meeting-task-dedupe: retry×2 + tryParseJson +
   * Zod. Любая неудача после ретраев → null (вызывающий трактует как NIL).
   */
  private async judge(
    args: { tenantId: string; title: string; description?: string | null },
    similar: ReadonlyArray<{ title: string }>,
  ): Promise<{
    verdict: 'nil' | 'same' | 'different';
    sameWithRef: number;
    confidence: number;
    rationale: string;
  } | null> {
    const userMessage = TASK_DEDUP_ARBITER_USER_TEMPLATE({
      candidate: { title: args.title, description: args.description },
      similar: similar.map((s) => ({ title: s.title })),
    });

    for (let attempt = 0; attempt < TaskDedupService.LLM_RETRIES; attempt++) {
      try {
        const out = await this.llm.call({
          taskType: 'task-dedup-arbiter',
          tenantId: args.tenantId,
          systemPrompt: withInjectionGuard(TASK_DEDUP_ARBITER_SYSTEM_PROMPT),
          userMessage: wrapUserData(userMessage),
          responseFormat: {
            type: 'json_schema',
            name: TASK_DEDUP_ARBITER_SCHEMA_NAME,
            strict: true,
            schema: TASK_DEDUP_ARBITER_JSON_SCHEMA,
          },
          dataClass: 'internal',
          validate: (text) => this.parse(text) !== null,
        });
        const parsed = this.parse(out.text);
        if (parsed) return parsed;
      } catch (err) {
        this.logger.warn(
          {
            tenantId: args.tenantId,
            attempt,
            err: err instanceof Error ? err.message : String(err),
          },
          'task-dedup: LLM-арбитр упал — повтор',
        );
      }
    }
    return null;
  }

  private parse(text: string): {
    verdict: 'nil' | 'same' | 'different';
    sameWithRef: number;
    confidence: number;
    rationale: string;
  } | null {
    const raw = tryParseJson(text);
    const parsed = TaskDedupArbiterResponseSchema.safeParse(raw);
    if (!parsed.success) return null;
    return parsed.data;
  }

  private async calibrate(raw: number): Promise<number> {
    if (!this.calibration) return raw;
    try {
      return await this.calibration.calibrate(raw, 'task-dedup-arbiter');
    } catch {
      return raw;
    }
  }
}
