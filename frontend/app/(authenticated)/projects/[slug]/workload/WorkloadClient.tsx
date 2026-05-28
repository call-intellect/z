'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { useAuth } from '@/contexts/auth-context';
import { useProjectBySlug } from '@/hooks/tracker/useProjectBySlug';
import { useProjectWorkload } from '@/hooks/tracker/useProjectOverview';
import type { WorkloadRow } from '@/domain/tracker';

type SortKey = 'name' | 'open' | 'inProgress' | 'overdue' | 'completed7';
type SortDir = 'asc' | 'desc';

function userLabel(r: WorkloadRow): string {
  return r.userName?.trim() || r.userEmail?.split('@')[0] || r.userId.slice(0, 8);
}

function makeIssueListUrl(slug: string, userId: string): string {
  return `/projects/${encodeURIComponent(slug)}/list?assigneeUserId=${encodeURIComponent(userId)}`;
}

export function WorkloadClient({ slug }: { slug: string }) {
  const { currentOrgId } = useAuth();
  const { project } = useProjectBySlug(currentOrgId, slug);
  const projectId = project?.id ?? null;
  const { workload, isLoading, error } = useProjectWorkload(
    currentOrgId,
    projectId,
  );

  const [sortKey, setSortKey] = useState<SortKey>('open');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const sortedRows = useMemo<WorkloadRow[]>(() => {
    if (!workload) return [];
    const rows = [...workload.items];
    rows.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      switch (sortKey) {
        case 'name':
          return userLabel(a).localeCompare(userLabel(b), 'ru') * dir;
        case 'open':
          return (a.openCount - b.openCount) * dir;
        case 'inProgress':
          return (a.inProgressCount - b.inProgressCount) * dir;
        case 'overdue':
          return (a.overdueCount - b.overdueCount) * dir;
        case 'completed7':
          return (a.completedLast7dCount - b.completedLast7dCount) * dir;
      }
    });
    return rows;
  }, [workload, sortKey, sortDir]);

  const topOpenIds = useMemo<Set<string>>(() => {
    if (!workload) return new Set();
    const top = [...workload.items]
      .sort((a, b) => b.openCount - a.openCount)
      .slice(0, 3)
      .map((r) => r.userId);
    return new Set(top);
  }, [workload]);

  if (isLoading) {
    return (
      <div className="h-72 animate-pulse rounded-lg bg-bg-overlay" />
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-chip-danger-bg bg-chip-danger-bg/20 p-4 text-sm text-chip-danger-fg">
        Не удалось загрузить «Загруженность».
      </div>
    );
  }
  if (!workload || workload.items.length === 0) {
    return (
      <div className="rounded-lg border border-border-subtle bg-bg-elevated p-4 text-sm text-fg-tertiary">
        В проекте пока нет участников.
      </div>
    );
  }

  const handleSort = (k: SortKey): void => {
    if (sortKey === k) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(k);
      setSortDir('desc');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-fg-primary">Загруженность</h1>
        <p className="text-sm text-fg-tertiary">
          Кто чем занят в проекте. В среднем — {workload.avgOpenPerMember}{' '}
          открытых задач на участника.
        </p>
      </header>

      {/* desktop table */}
      <div className="hidden overflow-x-auto rounded-lg border border-border-subtle bg-bg-elevated md:block">
        <table className="w-full text-sm">
          <thead className="border-b border-border-subtle text-left text-xs uppercase tracking-wide text-fg-tertiary">
            <tr>
              <Th k="name" sortKey={sortKey} sortDir={sortDir} onClick={handleSort}>
                Участник
              </Th>
              <Th k="open" sortKey={sortKey} sortDir={sortDir} onClick={handleSort} align="right">
                Открыто
              </Th>
              <Th k="inProgress" sortKey={sortKey} sortDir={sortDir} onClick={handleSort} align="right">
                В работе
              </Th>
              <Th k="overdue" sortKey={sortKey} sortDir={sortDir} onClick={handleSort} align="right">
                Просрочено
              </Th>
              <Th k="completed7" sortKey={sortKey} sortDir={sortDir} onClick={handleSort} align="right">
                Завершено 7д
              </Th>
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((r) => {
              const isTop = topOpenIds.has(r.userId);
              return (
                <tr
                  key={r.userId}
                  className={
                    isTop
                      ? 'border-b border-border-subtle bg-chip-lavender-bg/30'
                      : 'border-b border-border-subtle'
                  }
                >
                  <td className="px-3 py-2 text-fg-primary">{userLabel(r)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <Link
                      href={makeIssueListUrl(slug, r.userId)}
                      className="text-fg-primary hover:text-accent hover:underline"
                    >
                      {r.openCount}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-fg-primary">
                    {r.inProgressCount}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <span
                      className={
                        r.overdueCount > 0
                          ? 'text-chip-danger-fg'
                          : 'text-fg-tertiary'
                      }
                    >
                      {r.overdueCount}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-fg-secondary">
                    {r.completedLast7dCount}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* mobile cards */}
      <ul className="flex flex-col gap-2 md:hidden">
        {sortedRows.map((r) => {
          const isTop = topOpenIds.has(r.userId);
          return (
            <li
              key={r.userId}
              className={
                isTop
                  ? 'rounded-lg border border-border-subtle bg-chip-lavender-bg/30 p-3'
                  : 'rounded-lg border border-border-subtle bg-bg-elevated p-3'
              }
            >
              <div className="font-medium text-fg-primary">{userLabel(r)}</div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                <dt className="text-fg-tertiary">Открыто</dt>
                <dd className="text-right tabular-nums text-fg-primary">
                  {r.openCount}
                </dd>
                <dt className="text-fg-tertiary">В работе</dt>
                <dd className="text-right tabular-nums text-fg-primary">
                  {r.inProgressCount}
                </dd>
                <dt className="text-fg-tertiary">Просрочено</dt>
                <dd
                  className={
                    r.overdueCount > 0
                      ? 'text-right tabular-nums text-chip-danger-fg'
                      : 'text-right tabular-nums text-fg-tertiary'
                  }
                >
                  {r.overdueCount}
                </dd>
                <dt className="text-fg-tertiary">Завершено 7д</dt>
                <dd className="text-right tabular-nums text-fg-secondary">
                  {r.completedLast7dCount}
                </dd>
              </dl>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Th({
  children,
  k,
  sortKey,
  sortDir,
  onClick,
  align = 'left',
}: {
  children: React.ReactNode;
  k: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onClick: (k: SortKey) => void;
  align?: 'left' | 'right';
}) {
  const active = k === sortKey;
  const arrow = active ? (sortDir === 'asc' ? '↑' : '↓') : '';
  return (
    <th
      className={
        align === 'right'
          ? 'cursor-pointer select-none px-3 py-2 text-right font-medium'
          : 'cursor-pointer select-none px-3 py-2 font-medium'
      }
      onClick={() => onClick(k)}
    >
      {children}
      {active ? <span className="ml-1 text-accent">{arrow}</span> : null}
    </th>
  );
}
