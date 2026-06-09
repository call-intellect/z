'use client';

import Link from 'next/link';
import { Gauge } from 'lucide-react';
import useSWR from 'swr';

import { qualityScoreApi } from '@/api/quality-score.api';
import {
  orgDashboardQualityScoreFromApi,
  qualityScoreColor,
} from '@/domain/quality-score';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';

/**
 * Виджет «Качество встреч» на дашборде директора (Фаза C §8.2).
 *
 * Источник правды: `GET /api/v1/org/dashboard/quality-score`.
 *
 * Показывает средний overallScore Org за последние 30 дней + топ-3 типов.
 * Кликабельна — ведёт на детальную страницу (заглушка `/dashboard` пока
 * детальной страницы нет).
 */
export function QualityScoreWidget() {
  const swr = useSWR(
    ['dashboard-quality-score'],
    async () => {
      const dto = await qualityScoreApi.getOrgDashboard({});
      return orgDashboardQualityScoreFromApi(dto);
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  if (swr.isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge size={16} className="text-accent" />
            Качество встреч
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-20" />
        </CardContent>
      </Card>
    );
  }

  if (!swr.data) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge size={16} className="text-accent" />
            Качество встреч
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Раздел появится после первых встреч с оценкой качества.
          </p>
        </CardContent>
      </Card>
    );
  }

  const { averageScore, meetingsCount, byType } = swr.data;
  const color = qualityScoreColor(Math.round(averageScore));
  const colorClass =
    color === 'red'
      ? 'text-danger'
      : color === 'yellow'
        ? 'text-warning'
        : 'text-success';

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge size={16} className="text-accent" />
          Качество встреч
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {meetingsCount === 0 ? (
          <p className="text-sm text-muted-foreground">
            За период нет встреч с оценкой качества.
          </p>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <div className={`text-3xl font-bold tabular-nums ${colorClass}`}>
                {Math.round(averageScore)}
              </div>
              <div className="text-sm text-muted-foreground">из 100</div>
            </div>
            <p className="text-xs text-muted-foreground">
              Средняя оценка по {meetingsCount} {meetingsPluralRu(meetingsCount)} за период.
            </p>
            {byType.length > 0 ? (
              <ul className="space-y-1 text-sm">
                {byType.slice(0, 3).map((b) => (
                  <li key={b.type} className="flex justify-between">
                    <span className="text-fg-secondary">{b.type}</span>
                    <span className="tabular-nums font-medium">{b.avg}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <Link
              href="/dashboard"
              className="inline-flex items-center text-xs font-medium text-accent hover:underline"
            >
              Подробнее →
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function meetingsPluralRu(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'встречам';
  if (mod10 === 1) return 'встрече';
  if (mod10 >= 2 && mod10 <= 4) return 'встречам';
  return 'встречам';
}
