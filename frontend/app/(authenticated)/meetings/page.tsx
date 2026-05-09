import { MeetingsJournalReal } from '@/ui/components/meetings-journal/MeetingsJournalReal';

/**
 * Журнал встреч (M7) — master-detail layout с фильтрами, тегами,
 * массовыми действиями (delete / set tags / bulk export).
 *
 * Защита роута: `frontend/middleware.ts` (cookie z_session).
 * На 401 apiClient эмитит `auth:expired`.
 *
 * Старая табличная версия: `MeetingsTable` — больше не подключается,
 * но файл остаётся в репо (TODO M7 cleanup).
 */
export default function MeetingsListPage() {
  return <MeetingsJournalReal />;
}
