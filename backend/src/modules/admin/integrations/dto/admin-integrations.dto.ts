import { z } from 'zod';

export const SyncRunsQuerySchema = z.object({
  provider: z.enum(['bitrix', 'chatbox']).optional(),
  tenantId: z.string().trim().min(1).max(64).optional(),
  kind: z.enum(['sync', 'analyze']).optional(),
  status: z.enum(['running', 'success', 'failed', 'skipped']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().trim().min(1).max(64).optional(),
});
export type SyncRunsQueryDto = z.infer<typeof SyncRunsQuerySchema>;

export interface SourceRunStats {
  success: number;
  failed: number;
  running: number;
  skipped: number;
}

export interface SourceOverviewItem {
  tenantId: string;
  orgName: string | null;
  provider: 'bitrix' | 'chatbox';
  status: string;
  portalDomain: string | null;
  analysisEnabled: boolean;
  lastError: string | null;
  lastFullSyncAt: string | null;
  lastIncrementalSyncAt: string | null;
  lastRunAt: string | null;
  runs24h: { sync: SourceRunStats; analyze: SourceRunStats };
}

export interface SyncRunItem {
  id: string;
  tenantId: string;
  provider: string;
  kind: string;
  scope: string | null;
  refId: string | null;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  counts: unknown;
  error: string | null;
}
