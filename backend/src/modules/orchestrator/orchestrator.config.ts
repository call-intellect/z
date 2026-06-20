import type { TypedConfigService } from '../../common/config/index';

import type { OrchestratorLimits } from './orchestrator.types';

export function readOrchestratorLimits(cfg: TypedConfigService): OrchestratorLimits {
  return {
    enabled: cfg.resolveSync<boolean>('orchestrator.enabled', 'ORCHESTRATOR_ENABLED', false),
    maxSubagentsPerRun: cfg.resolveSync<number>(
      'orchestrator.maxSubagentsPerRun',
      'ORCHESTRATOR_MAX_SUBAGENTS_PER_RUN',
      5,
    ),
    runTimeoutMinutes: cfg.resolveSync<number>(
      'orchestrator.runTimeoutMinutes',
      'ORCHESTRATOR_RUN_TIMEOUT_MINUTES',
      15,
    ),
  };
}

export function tenantTopBucket(tenantId: string): string {
  let h = 0;
  for (let i = 0; i < tenantId.length; i++) {
    h = (h * 31 + tenantId.charCodeAt(i)) >>> 0;
  }
  return `bucket_${(h % 100).toString().padStart(2, '0')}`;
}
