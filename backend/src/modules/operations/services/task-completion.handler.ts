import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AdminSettingsService } from '../../admin/settings/admin-settings.service';
import { EmbeddingFallbackService } from '../../embeddings/services/embedding-fallback.service';
import { ConfidenceCalibrationService } from '../../knowledge-core/services/confidence-calibration.service';
import { SimilarIssuesService } from '../../tracker/services/similar-issues.service';

import {
  ClosureVerdict,
  ClosureVerifierService,
} from './closure-verifier.service';

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
  private static readonly DEFAULT_EMBED_MAX_ATTEMPTS = 3;
  private static readonly EMBED_RETRY_PAUSE_MS = 150;
  private static readonly DEFAULT_PROGRESS_FROM_CONVERSATION_MIN_CONFIDENCE = 0.6;
  /** Сколько открытых задач передавать в KNN (берём лучшую). */
  private static readonly KNN_LIMIT = 5;
  /** TTL pending-кандидата (sweep Ф3); 14 дней по умолчанию. */
  private static readonly DEFAULT_CANDIDATE_TTL_DAYS = 14;
  private static readonly DEFAULT_LEXICAL_FALLBACK_MIN_OVERLAP = 0.5;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ClosureVerifierService)
    private readonly closureVerifier: ClosureVerifierService,
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
    @Optional()
    @Inject(EventEmitter2)
    private readonly eventEmitter: EventEmitter2 | null = null,
    @Optional()
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService | null = null,
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
      if (event.sourceType === 'tracker_event') {
        return this.outcome('skipped_tracker', {
          tenantId: event.tenantId,
          blockId: event.blockId,
        });
      }

      // Аварийный kill-switch петли закрытия (Ship-On, default ON).
      if (!(await this.isEnabled())) {
        return this.outcome('disabled', {
          tenantId: event.tenantId,
          blockId: event.blockId,
        });
      }

      // 2. Блок-сигнал.
      const block = await this.prisma.ideaBlock.findUnique({
        where: { id_tenantId: { id: event.blockId, tenantId: event.tenantId } },
        select: {
          id: true,
          tenantId: true,
          criticalQuestion: true,
          trustedAnswer: true,
          mergedIntoId: true,
          supersededById: true,
        },
      });
      if (!block || block.mergedIntoId || block.supersededById) {
        return this.outcome('dropped_merged', {
          tenantId: event.tenantId,
          blockId: event.blockId,
        });
      }

      const embedText = this.buildText(
        block.criticalQuestion,
        block.trustedAnswer,
      );
      if (embedText.length === 0) {
        return this.outcome('no_text', {
          tenantId: event.tenantId,
          blockId: event.blockId,
        });
      }

      // 3. Синхронный embed → KNN среди ОТКРЫТЫХ задач.
      const embedding = await this.embedWithTimeout(embedText);
      if (!embedding) {
        return this.outcome('embed_fail', {
          tenantId: event.tenantId,
          blockId: event.blockId,
        });
      }

      const matchThreshold = await this.matchThreshold();
      const similar = await this.similar.findSimilarByVector({
        tenantId: event.tenantId,
        embedding,
        limit: TaskCompletionHandler.KNN_LIMIT,
        openOnly: true,
      });
      const matched = await this.pickMatch(similar, embedText, matchThreshold);
      if (!matched) {
        return this.outcome('no_match', {
          tenantId: event.tenantId,
          blockId: event.blockId,
        });
      }

      this.emitProgress(event.tenantId, matched.id, block.id);

      // 4. LLM-верификатор «правда ли выполнена» (анти-инъекция в обёртке).
      const verdict = await this.closureVerifier.verify({
        tenantId: event.tenantId,
        taskTitle: matched.title,
        signalType: event.signalType,
        quote: block.trustedAnswer,
      });
      if (!verdict || !verdict.done) {
        if (this.config?.tracker?.livingCardEnabled ?? true) {
          try {
            await this.writeConversationProgress({
              tenantId: event.tenantId,
              issueId: matched.id,
              block: {
                id: block.id,
                criticalQuestion: block.criticalQuestion,
                trustedAnswer: block.trustedAnswer,
              },
              quote: block.trustedAnswer,
              question: block.criticalQuestion,
              verdict,
              matchSimilarity: matched.similarity,
            });
          } catch (err) {
            this.logger.warn(
              {
                tenantId: event.tenantId,
                issueId: matched.id,
                blockId: block.id,
                err: err instanceof Error ? err.message : String(err),
              },
              'living-card: запись хода из разговора не удалась — пропускаю',
            );
          }
        }
        return this.outcome('not_done', {
          tenantId: event.tenantId,
          blockId: event.blockId,
        });
      }

      // Авто-закрытие ЗАПРЕЩЕНО (R13): создаём только ОБРАТИМЫЙ кандидат.
      await this.createCandidate({
        tenantId: event.tenantId,
        issueId: matched.id,
        sourceBlockId: block.id,
        matchSimilarity: matched.similarity,
        verdict,
      });
      this.metrics?.incTaskClosureOutcome({ outcome: 'created' });
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

  private outcome(
    outcome: string,
    ctx: { tenantId: string; blockId: string },
  ): void {
    this.metrics?.incTaskClosureOutcome({ outcome });
    this.logger.debug(
      { tenantId: ctx.tenantId, blockId: ctx.blockId, outcome },
      'task-closure: исход петли закрытия',
    );
  }

  /**
   * Выбор задачи-кандидата: лучший KNN ≥ порога, иначе лексический fallback по
   * перекрытию токенов названия задачи с текстом сигнала (LLM-верификатор всё
   * равно финально гейтит). null — ни одна задача не подошла.
   */
  private async pickMatch(
    similar: Array<{ id: string; title: string; similarity: number }>,
    blockText: string,
    matchThreshold: number,
  ): Promise<{ id: string; title: string; similarity: number } | null> {
    const best = similar[0];
    if (best && best.similarity >= matchThreshold) return best;
    if (!best) return null;

    const minOverlap = await this.lexicalFallbackMinOverlap();
    let bestLexical: {
      id: string;
      title: string;
      similarity: number;
    } | null = null;
    let bestOverlap = 0;
    for (const cand of similar) {
      const overlap = lexicalOverlap(blockText, cand.title);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestLexical = cand;
      }
    }
    if (bestLexical && bestOverlap >= minOverlap) {
      this.logger.debug(
        {
          issueId: bestLexical.id,
          overlap: bestOverlap,
          similarity: bestLexical.similarity,
        },
        'task-closure: лексический fallback поймал near-miss',
      );
      return bestLexical;
    }
    return null;
  }

  private emitProgress(
    tenantId: string,
    issueId: string,
    sourceBlockId: string,
  ): void {
    try {
      this.eventEmitter?.emit('task.progress_signalled', {
        tenantId,
        issueId,
        sourceBlockId,
      });
    } catch (err) {
      this.logger.warn(
        {
          tenantId,
          issueId,
          err: err instanceof Error ? err.message : String(err),
        },
        'task-closure: эмит task.progress_signalled упал (best-effort)',
      );
    }
  }

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

  private async embedMaxAttempts(): Promise<number> {
    const v = await this.settings
      .get<number>('taskClosure.embedMaxAttempts')
      .catch(() => undefined);
    return typeof v === 'number' && Number.isFinite(v) && v >= 1
      ? Math.floor(v)
      : TaskCompletionHandler.DEFAULT_EMBED_MAX_ATTEMPTS;
  }

  private async progressFromConversationMinConfidence(): Promise<number> {
    const v = await this.settings
      .get<number>('tracker.progressFromConversationMinConfidence')
      .catch(() => undefined);
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
      ? v
      : TaskCompletionHandler.DEFAULT_PROGRESS_FROM_CONVERSATION_MIN_CONFIDENCE;
  }

  private async lexicalFallbackMinOverlap(): Promise<number> {
    const v = await this.settings
      .get<number>('taskClosure.lexicalFallbackMinOverlap')
      .catch(() => undefined);
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
      ? v
      : TaskCompletionHandler.DEFAULT_LEXICAL_FALLBACK_MIN_OVERLAP;
  }

  private async candidateTtlDays(): Promise<number> {
    const v = await this.settings
      .get<number>('taskClosure.candidateTtlDays')
      .catch(() => undefined);
    return typeof v === 'number' && Number.isFinite(v) && v > 0
      ? v
      : TaskCompletionHandler.DEFAULT_CANDIDATE_TTL_DAYS;
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

  private async embedWithTimeout(text: string): Promise<string | null> {
    const timeoutMs = await this.embedTimeoutMs();
    const maxAttempts = await this.embedMaxAttempts();
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const vector = await this.embedOnce(text, timeoutMs);
        if (!vector || vector.length === 0) return null;
        return `[${vector.join(',')}]`;
      } catch (err) {
        lastErr = err;
        if (attempt < maxAttempts) {
          this.logger.debug(
            {
              attempt,
              maxAttempts,
              err: err instanceof Error ? err.message : String(err),
            },
            'task-closure: embed блока сбоил — ретрай',
          );
          await this.pause(TaskCompletionHandler.EMBED_RETRY_PAUSE_MS);
        }
      }
    }
    this.logger.warn(
      { err: lastErr instanceof Error ? lastErr.message : String(lastErr) },
      'task-closure: embed блока не посчитался — пропуск матча',
    );
    return null;
  }

  private async embedOnce(
    text: string,
    timeoutMs: number,
  ): Promise<number[] | undefined> {
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
      return vectors[0];
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private pause(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
    const ttlDays = await this.candidateTtlDays();
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
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

  private async writeConversationProgress(args: {
    tenantId: string;
    issueId: string;
    block: { id: string; criticalQuestion: string; trustedAnswer: string };
    quote: string;
    question: string;
    verdict: ClosureVerdict | null;
    matchSimilarity: number;
  }): Promise<boolean> {
    const existing = await this.prisma.issueProgressUpdate.findFirst({
      where: {
        issueId: args.issueId,
        tenantId: args.tenantId,
        sourceBlockIds: { has: args.block.id },
      },
      select: { id: true },
    });
    if (existing) return false;

    const conf =
      typeof args.verdict?.confidence === 'number' &&
      Number.isFinite(args.verdict.confidence)
        ? args.verdict.confidence
        : args.matchSimilarity;
    const minConfidence = await this.progressFromConversationMinConfidence();
    if (conf < minConfidence) return false;

    const quote = (args.quote ?? '').trim();
    const health = this.conversationProgressHealth(args.verdict);
    const doneText = quote.slice(0, 2_000);
    const body = `Из разговора: ${quote}`.slice(0, 2_000);

    await this.prisma.issueProgressUpdate.create({
      data: {
        tenantId: args.tenantId,
        issueId: args.issueId,
        authorType: 'ai_agent',
        draftState: 'pending',
        health,
        doneText,
        nextText: null,
        body,
        sourceBlockIds: [args.block.id],
        evidenceQuote: quote.slice(0, 2_000),
        confidence: new Prisma.Decimal(conf.toFixed(3)),
        previewQuote: quote.slice(0, 500),
        previewSourceRef: Prisma.JsonNull,
      },
    });
    return true;
  }

  private conversationProgressHealth(verdict: ClosureVerdict | null): string {
    if (!verdict) return 'on_track';
    if (hasBlockerSignal(verdict.negativeSignals)) return 'at_risk';
    return 'on_track';
  }

  private async calibrate(raw: number): Promise<number> {
    if (!this.calibration) return raw;
    try {
      return await this.calibration.calibrate(raw, 'task-closure-verify');
    } catch {
      return raw;
    }
  }
}

const BLOCKER_MARKERS = [
  'блок',
  'заблок',
  'не получается',
  'не смог',
  'не удалось',
  'застрял',
  'ждём',
  'ждем',
  'ожидаем',
  'мешает',
  'препятств',
  'риск',
];

function hasBlockerSignal(negativeSignals: string[]): boolean {
  if (!Array.isArray(negativeSignals) || negativeSignals.length === 0) {
    return false;
  }
  const joined = negativeSignals
    .join(' ')
    .toLowerCase()
    .replace(/ё/g, 'е');
  return BLOCKER_MARKERS.some((marker) => joined.includes(marker));
}

function tokenize(text: string): Set<string> {
  const normalized = (text ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[^\p{L}\p{N}]+/u);
  const tokens = new Set<string>();
  for (const t of normalized) {
    if (t.length >= 3) tokens.add(t);
  }
  return tokens;
}

export function lexicalOverlap(blockText: string, title: string): number {
  const titleTokens = tokenize(title);
  if (titleTokens.size === 0) return 0;
  const blockTokens = tokenize(blockText);
  let hit = 0;
  for (const t of titleTokens) {
    if (blockTokens.has(t)) hit++;
  }
  return hit / titleTokens.size;
}
