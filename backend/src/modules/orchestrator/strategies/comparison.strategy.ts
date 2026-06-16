import { Injectable } from '@nestjs/common';

import type { OrchestratorPlanStep } from '../orchestrator.types';

import { BaseRetrievalStrategy } from './base-retrieval-strategy';

@Injectable()
export class ComparisonStrategy extends BaseRetrievalStrategy {
  readonly agentType = 'comparison' as const;

  protected buildSystemPrompt(step: OrchestratorPlanStep): string {
    const p = (step.contextSlice.params ?? {}) as Record<string, unknown>;
    const subjects = Array.isArray(p['subjects'])
      ? (p['subjects'] as unknown[]).filter((s): s is string => typeof s === 'string')
      : [];
    const dimensions = Array.isArray(p['dimensions'])
      ? (p['dimensions'] as unknown[]).filter((d): d is string => typeof d === 'string')
      : [];

    return [
      'Ты — subagent в multi-agent research для AI-системы корпоративной памяти.',
      'Стратегия: COMPARISON.',
      'Твоя задача — сравнить заданные субъекты, опираясь на блоки знаний компании.',
      '',
      subjects.length > 0
        ? `Субъекты сравнения: ${subjects.join(' vs ')}`
        : 'Субъекты сравнения возьми из focus / seedHints.',
      dimensions.length > 0
        ? `Измерения сравнения: ${dimensions.join(', ')}`
        : 'Сам определи 3-5 значимых измерений сравнения.',
      '',
      'Формат ответа в `text`:',
      '  ## <Субъект A> vs <Субъект B>',
      '  ### <Измерение 1>',
      '  - <Субъект A>: …',
      '  - <Субъект B>: …',
      '  ### <Итог>',
      '  - 1-2 предложения вывода.',
      '',
      'Каждое утверждение сопровождай ссылкой на blockId (citations).',
    ]
      .filter(Boolean)
      .join('\n');
  }
}
