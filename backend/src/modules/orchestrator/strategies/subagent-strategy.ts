import type {
  OrchestratorAgentType,
  OrchestratorPlanStep,
  OrchestratorSubagentResult,
} from '../orchestrator.types';

/**
 * SBA δ-1 — единый интерфейс subagent-стратегии.
 *
 * Каждая стратегия инкапсулирует:
 *   - retrieval (ChatV2RetrievalService / GraphService);
 *   - формирование промпта LLM (`orchestrator-subagent` taskType);
 *   - парсинг ответа в `OrchestratorSubagentResult`.
 *
 * Стратегия НЕ ходит в БД напрямую за чужим контекстом — только через
 * `contextSlice` и retrieval-сервисы.
 */
export interface SubagentStrategy {
  agentType: OrchestratorAgentType;
  execute(args: SubagentExecuteInput): Promise<OrchestratorSubagentResult>;
}

export interface SubagentExecuteInput {
  step: OrchestratorPlanStep;
  tenantId: string;
  userId: string;
  /** Hard-timeout в миллисекундах (один subagent). */
  timeoutMs: number;
}
