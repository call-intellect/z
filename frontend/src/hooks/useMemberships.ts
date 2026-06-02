'use client';

/**
 * Хук `useMemberships` (Фаза 0c, sub-TZ 0c.1).
 *
 * Тонкая обёртка над SWR + `orgsApi.listMine()` — возвращает список Org, в
 * которых состоит текущий пользователь. Используется `<OrgSwitcher />` для
 * рендера переключателя активной компании.
 *
 * Семантика:
 *   - `memberships` — всегда массив (может быть пустым). Никогда не `null`.
 *   - `isLoading` — true только пока первый запрос в полёте. SWR кеширует
 *     результат — повторные mount'ы переключателя не дёргают сеть.
 *   - `error` — если 401 пришло, ApiClient эмитит `auth:expired`, тут просто
 *     возвращаем пустой список, ошибки на UI не показываем (компонент сам
 *     решит, что рендерить — обычно ничего).
 *
 * Активная Org определяется по `user.currentOrgId` из `useAuth()` —
 * мы НЕ держим её в этом хуке, чтобы не путать два источника правды.
 */

import useSWR from 'swr';

import { orgsApi, type OrgApi } from '@/api/orgs.api';

export type Membership = {
  id: string;
  name: string;
  slug: string;
  tier: OrgApi['tier'];
  isReferenceDemo: boolean;
};

export type UseMembershipsResult = {
  memberships: Membership[];
  isLoading: boolean;
  error: unknown;
};

const SWR_KEY = '/api/v1/orgs/me';

export function useMemberships(): UseMembershipsResult {
  const { data, error, isLoading } = useSWR(
    SWR_KEY,
    async () => {
      const res = await orgsApi.listMine();
      return res.orgs.map<Membership>((org) => ({
        id: org.id,
        name: org.name,
        slug: org.slug,
        tier: org.tier,
        isReferenceDemo: org.isReferenceDemo,
      }));
    },
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    },
  );

  return {
    memberships: data ?? [],
    isLoading,
    error,
  };
}
