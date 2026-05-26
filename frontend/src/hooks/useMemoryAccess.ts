'use client';

/**
 * `useMemoryAccess` (ТЗ 2026-05-26 §6) — что пользователь видит из «Памяти
 * компании».
 *
 * Логика:
 *   - Если роль ∈ {owner, admin, manager, coo} — открыт весь доступ (Z-модель,
 *     эти роли — leadership / management). Видят /regulations и /entities
 *     по умолчанию.
 *   - Если роль = `member` (будущая) — проверяем entitlements:
 *     - `feature.memory_regulations_for_members` → доступ к /regulations.
 *     - `feature.memory_entities_for_members`    → доступ к /entities.
 *   - Доступ к /ideas — всегда (ТЗ §6: «идеи ценны тем, что их видят все»).
 *
 * Используется:
 *   - в `Sidebar.tsx` — для фильтрации пунктов подгруппы «Память»;
 *   - на страницах /regulations, /entities — для показа `AdminForbidden`
 *     если пользователь попал прямым URL и не имеет доступа.
 */

import { useAuth } from '@/contexts/auth-context';
import { useEntitlement } from './useEntitlement';

export type MemoryAccessResult = {
  /** Видит ли пользователь раздел «Правила и стандарты». */
  canReadRegulations: boolean;
  /** Видит ли пользователь раздел «Сущности». */
  canReadEntities: boolean;
  /** True пока auth/entitlement ещё грузится. */
  loading: boolean;
};

export function useMemoryAccess(): MemoryAccessResult {
  const { currentOrgRole, isLoading: authLoading } = useAuth();
  const regulationsFeature = useEntitlement(
    'feature.memory_regulations_for_members',
  );
  const entitiesFeature = useEntitlement(
    'feature.memory_entities_for_members',
  );

  // Любая роль ≥ manager → доступ есть всегда. coo / admin / owner — тоже.
  const isLeadership =
    currentOrgRole === 'owner' ||
    currentOrgRole === 'admin' ||
    currentOrgRole === 'manager' ||
    currentOrgRole === 'coo';

  const loading =
    authLoading || regulationsFeature.loading || entitiesFeature.loading;

  if (isLeadership) {
    return {
      canReadRegulations: true,
      canReadEntities: true,
      loading,
    };
  }

  // Для всех остальных (включая будущий `member`) — гейтится entitlement'ом.
  return {
    canReadRegulations: regulationsFeature.enabled,
    canReadEntities: entitiesFeature.enabled,
    loading,
  };
}
