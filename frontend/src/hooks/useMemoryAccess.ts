'use client';

/**
 * `useMemoryAccess` — что пользователь видит из «Памяти компании».
 *
 * Слои (по возрастанию приоритета):
 *   1. База: роль (owner/admin/manager/coo → всё) ИЛИ entitlement-флаг тарифа
 *      (`feature.memory_*_for_members`) для рядовых.
 *   2. Персональный override (ТЗ «Команда + доступы» Фаза 5): `allow` открывает
 *      раздел даже рядовому, `deny` закрывает даже руководителю. Источник —
 *      `GET /orgs/:id/effective-access` (EmployeeCapabilityOverride).
 */

import useSWR from 'swr';

import { orgsApi } from '@/api/orgs.api';
import { useAuth } from '@/contexts/auth-context';
import { useEntitlement } from './useEntitlement';

export type MemoryAccessResult = {
  canReadRegulations: boolean;
  canReadEntities: boolean;
  loading: boolean;
};

export function useMemoryAccess(): MemoryAccessResult {
  const { currentOrgRole, currentOrgId, isLoading: authLoading } = useAuth();
  const regulationsFeature = useEntitlement(
    'feature.memory_regulations_for_members',
  );
  const entitiesFeature = useEntitlement('feature.memory_entities_for_members');

  const overridesSwr = useSWR(
    currentOrgId ? ['effective-access', currentOrgId] : null,
    () => orgsApi.effectiveAccess(currentOrgId as string),
  );
  const overrides = overridesSwr.data?.overrides ?? {};

  const isLeadership =
    currentOrgRole === 'owner' ||
    currentOrgRole === 'admin' ||
    currentOrgRole === 'manager' ||
    currentOrgRole === 'coo';

  const loading =
    authLoading ||
    regulationsFeature.loading ||
    entitiesFeature.loading ||
    (Boolean(currentOrgId) && overridesSwr.isLoading);

  const resolve = (capability: string, base: boolean): boolean => {
    const ov = overrides[capability];
    if (ov === 'allow') return true;
    if (ov === 'deny') return false;
    return base;
  };

  return {
    canReadRegulations: resolve(
      'memory:regulations',
      isLeadership || regulationsFeature.enabled,
    ),
    canReadEntities: resolve(
      'memory:entities',
      isLeadership || entitiesFeature.enabled,
    ),
    loading,
  };
}
