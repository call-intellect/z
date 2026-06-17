import { Injectable } from '@nestjs/common';

import type { OrchestratorPlanStep } from '../orchestrator.types';

import { BaseRetrievalStrategy } from './base-retrieval-strategy';

@Injectable()
export class TimelineConstructionStrategy extends BaseRetrievalStrategy {
  readonly agentType = 'timeline_construction' as const;

  protected buildSystemPrompt(_step: OrchestratorPlanStep): string {
    return [
      'Ты — subagent в multi-agent research для AI-системы корпоративной памяти.',
      'Стратегия: TIMELINE_CONSTRUCTION.',
      'Твоя задача — собрать хронологию событий по фокусу: даты, решения, итоги.',
      'Опирайся ИСКЛЮЧИТЕЛЬНО на блоки знаний (см. контекст).',
      '',
      'Формат ответа в `text` (chronological):',
      '  - **YYYY-MM-DD** — <короткое описание события> (блок-ссылка).',
      '  - **YYYY-MM** — <если только месяц известен>.',
      '  - **~YYYY** — <если только год>.',
      '',
      'В конце 1-2 предложения вывода: куда движется тема, что изменилось.',
      'Если даты отсутствуют в блоках — НЕ выдумывай; ставь confidence ниже.',
    ].join('\n');
  }
}
