'use client';

/**
 * useEffectiveOrgRole — определяет «эффективную роль» текущего пользователя
 * в его активной организации для UI-нужд промо/баннеров.
 *
 * Контракт ТЗ §8.3a:
 *   - `'owner'` — пользователь владелец Org (показываем CTA «отбей подписку»).
 *   - `'member'` — все остальные роли (показываем CTA «заработай 20 000 ₽/мес»).
 *
 * Источник правды — `useAuth().currentOrgRole` (см. `AccountUser.currentOrgRole`
 * из `domain/account.ts`, тип `CurrentOrgRole = 'owner' | 'admin' | 'manager'
 * | 'coo' | null`).
 *
 * Правило мэппинга: только `'owner'` → `'owner'`, всё остальное (включая
 * `null`, когда у пользователя ещё нет Org) → `'member'`. Это «безопасный
 * default» — member-копи универсальная и не обещает чего нет.
 */

import { useAuth } from '@/contexts/auth-context';

export type EffectiveOrgRole = 'owner' | 'member';

export function useEffectiveOrgRole(): EffectiveOrgRole {
  const { currentOrgRole } = useAuth();
  return currentOrgRole === 'owner' ? 'owner' : 'member';
}
