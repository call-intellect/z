'use client';

import { useEffect, useState } from 'react';

import { ApiError } from '@/api/api-error';
import { gamificationApi } from '@/api/gamification.api';
import {
  formatRuDate,
  nameInitials,
  teamSpotlightFromApi,
  type TeamSpotlight,
} from '@/domain/contribution';
import { Avatar, AvatarFallback, AvatarImage } from '@/ui/shadcn/avatar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/ui/shadcn/card';

/**
 * T1 (2026-05-23) — `<TeamSpotlightWidget>` для COO Dashboard / руководителя.
 *
 * Top 3-5 человек по Recognition за неделю. БЕЗ топа-1, БЕЗ нумерации позиций.
 * Каждый — со своей мягкой причиной отметки.
 */
export function TeamSpotlightWidget({ orgId }: { orgId: string }) {
  const [data, setData] = useState<TeamSpotlight | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) {
      setError('Организация не выбрана');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    gamificationApi
      .getTeamSpotlight(orgId)
      .then((dto) => {
        if (!cancelled) {
          setData(teamSpotlightFromApi(dto));
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.code === 'forbidden') {
          setError('Недостаточно прав на просмотр спотлайта команды');
        } else {
          const msg =
            err instanceof ApiError
              ? err.message
              : err instanceof Error
                ? err.message
                : 'Не удалось загрузить спотлайт';
          setError(msg);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Команда на этой неделе</CardTitle>
        {data ? (
          <CardDescription>
            {formatRuDate(data.from)} — {formatRuDate(data.to)}
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-sm text-fg-secondary">Загрузка…</p>
        ) : error ? (
          <p className="text-sm text-danger">{error}</p>
        ) : !data || data.persons.length === 0 ? (
          <p className="text-sm text-fg-secondary">
            На этой неделе пока нет отметок — самое время сказать кому-нибудь спасибо.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {data.persons.map((p) => (
              <li
                key={p.userId}
                className="flex items-start gap-3 rounded-md border border-border-subtle bg-bg-overlay p-3"
              >
                <Avatar className="h-10 w-10">
                  {p.avatar ? <AvatarImage src={p.avatar} alt={p.name} /> : null}
                  <AvatarFallback>{nameInitials(p.name)}</AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium text-fg-primary">{p.name}</span>
                  <span className="text-xs text-fg-secondary">{p.highlightReason}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
