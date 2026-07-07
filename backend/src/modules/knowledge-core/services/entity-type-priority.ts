import type { EntityType } from '@prisma/client';

const DOMAIN_TYPES: ReadonlySet<EntityType> = new Set<EntityType>([
  'person',
  'customer',
  'vendor',
  'project',
  'product',
  'document',
  'goal',
  'event',
  'market',
  'org_unit',
  'technology',
  'location',
]);

const GENERIC_PRIORITY: readonly EntityType[] = ['metric', 'topic', 'custom'];

export function normalizeEntityType(type: EntityType): EntityType {
  return type === 'client' ? 'customer' : type;
}

export function resolveCanonicalType(
  a: EntityType,
  b: EntityType,
): { type: EntityType } | { disputed: true } {
  const left = normalizeEntityType(a);
  const right = normalizeEntityType(b);

  if (left === right) return { type: left };

  const leftDomain = DOMAIN_TYPES.has(left);
  const rightDomain = DOMAIN_TYPES.has(right);

  if (leftDomain && !rightDomain) return { type: left };
  if (rightDomain && !leftDomain) return { type: right };

  if (!leftDomain && !rightDomain) {
    for (const t of GENERIC_PRIORITY) {
      if (left === t || right === t) return { type: t };
    }
    return { type: left };
  }

  return { disputed: true };
}
