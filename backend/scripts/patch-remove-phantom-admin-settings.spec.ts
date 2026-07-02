import { describe, expect, it } from 'vitest';

import { registeredSettingKeys } from '../src/modules/admin/settings/admin-setting-schema-registry';

import { PHANTOM_KEYS, phantomTargets } from './patch-remove-phantom-admin-settings';

describe('patch-remove-phantom-admin-settings', () => {
  it('39 известных phantom-ключей, без дублей', () => {
    expect(PHANTOM_KEYS).toHaveLength(39);
    expect(new Set(PHANTOM_KEYS).size).toBe(39);
  });

  it('ни один известный phantom-ключ не присутствует в актуальном реестре', () => {
    const reg = new Set(registeredSettingKeys());
    expect(PHANTOM_KEYS.filter((k) => reg.has(k))).toEqual([]);
  });

  it('phantomTargets = все phantom при актуальном реестре', () => {
    expect(phantomTargets(registeredSettingKeys()).slice().sort()).toEqual([...PHANTOM_KEYS].sort());
  });

  it('phantomTargets исключает ключ, попавший в реестр (будущая cron-миграция)', () => {
    const registeredIncludingCron = [...registeredSettingKeys(), 'knowledge.theme.clusterer_cron'];
    expect(phantomTargets(registeredIncludingCron)).not.toContain('knowledge.theme.clusterer_cron');
  });
});
