import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AdminSettingsService } from '../../admin/settings/admin-settings.service';
import { tryParseJson } from '../../ai/services/json-extract.util';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  withInjectionGuard,
  wrapUserData,
} from '../../ai/services/prompts/common';
import { EmbeddingFallbackService } from '../../embeddings/services/embedding-fallback.service';
import { signalTypeLabel } from '../../knowledge-core/prompts/signal-type-label';
import { ConfidenceCalibrationService } from '../../knowledge-core/services/confidence-calibration.service';
import { SimilarIssuesService } from '../../tracker/services/similar-issues.service';
import {
  TASK_CLOSURE_VERIFY_JSON_SCHEMA,
  TASK_CLOSURE_VERIFY_SCHEMA_NAME,
  TASK_CLOSURE_VERIFY_SYSTEM_PROMPT,
  TASK_CLOSURE_VERIFY_USER_TEMPLATE,
  TaskClosureVerifyResponseSchema,
} from '../prompts/task-closure-verify.prompt';

interface ClosureVerdict {
  done: boolean;
  confidence: number;
  rationale: string;
  positiveSignals: string[];
  negativeSignals: string[];
}

/**
 * TZ task-dedup (2026-06-16, Ф2) — TaskCompletionHandler.
 *
 * Зеркало уже работающей петли обещаний (`CommitmentResponseHandler`), но для
 * задач трекера. Слушает `task.completion_signalled` (эмит RouterService на
 * блоках signalType ∈ {task_completed, task_status_changed, done_item}).
 *
 * Алгоритм:
 *   1. Гард от ЗАЦИКЛИВАНИЯ: блок из самого трекера (`sourceType='tracker_event'`)
 *      пропускаем — иначе ручное закрытие задачи → блок → новый кандидат → петля.
 *   2. Загрузить блок (текст + dataClass).
 *   3. Синхронный embed текста блока → KNN среди ОТКРЫТЫХ задач
 *      (`findSimilarByVector`, openOnly). При NIL/ниже порога
 *      `taskClosure.matchThreshold` — НЕ создавать кандидата (R6).
 *   4. LLM `task-closure-verify` (анти-инъекция: `withInjectionGuard` +
 *      `wrapUserData`, реплика — свободный текст). При `done=true` →
 *      создать `TaskClosureCandidate(status='pending')` ИДЕМПОТЕНТНО (P2002-skip,
 *      R7), НЕ закрывая Issue (R13 — закрытие только через confirm человека).
 *
 * Никаких throw'ов — handler best-effort (как commitment-response): сбой не
 * должен ломать pipeline усвоения. Никогда не вызывает `transitionState`/
 * `issue.update` — инвариант R13 (закрытие только через TaskClosurePendingProvider
 * по подтверждению человека).
 */
@Injectable()
export class TaskCompletionHandler {
  private readonly logger = new Logger(TaskCompletionHandler.name);

