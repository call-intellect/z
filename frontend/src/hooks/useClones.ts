'use client';

/**
 * SWR-хуки маркетплейса клонов (ТЗ 2026-05-26).
 *
 * Все ключи начинаются с префикса `clones:*`, чтобы было удобно делать
 * `mutate(key => key.startsWith('clones:'))` после выдачи/отзыва грантов.
 *
 * Архитектура слоёв:
 *   - API-клиенты (`clonesApi`, `meCloneAccessApi`) — сырой ApiDto.
 *   - Хуки (этот файл) — мапят в DomainModel/UiModel и кешируют через SWR.
 *   - Компоненты — работают только с UiModel.
 */

import { useMemo } from 'react';
import useSWR, { useSWRConfig } from 'swr';

import { clonesApi } from '@/api/clones.api';
import { meCloneAccessApi } from '@/api/me-clone-access.api';
import {
  mapCloneConversation,
  mapCloneListItem,
  mapMyCloneAccess,
  type CloneConversationUiItem,
  type CloneListUiItem,
  type MyCloneAccessMap,
} from '@/domain/clone';

const COMMON_OPTS = {
  revalidateOnFocus: false,
  dedupingInterval: 5_000,
};

// ─────────────────── useClones ───────────────────

/**
 * Список всех ролевых клонов Org (status=active).
 * Backfill уже отфильтровал superseded/archived на бэке.
 */
export function useClones(orgId: string | null) {
  const swr = useSWR(
    orgId ? ['clones:list', orgId] : null,
    async () => {
      const res = await clonesApi.listClones(orgId!, {
        status: 'active',
        pageSize: 100,
      });
      return {
        items: res.items.map(mapCloneListItem),
        total: res.total,
      };
    },
    COMMON_OPTS,
  );

  return {
    items: swr.data?.items ?? [],
    total: swr.data?.total ?? 0,
    isLoading: swr.isLoading,
    error: swr.error,
    mutate: swr.mutate,
  };
}

/** Найти карточку клона по roleId среди уже загруженных useClones(). */
export function useCloneByRoleId(
  orgId: string | null,
  roleId: string,
): { item: CloneListUiItem | null; isLoading: boolean; error: unknown } {
  const { items, isLoading, error } = useClones(orgId);
  const item = useMemo(
    () => items.find((c) => c.roleId === roleId) ?? null,
    [items, roleId],
  );
  return { item, isLoading, error };
}

// ─────────────────── useCloneConversations ───────────────────

/**
 * Список диалогов текущего пользователя с клоном этой роли.
 * Backend: GET /api/v1/clones/conversations?cloneType=role&cloneRefId=:id.
 */
export function useCloneConversations(
  orgId: string | null,
  roleId: string | null,
) {
  const swr = useSWR(
    orgId && roleId ? ['clones:conversations', orgId, 'role', roleId] : null,
    async () => {
      const res = await clonesApi.listMyCloneConversations(orgId!, {
        cloneType: 'role',
        cloneRefId: roleId!,
        limit: 50,
      });
      return {
        items: res.items.map(mapCloneConversation),
        nextCursor: res.nextCursor,
      };
    },
    COMMON_OPTS,
  );

  const items: CloneConversationUiItem[] = swr.data?.items ?? [];

  return {
    items,
    nextCursor: swr.data?.nextCursor ?? null,
    isLoading: swr.isLoading,
    error: swr.error,
    mutate: swr.mutate,
  };
}

// ─────────────────── useMyCloneAccess ───────────────────

/**
 * Карта моих грантов на клонов (оптимистичная фильтрация карточек в
 * маркетплейсе и страже доступа к чату).
 *
 * Возвращает `MyCloneAccessMap` с методом `has(cloneType, cloneRefId)`.
 * Если backend ещё не задеплоил `/me/clone-access` (404), хук молча
 * возвращает пустую карту — UI деградирует к «все карточки без grant'а».
 */
export function useMyCloneAccess(orgId: string | null) {
  const swr = useSWR(
    orgId ? ['clones:my-access', orgId] : null,
    async () => {
      try {
        const res = await meCloneAccessApi.get(orgId!);
        return mapMyCloneAccess(res);
      } catch (err) {
        // Грейсфул-деградация: если endpoint не задеплоен — пустая карта.
        const isNotFound =
          err instanceof Error && /not[_-]?found|http_404/i.test(err.message);
        if (isNotFound) {
          return mapMyCloneAccess({
            personClones: [],
            roleClones: [],
            fetchedAt: new Date().toISOString(),
          });
        }
        throw err;
      }
    },
    COMMON_OPTS,
  );

  const access: MyCloneAccessMap | null = swr.data ?? null;

  return {
    access,
    isLoading: swr.isLoading,
    error: swr.error,
    mutate: swr.mutate,
  };
}

// ─────────────────── useInvalidateCloneAccess ───────────────────

/**
 * Сбросить кеш всех clones:*-ключей. Удобно дёрнуть после `requestAccess`
 * или после того, как пользователь зашёл на `/clones` (нотификация о
 * новом гранте).
 */
export function useInvalidateClones() {
  const { mutate } = useSWRConfig();
  return () =>
    void mutate(
      (key) => Array.isArray(key) && typeof key[0] === 'string' && (key[0] as string).startsWith('clones:'),
      undefined,
      { revalidate: true },
    );
}
