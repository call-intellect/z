export type EntitySyncType = 'org' | 'person' | 'meeting' | 'document';

export interface EntitySyncConfig {
  type?: EntitySyncType;
  autoCreate?: boolean;
  primaryProperty?: string;
  entityTypes?: string[];
}

const DEFAULT_TYPES_BY_CATEGORY: Record<EntitySyncType, string[]> = {
  org: ['customer', 'vendor'],
  person: ['person'],
  document: ['document'],
  meeting: [],
};

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
      typeof obj['primaryProperty'] === 'string' ? (obj['primaryProperty'] as string) : undefined,
    entityTypes,
  };
}

export function resolveEntityTypes(entitySync: EntitySyncConfig | null | undefined): string[] {
  if (!entitySync) return [];
  if (entitySync.entityTypes && entitySync.entityTypes.length > 0) {
    return entitySync.entityTypes;
  }
  if (entitySync.type) {
    return DEFAULT_TYPES_BY_CATEGORY[entitySync.type] ?? [];
  }
  return [];
}
