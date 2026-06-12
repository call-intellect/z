import { describe, expect, it } from 'vitest';

import { RESOURCE_TYPE_RU_KEYS, resourceTypeRu } from './resource-type';

describe('resourceTypeRu', () => {
  it('каждый известный тип ресурса имеет RU-перевод (отличается от ключа)', () => {
    for (const key of RESOURCE_TYPE_RU_KEYS) {
      expect(resourceTypeRu(key)).not.toBe(key);
    }
  });

  it('неизвестный тип возвращается как есть', () => {
    expect(resourceTypeRu('zzz_unknown')).toBe('zzz_unknown');
  });
});
