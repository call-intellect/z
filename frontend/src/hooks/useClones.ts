"use client";

import { useMemo } from "react";
import useSWR, { useSWRConfig } from "swr";

import { clonesApi } from "@/api/clones.api";
import { meCloneAccessApi } from "@/api/me-clone-access.api";
import {
  mapCloneConversation,
  mapCloneListItem,
  mapMyCloneAccess,
  type CloneConversationUiItem,
  type CloneListUiItem,
  type MyCloneAccessMap,
} from "@/domain/clone";

const COMMON_OPTS = {
  revalidateOnFocus: false,
  dedupingInterval: 5_000,
};

export function useClones(orgId: string | null) {
  const swr = useSWR(
    orgId ? ["clones:list", orgId] : null,
    async () => {
      const res = await clonesApi.listClones(orgId!, {
        status: "active",
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

export function useCloneConversations(
  orgId: string | null,
  roleId: string | null,
) {
  const swr = useSWR(
    orgId && roleId ? ["clones:conversations", orgId, "role", roleId] : null,
    async () => {
      const res = await clonesApi.listMyCloneConversations(orgId!, {
        cloneType: "role",
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

export function useMyCloneAccess(orgId: string | null) {
  const swr = useSWR(
    orgId ? ["clones:my-access", orgId] : null,
    async () => {
      try {
        const res = await meCloneAccessApi.get(orgId!);
        return mapMyCloneAccess(res);
      } catch (err) {
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
