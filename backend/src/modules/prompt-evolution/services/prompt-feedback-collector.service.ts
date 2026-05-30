import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { EmbeddingFallbackService } from '../../embeddings/services/embedding-fallback.service';

/**
 * Agents v2 Фаза B1 (2026-05-30) — PromptFeedbackCollectorService.
 *
 * Слушает события AI-вызовов:
 *   - `ai.invocation.completed` — каждый успешный LLM-вызов LlmRouter'а.
 *     Создаёт `PromptFeedback{originalOutput, editedOutput=null}`,
 *     вычисляет `inputDigest` (sha256 short) и опц. `inputEmbedding`
 *     (через EmbeddingFallbackService).
 *   - `ai.invocation.edited` — когда пользователь правит AI-output (Wave Б+).
 *     В Фазе B1 эмит редактирования ОТЛОЖЕН — TODO в handler'е ниже.
 *
 * Дедуп: уникальный `invocationId` (один LLM-вызов = один PromptFeedback).
 * Защита от race в эмиттере.
 *
 * Метрика `z_prompt_feedback_total{promptKey, has_edit}` инкрементируется
 * при каждом successful create / update.
 */
@Injectable()
export class PromptFeedbackCollectorService {
  private readonly logger = new Logger(PromptFeedbackCollectorService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BusinessMetricsService) private readonly metrics: BusinessMetricsService,
    // @Global EmbeddingsModule экспортирует EmbeddingFallbackService.
    // Optional — чтобы unit-тесты могли поднимать сервис без эмбеддингов.
    @Optional()
    @Inject(EmbeddingFallbackService)
    private readonly embeddings?: EmbeddingFallbackService,
  ) {}

  @OnEvent('ai.invocation.completed')
  async handleInvocationCompleted(event: AiInvocationCompletedEvent): Promise<void> {
    try {
      // Запись feedback'а — best-effort. Если что-то падает, не блокируем
      // главный pipeline.
      const inputText = `${event.input.systemPrompt}\n---\n${event.input.userMessage}`;
      const inputDigest = sha256short(inputText);

      // Попробуем сразу embed input. Если EmbeddingFallbackService недоступен
      // или упал — пишем без эмбеддинга (KNN-группировка свалится в fallback
      // по `inputDigest === inputDigest` в autorule-extractor).
      let embeddingVector: number[] | null = null;
      if (this.embeddings) {
        try {
          const [vec] = await this.embeddings.embed([inputText.slice(0, 8000)]);
          embeddingVector = vec ?? null;
        } catch (err) {
          this.logger.debug(
            `embed failed для invocation=${event.invocationId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // upsert по invocationId — защита от двойного эмита одного вызова.
      const existing = await this.prisma.promptFeedback.findUnique({
        where: { invocationId: event.invocationId },
      });
      if (existing) {
        // На completed второй раз — игнорируем (значит уже записали).
        return;
      }

      await this.prisma.promptFeedback.create({
        data: {
          tenantId: event.tenantId,
          promptKey: event.promptKey,
          promptVersion: event.promptVersion,
          invocationId: event.invocationId,
          inputDigest,
          originalOutput: event.output,
        },
      });

      // Эмбеддинг — отдельным raw-update'ом (Prisma не умеет vector в create).
      if (embeddingVector && embeddingVector.length === 1536) {
        try {
          await this.prisma.$executeRawUnsafe(
            `UPDATE "PromptFeedback" SET "inputEmbedding" = $1::vector WHERE "invocationId" = $2`,
            `[${embeddingVector.join(',')}]`,
            event.invocationId,
          );
        } catch (err) {
          this.logger.debug(
            `Embedding update failed для invocation=${event.invocationId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      this.metrics.incPromptFeedback({
        promptKey: event.promptKey,
        hasEdit: 'false',
      });
    } catch (err) {
      this.logger.warn(
        {
          invocationId: event.invocationId,
          err: err instanceof Error ? err.message : String(err),
        },
        'handleInvocationCompleted: пропускаю запись (best-effort)',
      );
    }
  }

  /**
   * Agents v2 Фаза B1 — handleInvocationEdited.
   *
   * TODO: editedOutput collection требует backend-связки edited UI fields ↔ invocationId.
   * Сейчас места правок (Meeting.summary, AiResult.fields, Card.* и т.п.) НЕ
   * проставляют invocationId, поэтому мы не знаем, к какому LLM-вызову относится
   * правка. Решение — Фаза B1.1: добавить колонку `lastLlmInvocationId` на
   * editable AI-генерируемые поля + эмит после update.
   *
   * См. plans/tz/2026-05-29-agents-v2-umbrella.md §B1 — «Сбор feedback» п.2.
   *
   * Method is wired как event listener чтобы downstream-эмиттер можно было
   * добавить инкрементально без перерегистрации модуля.
   */
  @OnEvent('ai.invocation.edited')
  async handleInvocationEdited(event: AiInvocationEditedEvent): Promise<void> {
    try {
      const fb = await this.prisma.promptFeedback.findUnique({
        where: { invocationId: event.invocationId },
      });
      if (!fb) {
        // Edit пришёл без оригинального feedback'а — пропускаем без шума.
        // Это нормально в первые дни после релиза (старые вызовы не имели
        // PromptFeedback-записи).
        return;
      }
      const editDistance = normalizedLevenshtein(fb.originalOutput, event.editedOutput);
      await this.prisma.promptFeedback.update({
        where: { id: fb.id },
        data: {
          editedOutput: event.editedOutput,
          editDistance,
          editedAt: new Date(),
          editedByUserId: event.editedByUserId,
          ...(event.downstreamSignals
            ? { downstreamSignals: event.downstreamSignals as object }
            : {}),
        },
      });
      this.metrics.incPromptFeedback({
        promptKey: fb.promptKey,
        hasEdit: 'true',
      });
    } catch (err) {
      this.logger.warn(
        {
          invocationId: event.invocationId,
          err: err instanceof Error ? err.message : String(err),
        },
        'handleInvocationEdited: пропускаю update (best-effort)',
      );
    }
  }
}

// ─────────────────────────── Events shape ──────────────────────────────────

export interface AiInvocationCompletedEvent {
  invocationId: string;
  tenantId: string;
  promptKey: string;
  promptVersion: string;
  input: { systemPrompt: string; userMessage: string };
  output: string;
}

export interface AiInvocationEditedEvent {
  invocationId: string;
  editedOutput: string;
  editedByUserId: string | null;
  downstreamSignals?: Record<string, unknown>;
}

// ─────────────────────────── helpers ──────────────────────────────────────

function sha256short(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Нормализованное расстояние Левенштейна 0..1 (0 = идентичные, 1 = совсем разные).
 * Простая O(n*m) реализация — для коротких output'ов (до ~5000 символов) ок.
 * Для очень длинных текстов truncate'им до 4000 символов с обеих сторон.
 */
function normalizedLevenshtein(a: string, b: string): number {
  const MAX = 4000;
  const s1 = a.length > MAX ? a.slice(0, MAX) : a;
  const s2 = b.length > MAX ? b.slice(0, MAX) : b;
  if (s1.length === 0 && s2.length === 0) return 0;
  if (s1.length === 0 || s2.length === 0) return 1;
  const dist = levenshtein(s1, s2);
  return Math.min(1, dist / Math.max(s1.length, s2.length));
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // dp[i] = расстояние до b[0..i]; обновляем in-place.
  let prev: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  let curr: number[] = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        (curr[j - 1] ?? 0) + 1,
        (prev[j] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n] ?? 0;
}
