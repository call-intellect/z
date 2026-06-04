'use client';

import { Chip } from './Chip';

/**
 * TrustBadge — плашка «уровень доверия» карточки знаний (лестница доверия A1).
 *
 * Контракт значений — backend read-DTO (`trustTier`):
 *   - `human`       — проверено человеком (норма), плашку не показываем.
 *   - `provisional` — ИИ канонизировал критическое знание САМ, без человека.
 *                     Это нужно явно подсветить пользователю.
 *   - `auto`        — добавлено автоматически с высокой уверенностью.
 *
 * Чистый хелпер `trustBadgeConfig` вынесен отдельно для unit-теста.
 * Все строки — на русском.
 */
export type TrustTier = 'auto' | 'provisional' | 'human';

export function trustBadgeConfig(
  tier: TrustTier,
): { label: string; variant: 'warning' | 'sand'; title: string } | null {
  if (tier === 'provisional') {
    return {
      label: 'Не проверено человеком',
      variant: 'warning',
      title:
        'Карточка подтверждена искусственным интеллектом, но ещё не проверена человеком.',
    };
  }
  if (tier === 'auto') {
    return {
      label: 'Авто',
      variant: 'sand',
      title: 'Карточка добавлена автоматически с высокой уверенностью.',
    };
  }
  return null; // human — норма, без плашки
}

export function TrustBadge({
  tier,
  size = 'sm',
}: {
  tier: TrustTier;
  size?: 'sm' | 'md';
}) {
  const cfg = trustBadgeConfig(tier);
  if (!cfg) return null;
  return (
    <Chip variant={cfg.variant} size={size} title={cfg.title}>
      {cfg.label}
    </Chip>
  );
}
