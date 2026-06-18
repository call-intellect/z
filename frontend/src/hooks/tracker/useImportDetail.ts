"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import { importsApi } from "@/api/tracker/imports.api";
import {
  importLogFromApi,
  type ImportCompletedPayload,
  type ImportFailedPayload,
  type ImportLog,
  type ImportProgressPayload,
} from "@/domain/tracker";

import { useTrackerWebSocket } from "./useTrackerWebSocket";

const POLL_INTERVAL_MS = 2_000;

export interface ImportLiveOverlay {
  processed: number | null;
  phase: string | null;
}

export interface UseImportDetailOptions {
  onCompleted?: (payload: ImportCompletedPayload) => void;
  onFailed?: (payload: ImportFailedPayload) => void;
}

export interface UseImportDetailResult {
  importLog: ImportLog | null;
  live: ImportLiveOverlay;
  error: unknown;
  isLoading: boolean;
  wsConnected: boolean;
  mutate: () => Promise<unknown>;
}

export function useImportDetail(
  orgId: string | null | undefined,
  importLogId: string | null | undefined,
  options: UseImportDetailOptions = {},
): UseImportDetailResult {
  const enabled = Boolean(orgId && importLogId);

  const key = enabled
    ? (["tracker.import", orgId, importLogId] as const)
    : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !importLogId) throw new Error("orgId/importLogId required");
      return importsApi.getById(orgId, importLogId);
    },
    {
      revalidateOnFocus: false,
      refreshInterval: (latest) => {
        if (!latest) return POLL_INTERVAL_MS;
        return latest.status === "running" ? POLL_INTERVAL_MS : 0;
      },
    },
  );

  const importLog = useMemo<ImportLog | null>(
    () => (swr.data ? importLogFromApi(swr.data) : null),
    [swr.data],
  );

  const { client, connected } = useTrackerWebSocket(orgId ?? null, enabled);
  const [live, setLive] = useState<ImportLiveOverlay>({
    processed: null,
    phase: null,
  });

  const finalizedRef = useRef<string | null>(null);

  const onCompletedRef = useRef(options.onCompleted);
  const onFailedRef = useRef(options.onFailed);
  useEffect(() => {
    onCompletedRef.current = options.onCompleted;
    onFailedRef.current = options.onFailed;
  }, [options.onCompleted, options.onFailed]);

  useEffect(() => {
    if (!client || !importLogId) return;

    const offProgress = client.on("import.progress", (raw) => {
      const payload = raw as ImportProgressPayload | undefined;
      if (!payload || payload.importLogId !== importLogId) return;
      setLive({
        processed: payload.processed,
        phase: payload.phase,
      });
    });

    const offCompleted = client.on("import.completed", (raw) => {
      const payload = raw as ImportCompletedPayload | undefined;
      if (!payload || payload.importLogId !== importLogId) return;
      void swr.mutate();
      if (finalizedRef.current !== importLogId) {
        finalizedRef.current = importLogId;
        onCompletedRef.current?.(payload);
      }
    });

    const offFailed = client.on("import.failed", (raw) => {
      const payload = raw as ImportFailedPayload | undefined;
      if (!payload || payload.importLogId !== importLogId) return;
      void swr.mutate();
      if (finalizedRef.current !== importLogId) {
        finalizedRef.current = importLogId;
        onFailedRef.current?.(payload);
      }
    });

    return () => {
      offProgress();
      offCompleted();
      offFailed();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, importLogId]);

  useEffect(() => {
    setLive({ processed: null, phase: null });
    finalizedRef.current = null;
  }, [importLogId]);

  return {
    importLog,
    live,
    error: swr.error,
    isLoading: swr.isLoading,
    wsConnected: connected,
    mutate: () => swr.mutate(),
  };
}
