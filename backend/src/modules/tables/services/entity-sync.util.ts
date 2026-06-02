/**
 * Хелперы entitySync для Smart-таблиц (Фаза 2 — graph-driven rows).
 *
 * `entitySync` хранится в `Table.entitySync` как JSON произвольной формы.
 * Здесь — типобезопасное чтение и резолв точного списка классов Entity, по
 * которым таблица синкается со связанными сущностями графа.
 */

/** Грубая категория entitySync (как в DTO). */
export type EntitySyncType = 'org' | 'person' | 'meeting' | 'document';

/**
 * Нормализованная форма `Table.entitySync`. Все поля опц., потому что в БД
 * лежит сырой JSON (может быть из старого формата без `entityTypes`).
 */
export interface EntitySyncConfig {
  type?: EntitySyncType;
  autoCreate?: boolean;
  primaryProperty?: string;
  entityTypes?: string[];
}

/**
 * Дефолтный маппинг грубой категории → точные классы Entity. Используется,
 * когда `entitySync.entityTypes` не задан явно.
 *
 *   org      → customer + vendor (две роли организации в графе)
 *   person   → person
 *   document → document
 *   meeting  → [] (для встреч строки не синкаются автоматически — нет
 *               стабильного Entity-класса встречи; синк по событиям пропускается)
 */
const DEFAULT_TYPES_BY_CATEGORY: Record<EntitySyncType, string[]> = {
  org: ['customer', 'vendor'],
  person: ['person'],
  document: ['document'],
  meeting: [],
};

/**
 * Безопасно привести сырой `Table.entitySync` (JSON | null) к
 * `EntitySyncConfig`. Возвращает `null`, если синк не настроен.
 */
export function parseEntitySync(raw: unknown): EntitySyncConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const type =
    obj['type'] === 'org' ||
    obj['type'] === 'person' ||
    obj['type'] === 'meeting' ||
    obj['type'] === 'document'
      ? (obj['type'] as EntitySyncType)
      : undefined;
  const entityTypes = Array.isArray(obj['entityTypes'])
    ? (obj['entityTypes'] as unknown[]).filter(
        (t): t is string => typeof t === 'string' && t.length > 0,
      )
    : undefined;
  return {
    type,
    autoCreate: obj['autoCreate'] === true,
    primaryProperty:
      typeof obj['primaryProperty'] === 'string'
        ? (obj['primaryProperty'] as string)
        : undefined,
    entityTypes,
  };
}

/**
 * Точный список классов Entity, по которым синкается таблица.
 *   - если задан `entityTypes` (непустой) — берём его;
 *   - иначе дефолт по `type`;
 *   - если ни того, ни другого — пустой массив (синк выключен).
 */
export function resolveEntityTypes(
  entitySync: EntitySyncConfig | null | undefined,
): string[] {
  if (!entitySync) return [];
  if (entitySync.entityTypes && entitySync.entityTypes.length > 0) {
    return entitySync.entityTypes;
  }
  if (entitySync.type) {
    return DEFAULT_TYPES_BY_CATEGORY[entitySync.type] ?? [];
  }
  return [];
}
