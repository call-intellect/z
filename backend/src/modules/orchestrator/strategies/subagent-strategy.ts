import type {
  OrchestratorAgentType,
  OrchestratorPlanStep,
  OrchestratorSubagentResult,
} from '../orchestrator.types';

export interface SubagentStrategy {
  agentType: OrchestratorAgentType;
  execute(args: SubagentExecuteInput): Promise<OrchestratorSubagentResult>;
}

export interface SubagentExecuteInput {
  step: OrchestratorPlanStep;
  tenantId: string;
  userId: string;
  timeoutMs: number;
}
