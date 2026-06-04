/**
 * Unit-тесты чистого хелпера `trustBadgeConfig` (Фаза C1, лестница доверия A1).
 *
 * Проверяем маппинг trustTier → конфиг плашки:
 *   - `provisional` → variant 'warning' (нужно подсветить — ИИ канонизировал сам).
 *   - `auto`        → variant 'sand'    (добавлено автоматически).
 *   - `human`       → null              (норма, плашку не показываем).
 */

import { describe, expect, it } from 'vitest';

import { trustBadgeConfig } from './TrustBadge';

describe('trustBadgeConfig', () => {
  it('provisional — variant "warning" и текст «Не проверено человеком»', () => {
    const cfg = trustBadgeConfig('provisional');
    expect(cfg).not.toBeNull();
    expect(cfg?.variant).toBe('warning');
    expect(cfg?.label).toBe('Не проверено человеком');
    expect(cfg?.title).toBeTruthy();
  });

  it('auto — variant "sand" и текст «Авто»', () => {
    const cfg = trustBadgeConfig('auto');
    expect(cfg).not.toBeNull();
    expect(cfg?.variant).toBe('sand');
    expect(cfg?.label).toBe('Авто');
    expect(cfg?.title).toBeTruthy();
  });

  it('human — null (плашка не показывается)', () => {
    expect(trustBadgeConfig('human')).toBeNull();
  });
});
