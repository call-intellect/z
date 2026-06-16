import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';


import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { PipelineRunner, SystemLogPipeline } from '../../logging/log-pipeline';
import {
  DECISION_HYGIENE_JSON_SCHEMA,
  DECISION_HYGIENE_SYSTEM_PROMPT,
  type DecisionHygieneAlternative,
  buildDecisionHygieneUserMessage,
  parseDecisionHygieneResponse,
} from '../prompts/decision-hygiene.prompt';
import {
  DASHBOARD_QUEUE_NAMES,
  type DecisionHygieneJobData,
} from '../queues';

/**
 * Pulse Wave 6 §6.8 — Decision-Hygiene-Scorer.
 *
 * Источник: plans/tz/2026-05-30-pulse-full.md §6.8.
 *
 * Event-driven worker (`dashboard.decision-hygiene`). Producer —
 * `Specialist33DecisionsWorker` после `processBlock` (новый Decision создан
 * или поднялось raisedCount у существующего). Также может вызываться
 * вручную через `DashboardQueueService.enqueueDecisionHygiene`.
 *
 * Логика на одно Decision:
 *   1. Read Decision. Если `reversibility !== null` — skip (идемпотентно,
 *      повторный вердикт не считаем; если нужно пересчитать — снимать null
 *      вручную через admin).
 *   2. LLM-вызов `decision-hygiene` (cache-friendly промпт): на входе
 *      statement + rationale + alternatives; на выходе `{reversibility,
 *      rationale}` JSON-strict.
 *   3. Если ответ невалиден / LLM упал — лог warning, поле не обновляется
 *      (BullMQ retry'нет с экспоненциальным backoff'ом).
 *   4. На type-1: проверяем наличие IdeaBlock'а с signalType='decision_basis'
 *      среди sourceBlockIds — если нет, лог warning «type-1 без альтернатив».
 *      Виджет на главной добавится отдельным шагом C.3.
 */
@Injectable()
export class DecisionHygieneScorerWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DecisionHygieneScorerWorker.name);
  private worker: Worker<DecisionHygieneJobData> | null = null;

  @Inject(PipelineRunner)
  private readonly pipe!: PipelineRunner;

  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<DecisionHygieneJobData>(
      DASHBOARD_QUEUE_NAMES.DECISION_HYGIENE,
      async (job) =>
        this.pipe.job(SystemLogPipeline.AI_ANALYSIS, 'dashboard.decision-hygiene', job, () =>
          this.process(job),
        ),
      {
        connection: this.redis.client,
        concurrency: 2,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        {
          decisionId: job?.data?.decisionId,
          attempt: job?.attemptsMade,
          err: err?.message,
        },
        'decision-hygiene-scorer: job failed (повтор по политике BullMQ)',
      );
    });
    this.logger.debug(
      `DecisionHygieneScorerWorker запущен (${DASHBOARD_QUEUE_NAMES.DECISION_HYGIENE})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
  }

  /**
   * Публичный handler — integration-тест вызывает напрямую без BullMQ.
   */
  async process(job: Job<DecisionHygieneJobData>): Promise<void> {
    const { decisionId, tenantId } = job.data;
    const startedAt = Date.now();

    const decision = await this.prisma.decision.findUnique({
      where: { id: decisionId },
      select: {
        id: true,
        tenantId: true,
        statement: true,
        text: true,
        rationale: true,
        alternatives: true,
        sourceBlockIds: true,
        reversibility: true,
        dataClass: true,
      },
    });
    if (!decision) {
      this.logger.warn(
        { decisionId },
        'decision-hygiene: decision не найден — skip',
      );
      return;
    }
    if (decision.tenantId !== tenantId) {
      this.logger.warn(
        { decisionId, expected: tenantId, actual: decision.tenantId },
        'decision-hygiene: tenant mismatch — skip',
      );
      return;
    }
    if (decision.reversibility !== null) {
      this.logger.debug(
        { decisionId, reversibility: decision.reversibility },
        'decision-hygiene: уже классифицирован — skip',
      );
      return;
    }

    const statement =
      decision.statement && decision.statement.trim().length > 0
        ? decision.statement
        : (decision.text ?? '').trim();
    if (statement.length === 0) {
      this.logger.warn(
        { decisionId },
        'decision-hygiene: пустой statement/text — skip',
      );
      return;
    }

    const alternatives = parseAlternatives(decision.alternatives);
    const userMessage = buildDecisionHygieneUserMessage({
      statement,
      rationale: decision.rationale,
      alternatives,
    });

    let llmText: string;
    try {
      const result = await this.llm.call({
        taskType: 'decision-hygiene',
        systemPrompt: DECISION_HYGIENE_SYSTEM_PROMPT,
        userMessage,
        tenantId: decision.tenantId,
        jobId: job.id ?? undefined,
        responseFormat: {
          type: 'json_schema',
          name: 'decision_hygiene',
          schema: DECISION_HYGIENE_JSON_SCHEMA,
          strict: true,
        },
        dataClass: decision.dataClass,
        sourceRef: { type: 'decision', id: decision.id },
      });
      llmText = result.text;
    } catch (err) {
      this.logger.warn(
        {
          decisionId,
          err: err instanceof Error ? err.message : String(err),
        },
        'decision-hygiene: LLM-вызов упал — пусть BullMQ ретрайнет',
      );
      throw err;
    }

    const parsed = parseDecisionHygieneResponse(llmText);
    if (!parsed) {
      this.logger.warn(
        {
          decisionId,
          textPreview: llmText.slice(0, 200),
        },
        'decision-hygiene: невалидный JSON от LLM — поле не обновляем',
      );
      return;
    }

    await this.prisma.decision.update({
      where: { id: decisionId },
      data: {
        reversibility: parsed.reversibility,
        reversibilityAt: new Date(),
      },
    });

    // Type-1 без явно зафиксированных оснований — отдельный warning для
    // будущего виджета «3 необратимых решения без альтернатив за неделю»
    // (Pulse Wave 6 §6.8). На сейчас — только лог.
    if (parsed.reversibility === 'type-1') {
      const hasAlternatives = Array.isArray(alternatives) && alternatives.length > 0;
      let hasBasisBlock = false;
      if (decision.sourceBlockIds.length > 0) {
        const basisCount = await this.prisma.ideaBlock.count({
          where: {
            id: { in: decision.sourceBlockIds },
            tenantId: decision.tenantId,
            signalType: 'decision_basis',
          },
        });
        hasBasisBlock = basisCount > 0;
      }
      if (!hasAlternatives && !hasBasisBlock) {
        this.logger.warn(
          { decisionId, tenantId: decision.tenantId },
          'decision-hygiene: type-1 Decision без альтернатив и decision_basis блоков',
        );
      }
    }

    this.logger.debug(
      {
        decisionId,
        reversibility: parsed.reversibility,
        durationProcessingMs: Date.now() - startedAt,
      },
      'decision-hygiene: рассчитан',
    );
  }
}

/**
 * Парсит `Decision.alternatives` (Json в БД). Поддерживает форму
 * `[{ option, reasonRejected? }, ...]`. Невалидные элементы — отбрасываем.
 */
function parseAlternatives(
  raw: unknown,
): DecisionHygieneAlternative[] | null {
  if (!Array.isArray(raw)) return null;
  const out: DecisionHygieneAlternative[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const option = r.option;
    if (typeof option !== 'string' || option.trim().length === 0) continue;
    const reasonRejected = typeof r.reasonRejected === 'string'
      ? r.reasonRejected
      : null;
    out.push({ option, reasonRejected });
  }
  return out.length > 0 ? out : null;
}
