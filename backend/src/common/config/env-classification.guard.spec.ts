import { describe, expect, it } from 'vitest';

import { ADMIN_FALLBACK_ENV_KEYS, KEEP_ENV_KEYS } from './env-classification';
import { EnvSchema } from './env.schema';

function shapeKeys(): string[] {
  const shape = (EnvSchema as unknown as { shape: Record<string, unknown> }).shape;
  return Object.keys(shape);
}

describe('env-classification guard', () => {
  it('каждый top-level ключ EnvSchema классифицирован (KEEP ∪ ADMIN_FALLBACK покрывает всё)', () => {
    const all = shapeKeys();
    const unclassified = all.filter(
      (k) => !KEEP_ENV_KEYS.has(k) && !ADMIN_FALLBACK_ENV_KEYS.has(k),
    );
    expect(unclassified, buildUnclassifiedMessage(unclassified)).toEqual([]);
  });

  it('множества не пересекаются (KEEP ∩ ADMIN_FALLBACK = пусто)', () => {
    const intersection = [...KEEP_ENV_KEYS].filter((k) => ADMIN_FALLBACK_ENV_KEYS.has(k));
    expect(intersection, buildIntersectionMessage(intersection)).toEqual([]);
  });

  it('в классификации нет ключей, которых уже нет в EnvSchema', () => {
    const all = new Set(shapeKeys());
    const stale = [...KEEP_ENV_KEYS, ...ADMIN_FALLBACK_ENV_KEYS].filter((k) => !all.has(k));
    expect(stale, `Устаревшие ключи в классификации (нет в EnvSchema): ${stale.join(', ')}`).toEqual(
      [],
    );
  });
});

function buildUnclassifiedMessage(unclassified: string[]): string {
  return (
    `Неклассифицированные ENV: ${unclassified.join(', ')}. ` +
    'Секрет/инфра → KEEP_ENV_KEYS; крутилка → admin-ключ (resolveSync) + ADMIN_FALLBACK_ENV_KEYS. ' +
    'См. analysis 2026-06-20-config'
  );
}

function buildIntersectionMessage(intersection: string[]): string {
  return `Ключи одновременно в KEEP и ADMIN_FALLBACK: ${intersection.join(', ')}. Должны быть в одном множестве.`;
}
