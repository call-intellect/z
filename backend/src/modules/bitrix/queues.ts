import { BITRIX_ANALYZE_QUEUE } from './queue/bitrix-analyze.queue';
import { BITRIX_SYNC_QUEUE } from './queue/bitrix-sync.queue';

export const BITRIX_QUEUE_NAMES = {
  SYNC: BITRIX_SYNC_QUEUE,
  ANALYZE: BITRIX_ANALYZE_QUEUE,
} as const;
