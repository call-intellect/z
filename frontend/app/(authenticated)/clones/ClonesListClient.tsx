'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { Bot, Sparkles, Users } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { clonesApi } from '@/api/clones.api';
import { useAuth } from '@/contexts/auth-context';
import {
  mapCloneListItem,
  type CloneListUiItem,
} from '@/domain/clone';
import { Badge } from '@/ui/shadcn/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Input } from '@/ui/shadcn/input';
import { Skeleton } from '@/ui/shadcn/skeleton';

import { AdminForbidden } from '../admin/AdminStateViews';

/**
 * `/clones` (Clones=Roles Ф4) — список ролевых клонов Org.
 *
 * UI:
 *   - Шапка с описанием категории «клоны должностей».
 *   - Фильтры: статус (active / superseded), поиск по Role.name, confidence-порог.
 *   - Сортировка: по дате rebuild / по confidence.
 *   - Сетка карточек: «Клон <Role.name> v<N>» + bearer + confidence-бар +
 *     traits count + lastBuildAt + кнопка «Открыть» → `/roles/:id/clone`.
 *   - Empty state: «Клоны должностей появятся, когда RoleClonePersonaBuild
 *     соберёт первые v1».
 *
 * Слой ApiDto → DomainModel (`mapCloneListItem`) → UiModel компонента.
 */
export function ClonesListClient() {
  const { currentOrgId, isLoading } = useAuth();
  if (isLoading) return <ClonesListSkeleton />;
  if (!currentOrgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Раздел доступен только внутри Org."
      />
    );
  }
  return <Content orgId={currentOrgId} />;
}

type StatusFilter = 'active' | 'superseded';
type SortKey = 'lastBuildAt' | 'confidence';

function Content({ orgId }: { orgId: string }) {
  const [status, setStatus] = useState<StatusFilter>('active');
  const [q, setQ] = useState('');
  const [confidenceMin, setConfidenceMin] = useState<number>(0);
  const [sortKey, setSortKey] = useState<SortKey>('lastBuildAt');

  const { data, error, isLoading, mutate } = useSWR(
    ['clones-list', orgId, status, q.trim(), confidenceMin],
    () =>
      clonesApi.listClones(orgId, {
        status,
        ...(q.trim() ? { q: q.trim() } : {}),
        ...(confidenceMin > 0 ? { confidenceMin } : {}),
        pageSize: 100,
      }),
    { revalidateOnFocus: false },
  );

  const items: CloneListUiItem[] = useMemo(() => {
    const mapped = (data?.items ?? []).map(mapCloneListItem);
    const sorted = [...mapped].sort((a, b) => {
      if (sortKey === 'confidence') return b.confidencePct - a.confidencePct;
      return b.lastBuildAt.getTime() - a.lastBuildAt.getTime();
    });
    return sorted;
  }, [data, sortKey]);

  const errorView = (() => {
    if (!error) return null;
    if (error instanceof ApiError && error.code === 'forbidden') {
      return <AdminForbidden />;
    }
    const message =
      error instanceof ApiError ? error.message : 'Не удалось загрузить клонов.';
    return (
      <div className="rounded-md border border-border-subtle bg-bg-card p-6 text-sm">
        <p className="text-error">{message}</p>
        <button
          type="button"
          onClick={() => void mutate()}
          className="mt-3 rounded-md border border-border-subtle px-3 py-1.5 text-xs hover:bg-bg-hover"
        >
          Повторить
        </button>
      </div>
    );
  })();

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Клоны должностей
        </h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Клон отвечает в стиле должности, а не конкретного сотрудника. Когда
          носитель роли меняется, клон сохраняет накопленный опыт и продолжает
          версионироваться. Всего:{' '}
          {data?.total ?? 0}.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2">
          {(['active', 'superseded'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                status === s
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border-subtle text-fg-secondary hover:border-border-strong'
              }`}
            >
              {s === 'active' ? 'Активные' : 'Архивные'}
            </button>
          ))}
        </div>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск по названию должности"
          className="max-w-xs"
        />
        <label className="flex items-center gap-2 text-xs text-fg-secondary">
          <span>Минимум уверенности</span>
          <select
            value={String(confidenceMin)}
            onChange={(e) => setConfidenceMin(Number(e.target.value))}
            className="rounded-md border border-border-subtle bg-bg-card px-2 py-1 text-sm"
          >
            <option value="0">Любая</option>
            <option value="0.3">≥ 30%</option>
            <option value="0.6">≥ 60%</option>
            <option value="0.8">≥ 80%</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-fg-secondary">
          <span>Сортировка</span>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="rounded-md border border-border-subtle bg-bg-card px-2 py-1 text-sm"
          >
            <option value="lastBuildAt">По дате обновления</option>
            <option value="confidence">По уверенности</option>
          </select>
        </label>
      </div>

      {errorView}

      {!errorView && isLoading ? (
        <ClonesGridSkeleton />
      ) : !errorView && items.length === 0 ? (
        <EmptyHint />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <CloneCard key={item.personaId} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function CloneCard({ item }: { item: CloneListUiItem }) {
  return (
    <Link
      href={`/roles/${encodeURIComponent(item.roleId)}/clone`}
      className="block focus:outline-none"
    >
      <Card className="h-full transition-colors hover:border-accent">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="line-clamp-1 text-base">
              {item.publicName}
            </CardTitle>
            <Badge variant={item.status === 'active' ? 'default' : 'secondary'}>
              {item.status === 'active' ? 'Активен' : 'Архив'}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-fg-tertiary">
            {item.departmentName ?? 'Без отдела'}
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-fg-secondary">
            <Users size={14} />
            <span>
              {item.bearerName
                ? `Сейчас на роли: ${item.bearerName}`
                : 'Носитель не назначен'}
            </span>
          </div>
          <div>
            <div className="flex items-center justify-between text-xs text-fg-tertiary">
              <span className="flex items-center gap-1">
                <Sparkles size={12} />
                Уверенность
              </span>
              <span>{item.confidencePct}%</span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-bg-muted">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${item.confidencePct}%` }}
              />
            </div>
          </div>
          <div className="flex items-center justify-between text-xs text-fg-tertiary">
            <span className="flex items-center gap-1">
              <Bot size={12} />
              {item.traitsCount} {pluralTraits(item.traitsCount)}
            </span>
            <span>
              Обновлён {item.lastBuildAt.toLocaleDateString('ru-RU')}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function EmptyHint() {
  return (
    <div className="rounded-md border border-dashed border-border-subtle bg-bg-card p-8 text-center">
      <Bot className="mx-auto mb-3 h-8 w-8 text-fg-tertiary" />
      <p className="text-sm text-fg-primary">
        Клонов должностей пока нет.
      </p>
      <p className="mt-1 text-xs text-fg-tertiary">
        Они появятся автоматически, когда RoleClonePersonaBuild соберёт первые
        v1 — нужны накопленные обсуждения подхода к решениям у сотрудников.
      </p>
    </div>
  );
}

function ClonesListSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="mt-2 h-4 w-1/2" />
      <ClonesGridSkeleton />
    </div>
  );
}

function ClonesGridSkeleton() {
  return (
    <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-40 w-full" />
      ))}
    </div>
  );
}

function pluralTraits(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'черта';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'черты';
  return 'черт';
}
