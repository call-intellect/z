/**
 * SBA δ-1 — конфиг Orchestrator (cost-runaway protection).
 *
 * TODO(typed-config): из-за TS2589 при добавлении новой группы в
 * `TypedConfigService` мы временно читаем 3 ENV через `process.env.*`
 * напрямую. После стабилизации (когда уберём `TS2589`-инциденты от
 * параллельных coders δ-фазы) — перенести в `TypedConfigService` под
 * группу `orchestrator: { enabled, maxSubagentsPerRun, runTimeoutMinutes }`.
 *
 *   ORCHESTRATOR_ENABLED                — feature-flag, default false (production safety).
 *   ORCHESTRATOR_MAX_SUBAGENTS_PER_RUN  — default 5.
 *   ORCHESTRATOR_RUN_TIMEOUT_MINUTES    — default 15.
 */

import type { OrchestratorLimits } from './orchestrator.types';

const DEFAULT_MAX_SUBAGENTS_PER_RUN = 5;
const DEFAULT_RUN_TIMEOUT_MINUTES = 15;

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === '') return fallback;
  const v = raw.toLowerCase().trim();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return fallback;
}

function parseIntSafe(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/** Прочитать лимиты из process.env. Кэширование не нужно — вызывается редко. */
export function readOrchestratorLimits(): OrchestratorLimits {
  return {
    enabled: parseBool(process.env['ORCHESTRATOR_ENABLED'], false),
    maxSubagentsPerRun: parseIntSafe(
      process.env['ORCHESTRATOR_MAX_SUBAGENTS_PER_RUN'],
      DEFAULT_MAX_SUBAGENTS_PER_RUN,
      1,
      20,
    ),
    runTimeoutMinutes: parseIntSafe(
      process.env['ORCHESTRATOR_RUN_TIMEOUT_MINUTES'],
      DEFAULT_RUN_TIMEOUT_MINUTES,
      1,
      120,
    ),
  };
}

/** Бакет tenantId → строка для cardinality-safe label'ов. */
export function tenantTopBucket(tenantId: string): string {
  let h = 0;
  for (let i = 0; i < tenantId.length; i++) {
    h = (h * 31 + tenantId.charCodeAt(i)) >>> 0;
  }
  return `bucket_${(h % 100).toString().padStart(2, '0')}`;
}
