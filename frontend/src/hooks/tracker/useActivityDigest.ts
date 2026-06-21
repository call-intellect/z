"use client";

import { useCallback, useState } from "react";

import {
  activityDigestApi,
  type ActivityDigestApi,
} from "@/api/tracker/activity-digest.api";

export interface UseActivityDigestResult {
  digest: ActivityDigestApi | null;
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  reset: () => void;
}

export function useActivityDigest(
  orgId: string | null | undefined,
  issueId: string | null | undefined,
): UseActivityDigestResult {
  const [digest, setDigest] = useState<ActivityDigestApi | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId || !issueId || isLoading) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await activityDigestApi.get(orgId, issueId);
      setDigest(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось собрать сводку");
    } finally {
      setIsLoading(false);
    }
  }, [orgId, issueId, isLoading]);

  const reset = useCallback(() => {
    setDigest(null);
    setError(null);
  }, []);

  return { digest, isLoading, error, load, reset };
}
