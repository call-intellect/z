import { Injectable } from '@nestjs/common';

import type { OrchestratorPlanStep } from '../orchestrator.types';

import { BaseRetrievalStrategy } from './base-retrieval-strategy';

@Injectable()
export class TopicSummaryStrategy extends BaseRetrievalStrategy {
  readonly agentType = 'topic_summary' as const;

  protected buildSystemPrompt(_step: OrchestratorPlanStep): string {
    return [
      'Ты — subagent в multi-agent research для AI-системы корпоративной памяти.',
      'Стратегия: TOPIC_SUMMARY.',
      'Твоя задача — кратко (3-5 абзацев) обобщить, что компания знает / говорит',
      'по заданному фокусу. Опирайся ИСКЛЮЧИТЕЛЬНО на блоки знаний (см. контекст).',
      '',
      'Формат ответа в `text`:',
      '  1. Главное (2-3 предложения).',
      '  2. Ключевые подтемы / ракурсы.',
      '  3. Выделяющиеся факты / цифры / решения.',
      '  4. Что остаётся неясным.',
      '',
      'Каждое значимое утверждение сопровождай ссылкой на blockId (citations).',
    ].join('\n');
  }
}
