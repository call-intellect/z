/**
 * Доменная модель ImportLog (миграционный wizard Tracker Phase 5).
 *
 * Backend контракт:
 *   - `backend/src/modules/tracker/dto/imports/import-log-response.dto.ts`.
 *   - `backend/src/modules/tracker/services/import.service.ts`.
 *
 * Источники: `trello | bitrix24 | yandex_tracker`. Статусы:
 * `running | completed | failed | cancelled`.
 */

// ─── Enums ───────────────────────────────────────────────────────────────────

export type ImportSource = 'trello' | 'bitrix24' | 'yandex_tracker';
export type ImportStatus = 'running' | 'completed' | 'failed' | 'cancelled';

// ─── ApiDto (сериализуется бэком ровно так) ─────────────────────────────────

export interface ImportLogApi {
  id: string;
  tenantId: string;
  source: string;
  startedAt: string;
  completedAt: string | null;
  totalProjects: number;
  totalIssues: number;
  totalComments: number;
  totalAttachments: number;
  processedItems: number;
  errors: unknown;
  status: string;
  paramsJson: unknown;
  unmatchedJson: unknown;
  initiatedByUserId: string;
}

export interface ListImportLogsResponseApi {
  items: ImportLogApi[];
  nextCursor: string | null;
  limit: number;
}

export interface ImportErrorEntryApi {
  stage: string;
  externalId?: string | null;
  message: string;
  timestamp: string;
}

// ─── Domain ─────────────────────────────────────────────────────────────────

export interface ImportLog {
  id: string;
  tenantId: string;
  source: ImportSource;
  startedAt: Date;
  completedAt: Date | null;
  totalProjects: number;
  totalIssues: number;
  totalComments: number;
  totalAttachments: number;
  processedItems: number;
  /** Массив ошибок (если есть). Может быть пустой массив или null. */
  errors: ImportErrorEntryApi[];
  status: ImportStatus;
  /** Параметры запуска: jsonContent у trello слишком большой — фронт не отображает. */
  paramsJson: unknown;
  /**
   * Email'ы, которые не нашлись в Org и пользователь не выбрал политику.
   * Структура backend'а: `{ unmatched: string[] }` (см. import.service).
   */
  unmatched: string[];
  initiatedByUserId: string;
}

// ─── Mapper ─────────────────────────────────────────────────────────────────

const KNOWN_SOURCES: ImportSource[] = ['trello', 'bitrix24', 'yandex_tracker'];
const KNOWN_STATUSES: ImportStatus[] = [
  'running',
  'completed',
  'failed',
  'cancelled',
];

function normalizeSource(raw: string): ImportSource {
  return KNOWN_SOURCES.includes(raw as ImportSource)
    ? (raw as ImportSource)
    : 'trello';
}

function normalizeStatus(raw: string): ImportStatus {
  return KNOWN_STATUSES.includes(raw as ImportStatus)
    ? (raw as ImportStatus)
    : 'running';
}

function parseErrors(raw: unknown): ImportErrorEntryApi[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is ImportErrorEntryApi =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as { message?: unknown }).message === 'string',
  );
}

function parseUnmatched(raw: unknown): string[] {
  if (raw && typeof raw === 'object' && 'unmatched' in raw) {
    const arr = (raw as { unmatched?: unknown }).unmatched;
    if (Array.isArray(arr)) {
      return arr.filter((v): v is string => typeof v === 'string');
    }
  }
  return [];
}

export function importLogFromApi(api: ImportLogApi): ImportLog {
  return {
    id: api.id,
    tenantId: api.tenantId,
    source: normalizeSource(api.source),
    startedAt: new Date(api.startedAt),
    completedAt: api.completedAt ? new Date(api.completedAt) : null,
    totalProjects: api.totalProjects,
    totalIssues: api.totalIssues,
    totalComments: api.totalComments,
    totalAttachments: api.totalAttachments,
    processedItems: api.processedItems,
    errors: parseErrors(api.errors),
    status: normalizeStatus(api.status),
    paramsJson: api.paramsJson,
    unmatched: parseUnmatched(api.unmatchedJson),
    initiatedByUserId: api.initiatedByUserId,
  };
}

// ─── UI helpers ─────────────────────────────────────────────────────────────

export function importSourceLabel(src: ImportSource): string {
  if (src === 'trello') return 'Trello';
  if (src === 'bitrix24') return 'Битрикс24';
  return 'Яндекс Трекер';
}

export function importStatusLabel(status: ImportStatus): string {
  if (status === 'running') return 'Идёт импорт';
  if (status === 'completed') return 'Завершён';
  if (status === 'failed') return 'Ошибка';
  return 'Отменён';
}

export function importPhaseLabel(phase: string): string {
  switch (phase) {
    case 'boards':
      return 'Создание досок';
    case 'states':
      return 'Создание колонок';
    case 'labels':
      return 'Создание меток';
    case 'issues':
      return 'Обработка карточек';
    case 'comments':
      return 'Создание комментариев';
    case 'attachments':
      return 'Загрузка вложений';
    case 'finalizing':
      return 'Завершение';
    case 'cancelled':
      return 'Отменено';
    default:
      return phase || 'Подготовка';
  }
}
