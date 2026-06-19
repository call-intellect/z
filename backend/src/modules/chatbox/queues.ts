import { CHATBOX_ANALYZE_QUEUE } from './queue/chatbox-analyze.queue';
import { CHATBOX_SYNC_QUEUE } from './queue/chatbox-sync.queue';

export const CHATBOX_QUEUE_NAMES = {
  SYNC: CHATBOX_SYNC_QUEUE,
  ANALYZE: CHATBOX_ANALYZE_QUEUE,
} as const;
