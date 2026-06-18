"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { boardsApi } from "@/api/tracker/boards.api";
import { boardFromApi, type Board } from "@/domain/tracker";

export function useProjectBoards(
  orgId: string | null | undefined,
  projectId: string | null | undefined,
  options: { includeArchived?: boolean } = {},
): {
  boards: Board[];
  total: number;
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
} {
  const includeArchived = options.includeArchived ?? false;
  const key =
    orgId && projectId
      ? ["tracker.project.boards", orgId, projectId, includeArchived]
      : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !projectId) throw new Error("orgId/projectId required");
      return boardsApi.list(orgId, projectId, { includeArchived });
    },
    { revalidateOnFocus: false },
  );

  const boards = useMemo<Board[]>(
    () => (swr.data ? swr.data.items.map(boardFromApi) : []),
    [swr.data],
  );

  return {
    boards,
    total: swr.data?.total ?? 0,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}

export function useBoard(
  orgId: string | null | undefined,
  boardId: string | null | undefined,
): {
  board: Board | null;
  error: unknown;
  isLoading: boolean;
  mutate: () => Promise<unknown>;
} {
  const key = orgId && boardId ? ["tracker.board", orgId, boardId] : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !boardId) throw new Error("orgId/boardId required");
      return boardsApi.get(orgId, boardId);
    },
    { revalidateOnFocus: false },
  );

  const board = useMemo<Board | null>(
    () => (swr.data ? boardFromApi(swr.data) : null),
    [swr.data],
  );

  return {
    board,
    error: swr.error,
    isLoading: swr.isLoading,
    mutate: () => swr.mutate(),
  };
}
