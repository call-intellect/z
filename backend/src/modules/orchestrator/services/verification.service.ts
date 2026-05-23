import { Inject, Injectable, Logger } from '@nestjs/common';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import type {
  OrchestratorSynthesis,
  OrchestratorVerification,
} from '../orchestrator.types';

/**
 * SBA δ-1 — VerificationService.
 *
 * LLM-step (taskType='orchestrator-verify'): оценить, соответствует ли
 * synthesis исходному запросу. На выход — confidence 0..1 + reasoning.
 *
 * Если < 0.6 — инкрементит метрику. Re-try логика живёт на стороне
 * OrchestratorService (max 1 retry, см. ТЗ §3.4).
 */
@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  async verify(args: {
    task: string;
    synthesis: OrchestratorSynthesis;
    tenantId: string;
    userId: string;
    retried: boolean;
  }): Promise<OrchestratorVerification> {
    const systemPrompt = [
      'Ты — верификатор multi-agent research для AI-системы корпоративной памяти.',
      'На вход — исходный запрос пользователя и synthesis-ответ.',
      'Твоя задача — оценить, насколько synthesis отвечает на исходный запрос:',
      '  - точно по теме,',
      '  - структурирован,',
      '  - не противоречит сам себе,',
      '  - не выдумывает данных.',
      '',
      'Верни строго JSON, без markdown:',
      '{',
      '  "confidence": 0.0..1.0,',
      '  "reasoning": "<1-2 предложения, почему именно такая оценка>"',
      '}',
    ].join('\n');

    const userMessage = [
      `Исходный запрос: ${args.task}`,
      '',
      '=== SYNTHESIS ===',
      args.synthesis.text.slice(0, 6000),
      '',
      `Citations: ${args.synthesis.citations.length} ссылок.`,
    ].join('\n');

    let raw: string;
    try {
      const out = await this.llm.call({
        taskType: 'orchestrator-verify',
        systemPrompt,
        userMessage,
        tenantId: args.tenantId,
        userId: args.userId,
        maxTokens: 300,
        responseFormat: { type: 'json_object' },
      });
      raw = out.text;
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'verification: LLM failed — assume confidence=0.5',
      );
      return {
        confidence: 0.5,
        reasoning: 'Верификатор временно недоступен; принимаем условную оценку.',
        retried: args.retried,
      };
    }

    const parsed = this.tryParse(raw);
    if (parsed.confidence < 0.6) {
      this.metrics.incOrchestratorVerificationLowConfidence();
    }
    return { ...parsed, retried: args.retried };
  }

  private tryParse(raw: string): {
    confidence: number;
    reasoning: string;
  } {
    let obj: unknown;
    try {
      obj = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (!m) return { confidence: 0.5, reasoning: 'no-json fallback' };
      try {
        obj = JSON.parse(m[0]);
      } catch {
        return { confidence: 0.5, reasoning: 'parse-error fallback' };
      }
    }
    if (!obj || typeof obj !== 'object') {
      return { confidence: 0.5, reasoning: 'non-object fallback' };
    }
    const o = obj as { confidence?: unknown; reasoning?: unknown };
    let confidence = 0.5;
    if (typeof o.confidence === 'number' && o.confidence >= 0 && o.confidence <= 1) {
      confidence = o.confidence;
    } else if (typeof o.confidence === 'string') {
      const n = Number.parseFloat(o.confidence);
      if (Number.isFinite(n) && n >= 0 && n <= 1) confidence = n;
    }
    const reasoning =
      typeof o.reasoning === 'string' && o.reasoning.trim().length > 0
        ? o.reasoning.trim().slice(0, 1000)
        : '(нет объяснения)';
    return { confidence, reasoning };
  }
}
