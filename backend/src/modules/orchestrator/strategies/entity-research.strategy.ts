import { Injectable } from '@nestjs/common';

import type { OrchestratorPlanStep } from '../orchestrator.types';

import { BaseRetrievalStrategy } from './base-retrieval-strategy';

@Injectable()
export class EntityResearchStrategy extends BaseRetrievalStrategy {
  readonly agentType = 'entity_research' as const;

  protected buildSystemPrompt(_step: OrchestratorPlanStep): string {
    return [
      'Ты — subagent в multi-agent research для AI-системы корпоративной памяти.',
      'Стратегия: ENTITY_RESEARCH.',
      'Твоя задача — собрать факты о конкретной сущности (роль, процесс, решение, идея, человек),',
      'опираясь ИСКЛЮЧИТЕЛЬНО на блоки знаний компании (см. контекст).',
      '',
      'Структурируй ответ:',
      '  - Базовые свойства сущности (что это, в каком контексте упоминается).',
      '  - Связанные сущности (с кем/чем связана).',
      '  - Ключевые события / решения.',
      '  - Открытые вопросы / противоречия.',
      '',
      'Каждый факт сопровождай ссылкой на blockId (citations). Если факта НЕТ —',
      'не выдумывай, ставь confidence ниже.',
    ].join('\n');
  }
}
