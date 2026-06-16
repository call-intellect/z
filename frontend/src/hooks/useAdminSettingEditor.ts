"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import type { ZodTypeAny } from "zod";

import { apiClient } from "@/api/api-client";
import { ApiError } from "@/api/api-error";
import type { AdminSettingHistoryEntry } from "@/ui/components/admin/AdminSettingHistoryDrawer";

export type AdminSettingSeverity = "low" | "medium" | "high" | "destructive";

export type AdminSettingEditorOptions<T> = {
  schema: ZodTypeAny;
  defaultValue: T;
  requiresReason?: AdminSettingSeverity;
};

type AdminSettingApiPayload<T> = {
  key: string;
  value: T;
  updatedAt?: string;
  updatedBy?: string | null;
};

const MIN_REASON_LENGTH = 10;

type SafeParseIssue = { message?: string };
type SafeParseResult =
  | { success: true; data: unknown }
  | { success: false; error: { issues: SafeParseIssue[] } };

export function useAdminSettingEditor<T>(
  key: string,
  opts: AdminSettingEditorOptions<T>,
): {
  value: T;
  setValue: (next: T) => void;
  save: (reason?: string) => Promise<void>;
  reset: () => void;
  isDirty: boolean;
  isLoading: boolean;
  isSaving: boolean;
  history: AdminSettingHistoryEntry[];
  refetchHistory: () => Promise<void>;
  error: string | null;
} {
  const { schema, defaultValue, requiresReason } = opts;

  const swrKey = key ? `admin-setting-editor:${key}` : null;
  const historyKey = key ? `admin-setting-history:${key}` : null;

  const {
    data,
    error: fetchError,
    isLoading,
    mutate,
  } = useSWR<AdminSettingApiPayload<T>>(
    swrKey,
    () =>
      apiClient.get<AdminSettingApiPayload<T>>(
        `/api/v1/admin/settings/${encodeURIComponent(key)}`,
      ),
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    },
  );

  const historyRes = useSWR<{ items: AdminSettingHistoryEntry[] }>(
    historyKey,
    () =>
      apiClient.get<{ items: AdminSettingHistoryEntry[] }>(
        `/api/v1/admin/settings/${encodeURIComponent(key)}/history`,
      ),
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    },
  );

  const remoteValue: T = (data?.value ?? defaultValue) as T;
  const [draft, setDraft] = useState<T>(remoteValue);
  const [isSaving, setIsSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (data) {
      setDraft(data.value as T);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.updatedAt, key]);

  const setValue = useCallback((next: T) => {
    setDraft(next);
    setLocalError(null);
  }, []);

  const reset = useCallback(() => {
    setDraft(remoteValue);
    setLocalError(null);
  }, [remoteValue]);

  const isDirty = useMemo(
    () => safeJson(draft) !== safeJson(remoteValue),
    [draft, remoteValue],
  );

  const save = useCallback(
    async (reason?: string): Promise<void> => {
      if (isSaving) return;
      setLocalError(null);

      const needsReason =
        requiresReason === "high" || requiresReason === "destructive";
      if (needsReason) {
        const trimmed = (reason ?? "").trim();
        if (trimmed.length < MIN_REASON_LENGTH) {
          const e = new Error(
            `Причина обязательна и должна быть минимум ${MIN_REASON_LENGTH} символов.`,
          );
          setLocalError(e.message);
          throw e;
        }
      }

      if (schema) {
        type AnySchema = { safeParse?: (v: unknown) => SafeParseResult };
        const result = (schema as unknown as AnySchema).safeParse?.(draft);
        if (result && result.success === false) {
          const issues = result.error?.issues ?? [];
          const msg =
            issues
              .map((i) => i.message ?? "некорректное значение")
              .join("; ") || "Значение не прошло валидацию";
          setLocalError(msg);
          throw new Error(msg);
        }
      }

      try {
        setIsSaving(true);
        const body: { value: T; reason?: string } = { value: draft };
        if (reason) body.reason = reason.trim();
        await apiClient.post(
          `/api/v1/admin/settings/${encodeURIComponent(key)}`,
          body,
        );
        await mutate();
        await historyRes.mutate();
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Не удалось сохранить настройку";
        setLocalError(message);
        throw err;
      } finally {
        setIsSaving(false);
      }
    },
    [isSaving, requiresReason, schema, draft, key, mutate, historyRes],
  );

  const refetchHistory = useCallback(async (): Promise<void> => {
    await historyRes.mutate();
  }, [historyRes]);

  return {
    value: draft,
    setValue,
    save,
    reset,
    isDirty,
    isLoading,
    isSaving,
    history: historyRes.data?.items ?? [],
    refetchHistory,
    error:
      localError ??
      (fetchError instanceof Error
        ? fetchError.message
        : fetchError
          ? "Не удалось загрузить настройку"
          : null),
  };
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
