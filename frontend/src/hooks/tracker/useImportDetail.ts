'use client';

/**
 * useImportDetail — детали одного ImportLog с условным polling и live-обновлением
 * через WebSocket (Wave 3 / Tracker Phase 5 part 1).
 *
 * Backend контракт: `GET /api/v1/tracker/imports/:id`.
 * Поведение:
 *   - SWR с `refreshInterval`: 2000 мс пока status === 'running', иначе 0.
 *   - Дополнительно подписка на `useTrackerWebSocket`:
 *     - `import.progress`: live-патч processedItems + phase (без refetch).
 *     - `import.completed` / `import.failed`: ре-валидация + onComplete callback.
 *   - Это даёт мгновенные обновления при онлайн WS + надёжный fallback на
 *     polling если WS недоступен.
 *
 * Хук «толстый» намеренно — на детальной странице импорта это единственный
 * источник правды о текущем состоянии, и поведение «прогресс должен дёргаться
 * без лагов» критично для UX.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';

import { importsApi } from '@/api/tracker/imports.api';
import {
  importLogFromApi,
  type ImportCompletedPayload,
  type ImportFailedPayload,
  type ImportLog,
  type ImportProgressPayload,
} from '@/domain/tracker';

import { useTrackerWebSocket } from './useTrackerWebSocket';

const POLL_INTERVAL_MS = 2_000;

export interface ImportLiveOverlay {
  /** processedItems из последнего progress event. */
  processed: number | null;
  /** phase из последнего progress event. */
  phase: string | null;
}

export interface UseImportDetailOptions {
  /** Вызывается ровно один раз при получении import.completed. */
  onCompleted?: (payload: ImportCompletedPayload) => void;
  /** Вызывается ровно один раз при получении import.failed. */
  onFailed?: (payload: ImportFailedPayload) => void;
}

export interface UseImportDetailResult {
  importLog: ImportLog | null;
  /** Live-overlay поверх данных REST'а (с WS). null если ещё нет события. */
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

  // ── SWR с conditional polling ───────────────────────────────────────
  const key = enabled
    ? (['tracker.import', orgId, importLogId] as const)
    : null;

  const swr = useSWR(
    key,
    async () => {
      if (!orgId || !importLogId) throw new Error('orgId/importLogId required');
      return importsApi.getById(orgId, importLogId);
    },
    {
      revalidateOnFocus: false,
      refreshInterval: (latest) => {
        // SWR API: refreshInterval может быть функцией от последнего значения.
        if (!latest) return POLL_INTERVAL_MS;
        return latest.status === 'running' ? POLL_INTERVAL_MS : 0;
      },
    },
  );

  const importLog = useMemo<ImportLog | null>(
    () => (swr.data ? importLogFromApi(swr.data) : null),
    [swr.data],
  );

  // ── WS overlay ──────────────────────────────────────────────────────
  const { client, connected } = useTrackerWebSocket(orgId ?? null, enabled);
  const [live, setLive] = useState<ImportLiveOverlay>({
    processed: null,
    phase: null,
  });

  // Гарантия, что onCompleted / onFailed вызовутся ровно один раз
  // на один importLogId.
  const finalizedRef = useRef<string | null>(null);

  // Колбэки кладём в ref, чтобы не пересоздавать подписку на каждый рендер
  // (родитель может передавать инлайн-функции).
  const onCompletedRef = useRef(options.onCompleted);
  const onFailedRef = useRef(options.onFailed);
  useEffect(() => {
    onCompletedRef.current = options.onCompleted;
    onFailedRef.current = options.onFailed;
  }, [options.onCompleted, options.onFailed]);

  useEffect(() => {
    if (!client || !importLogId) return;

    const offProgress = client.on('import.progress', (raw) => {
      const payload = raw as ImportProgressPayload | undefined;
      if (!payload || payload.importLogId !== importLogId) return;
      setLive({
        processed: payload.processed,
        phase: payload.phase,
      });
    });

    const offCompleted = client.on('import.completed', (raw) => {
      const payload = raw as ImportCompletedPayload | undefined;
      if (!payload || payload.importLogId !== importLogId) return;
      void swr.mutate();
      if (finalizedRef.current !== importLogId) {
        finalizedRef.current = importLogId;
        onCompletedRef.current?.(payload);
      }
    });

    const offFailed = client.on('import.failed', (raw) => {
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
    // swr.mutate стабилен в SWR; включаем client + importLogId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, importLogId]);

  // Сброс live overlay при смене importLogId.
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
