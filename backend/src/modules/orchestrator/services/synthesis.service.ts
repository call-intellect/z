import { Inject, Injectable, Logger } from '@nestjs/common';

import { LlmRouterService } from '../../ai/services/llm-router.service';
import type {
  OrchestratorPlanStep,
  OrchestratorSubagentResult,
  OrchestratorSynthesis,
} from '../orchestrator.types';

@Injectable()
export class SynthesisService {
  private readonly logger = new Logger(SynthesisService.name);

  constructor(@Inject(LlmRouterService) private readonly llm: LlmRouterService) {}

  async synthesize(args: {
    task: string;
    tenantId: string;
    userId: string;
    results: Array<{
      step: OrchestratorPlanStep;
      result: OrchestratorSubagentResult;
    }>;
  }): Promise<OrchestratorSynthesis> {
    const usedSteps = args.results.map((r) => r.step.stepIndex);
    const allCitations: OrchestratorSynthesis['citations'] = [];
    for (const r of args.results) {
      for (const c of r.result.citations ?? []) {
        allCitations.push(c);
      }
    }
    const dedupedCitations = Array.from(
      new Map(allCitations.map((c) => [`${c.type}:${c.id}`, c])).values(),
    );

    const systemPrompt = [
      'Ты — финальный синтезатор multi-agent research для AI-системы корпоративной памяти.',
      'На вход — исходный запрос пользователя + результаты работы subagent-ов.',
      'Твоя задача — собрать СВЯЗНЫЙ, СТРУКТУРИРОВАННЫЙ ответ на исходный запрос.',
      '',
      'Правила:',
      '  - НЕ копируй subagent-ответы дословно — переплавляй в единый текст.',
      '  - Если subagent-ы противоречат друг другу — явно отметь.',
      '  - В конце — 1-2 предложения вывода («что это значит для компании»).',
      '  - Используй markdown (заголовки, списки).',
      '  - Не выдумывай факты, которых нет в subagent-результатах.',
    ].join('\n');

    const userMessage = [
      `Исходный запрос: ${args.task}`,
      '',
      '=== РЕЗУЛЬТАТЫ SUBAGENT-ОВ ===',
      ...args.results.map((r, i) =>
        [
          `--- Subagent ${i + 1} (${r.step.agentType}; ${r.step.description}) ---`,
          r.result.text,
          r.result.confidence !== undefined
            ? `(self-confidence: ${r.result.confidence.toFixed(2)})`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
      ),
      '',
      'Финальный ответ:',
    ].join('\n');

    let text: string;
    try {
      const out = await this.llm.call({
        taskType: 'orchestrator-synthesize',
        systemPrompt,
        userMessage,
        tenantId: args.tenantId,
        userId: args.userId,
        maxTokens: 2500,
      });
      text = out.text.trim();
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'synthesis: LLM failed — fallback to concat',
      );
      text = this.fallbackConcat(args);
    }

    if (!text || text.length < 10) {
      text = this.fallbackConcat(args);
    }

    return {
      text: text.slice(0, 8000),
      citations: dedupedCitations,
      usedSteps,
    };
  }

  private fallbackConcat(args: {
    task: string;
    results: Array<{
      step: OrchestratorPlanStep;
      result: OrchestratorSubagentResult;
    }>;
  }): string {
    const blocks = args.results.map((r) => `## ${r.step.description}\n${r.result.text}`);
    return [
      `# Результат: ${args.task}`,
      '',
      '> LLM-синтез временно недоступен; ниже — необработанные результаты subagent-ов.',
      '',
      ...blocks,
    ].join('\n\n');
  }
}