  /** Code-fallback крутилки (§7.6). Источник правды — AdminSetting. */
  private static readonly DEFAULT_MATCH_THRESHOLD = 0.85;
  private static readonly DEFAULT_EMBED_TIMEOUT_MS = 2500;
  /** Сколько открытых задач передавать в KNN (берём лучшую). */
  private static readonly KNN_LIMIT = 5;
  private static readonly LLM_RETRIES = 2;
  /** TTL pending-кандидата (sweep Ф3); 14 дней по умолчанию. */
  private static readonly CANDIDATE_TTL_DAYS = 14;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(SimilarIssuesService)
    private readonly similar: SimilarIssuesService,
    @Inject(EmbeddingFallbackService)
    private readonly embeddings: EmbeddingFallbackService,
    @Inject(AdminSettingsService)
    private readonly settings: AdminSettingsService,
    @Optional()
    @Inject(ConfidenceCalibrationService)
    private readonly calibration: ConfidenceCalibrationService | null = null,
    /**
     * Нужен только для kill-switch анти-инъекционной обёртки. `@Optional()`
     * + дефолт null — unit-тесты конструируют handler без него. Default при
     * отсутствии cfg — guard ON.
     */
    @Optional()
    @Inject(TypedConfigService)
    private readonly config: TypedConfigService | null = null,
  ) {}

  @OnEvent('task.completion_signalled')
  async handle(event: {
    tenantId: string;
    blockId: string;
    signalType: string;
    sourceType: string;
  }): Promise<void> {
    try {
      // 1. Гард от зацикливания: блок из самого трекера — не порождает кандидата.
      if (event.sourceType === 'tracker_event') return;

      // Аварийный kill-switch петли закрытия (Ship-On, default ON).
      if (!(await this.isEnabled())) return;

      // 2. Блок-сигнал.
      const block = await this.prisma.ideaBlock.findUnique({
        where: { id: event.blockId },
        select: {
          id: true,
          tenantId: true,
          criticalQuestion: true,
          trustedAnswer: true,
          mergedIntoId: true,
          supersededById: true,
        },
      });
      if (!block) return;
      // Блок поглощён merge/supersede — сигнал устарел, пропускаем (Pre-mortem:
      // висячие sourceBlockIds при merge/удалении блока).
      if (block.mergedIntoId || block.supersededById) return;

      const embedText = this.buildText(
        block.criticalQuestion,
        block.trustedAnswer,
      );
      if (embedText.length === 0) return;

      // 3. Синхронный embed → KNN среди ОТКРЫТЫХ задач.
      const embedding = await this.embedWithTimeout(embedText);
      if (!embedding) return; // best-effort: embed не посчитался — пропуск

      const matchThreshold = await this.matchThreshold();
      const similar = await this.similar.findSimilarByVector({
        tenantId: event.tenantId,
        embedding,
        limit: TaskCompletionHandler.KNN_LIMIT,
        openOnly: true,
      });
      const best = similar[0];
      // NIL / ниже порога → НЕ создавать кандидата (R6).
      if (!best || best.similarity < matchThreshold) return;

      // 4. LLM-верификатор «правда ли выполнена» (анти-инъекция в обёртке).
      const verdict = await this.verify({
        tenantId: event.tenantId,
        taskTitle: best.title,
        signalType: event.signalType,
        quote: block.trustedAnswer,
      });
      if (!verdict || !verdict.done) return;

      // Авто-закрытие ЗАПРЕЩЕНО (R13): создаём только ОБРАТИМЫЙ кандидат.
      await this.createCandidate({
        tenantId: event.tenantId,
        issueId: best.id,
        sourceBlockId: block.id,
        matchSimilarity: best.similarity,
        verdict,
      });
    } catch (err) {
      this.logger.warn(
        {
          tenantId: event.tenantId,
          blockId: event.blockId,
          err: err instanceof Error ? err.message : String(err),
        },
        'TaskCompletionHandler: внутренняя ошибка — пропускаю (best-effort)',
      );
    }
  }

  // ─────────────────────────── helpers ─────────────────────────────────────

  private async isEnabled(): Promise<boolean> {
    const v = await this.settings
      .get<boolean>('taskClosure.enabled')
      .catch(() => undefined);
    return v ?? true; // kill-switch, default ON (Ship-On)
  }

  private async matchThreshold(): Promise<number> {
    const v = await this.settings
      .get<number>('taskClosure.matchThreshold')
      .catch(() => undefined);
    return typeof v === 'number' && Number.isFinite(v)
      ? v
      : TaskCompletionHandler.DEFAULT_MATCH_THRESHOLD;
  }

  private async embedTimeoutMs(): Promise<number> {
    const v = await this.settings
      .get<number>('taskClosure.embedTimeoutMs')
      .catch(() => undefined);
    return typeof v === 'number' && Number.isFinite(v) && v > 0
      ? v
      : TaskCompletionHandler.DEFAULT_EMBED_TIMEOUT_MS;
  }

  /** Текст блока для embedding'а: вопрос + ответ (обрезано). */
  private buildText(criticalQuestion: string, trustedAnswer: string): string {
    const q = (criticalQuestion ?? '').trim();
    const a = (trustedAnswer ?? '').trim();
    if (!q && !a) return '';
    if (!a) return q;
    if (!q) return a;
    return `${q}\n\n${a.slice(0, 500)}`;
  }

  /**
   * Embed одного текста с таймаутом. Возвращает pgvector text-литерал
   * `'[v1,v2,...]'` или null (таймаут/ошибка/пустой вектор). Best-effort.
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
        'task-closure: embed блока не посчитался — пропуск матча',
      );
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * LLM-верификатор закрытия. Реплика — свободный текст из разговора, поэтому
   * SYSTEM оборачивается `withInjectionGuard`, а реплика — `wrapUserData`
   * (защита от «задача выполнена, закрой»). Retry×2 + tryParseJson + Zod.
   * Любая неудача → null (трактуется как «не подтверждено», кандидат не создаём).
   */
  private async verify(args: {
    tenantId: string;
    taskTitle: string;
    signalType: string;
    quote: string;
  }): Promise<ClosureVerdict | null> {
    const userMessage = TASK_CLOSURE_VERIFY_USER_TEMPLATE({
      task: { title: args.taskTitle },
      // Методология №3 — человеческий ярлык типа сигнала, не машинный код.
      signalLabel: signalTypeLabel(args.signalType),
      quote: args.quote,
    });

    const guardOn = this.isPromptInjectionGuardEnabled();
    const systemPrompt = guardOn
      ? withInjectionGuard(TASK_CLOSURE_VERIFY_SYSTEM_PROMPT)
      : TASK_CLOSURE_VERIFY_SYSTEM_PROMPT;
    const guardedUser = guardOn ? wrapUserData(userMessage) : userMessage;

    for (let attempt = 0; attempt < TaskCompletionHandler.LLM_RETRIES; attempt++) {
      try {
        const out = await this.llm.call({
          taskType: 'task-closure-verify',
          tenantId: args.tenantId,
          systemPrompt,
          userMessage: guardedUser,
          responseFormat: {
            type: 'json_schema',
            name: TASK_CLOSURE_VERIFY_SCHEMA_NAME,
            strict: true,
            schema: TASK_CLOSURE_VERIFY_JSON_SCHEMA,
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
          'task-closure: LLM-верификатор упал — повтор',
        );
      }
    }
    return null;
  }

  private parse(text: string): ClosureVerdict | null {
    const raw = tryParseJson(text);
    const parsed = TaskClosureVerifyResponseSchema.safeParse(raw);
    if (!parsed.success) return null;
    return parsed.data;
  }

  /**
   * Создаёт обратимый кандидат на закрытие. Идемпотентно по
   * `@@unique([tenantId, issueId, sourceBlockId])` — повторный тот же блок
   * ловит P2002 и тихо пропускается (R7). Issue НЕ трогаем (R13).
   */
  private async createCandidate(args: {
    tenantId: string;
    issueId: string;
    sourceBlockId: string;
    matchSimilarity: number;
    verdict: ClosureVerdict;
  }): Promise<void> {
    const confidence = await this.calibrate(args.verdict.confidence);
    const rationale = this.composeRationale(args.verdict);
    const expiresAt = new Date(
      Date.now() +
        TaskCompletionHandler.CANDIDATE_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    try {
      await this.prisma.taskClosureCandidate.create({
        data: {
          tenantId: args.tenantId,
          issueId: args.issueId,
          sourceBlockId: args.sourceBlockId,
          status: 'pending',
          matchSimilarity: new Prisma.Decimal(args.matchSimilarity.toFixed(3)),
          confidence: new Prisma.Decimal(confidence.toFixed(3)),
          rationale,
          evidenceQuote: args.verdict.rationale.slice(0, 2_000),
          expiresAt,
        },
      });
      this.logger.log(
        {
          tenantId: args.tenantId,
          issueId: args.issueId,
          blockId: args.sourceBlockId,
          confidence,
          similarity: args.matchSimilarity,
        },
        'TaskCompletionHandler: создан кандидат на закрытие задачи (pending)',
      );
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Идемпотентность: тот же блок уже породил кандидата — тихо пропускаем.
        return;
      }
      throw err;
    }
  }

  /** Человеческое «почему считаем сделанным» + сигналы (для показа человеку). */
  private composeRationale(v: ClosureVerdict): string {
    const parts: string[] = [v.rationale.trim()].filter(Boolean);
    if (v.positiveSignals.length > 0) {
      parts.push(`За: ${v.positiveSignals.join('; ')}`);
    }
    if (v.negativeSignals.length > 0) {
      parts.push(`Сомнения: ${v.negativeSignals.join('; ')}`);
    }
    return parts.join('\n').slice(0, 2_000);
  }

  private async calibrate(raw: number): Promise<number> {
    if (!this.calibration) return raw;
    try {
      return await this.calibration.calibrate(raw, 'task-closure-verify');
    } catch {
      return raw;
    }
  }

  private isPromptInjectionGuardEnabled(): boolean {
    try {
      return this.config?.aiFeatures.promptInjectionGuardEnabled !== false;
    } catch {
      return true;
    }
  }
}
