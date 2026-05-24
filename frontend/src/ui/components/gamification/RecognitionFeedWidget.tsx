'use client';

import { useEffect, useState } from 'react';

import { ApiError } from '@/api/api-error';
import { gamificationApi } from '@/api/gamification.api';
import {
  contributionFromApi,
  formatRuDate,
  type RecognitionEntry,
} from '@/domain/contribution';
import { Badge } from '@/ui/shadcn/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';

/**
 * T1 (2026-05-23) — лента последних 5 Recognition (моих полученных).
 *
 * Источник — `/me/contributions.recentRecognitions` (там уже последние 10);
 * берём первые `limit`.
 */
export function RecognitionFeedWidget({ limit = 5 }: { limit?: number }) {
  const [items, setItems] = useState<RecognitionEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    gamificationApi
      .getMyContributions()
      .then((dto) => {
        if (cancelled) return;
        const c = contributionFromApi(dto);
        setItems(c.recentRecognitions.slice(0, limit));
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Не удалось загрузить благодарности';
        setError(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [limit]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Благодарности</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-fg-secondary">Загрузка…</p>
        ) : error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : !items || items.length === 0 ? (
          <p className="text-sm text-fg-secondary">
            Пока тихо. Это нормально — благодарности приходят волнами.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-1 rounded-md border border-border-subtle bg-bg-overlay p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="default">{r.typeLabel}</Badge>
                  <span className="text-xs text-fg-secondary">
                    {formatRuDate(r.createdAt)}
                  </span>
                </div>
                {r.message ? (
                  <p className="text-sm text-fg-primary">{r.message}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
