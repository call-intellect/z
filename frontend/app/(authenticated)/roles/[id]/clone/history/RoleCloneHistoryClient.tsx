'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import useSWR from 'swr';
import { ArrowLeft, History } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { clonesApi } from '@/api/clones.api';
import { useAuth } from '@/contexts/auth-context';
import {
  mapCloneVersion,
  type CloneVersionUiItem,
} from '@/domain/clone';
import { Badge } from '@/ui/shadcn/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';

import { AdminForbidden } from '@app/(admin)/admin/AdminStateViews';

/**
 * `/roles/:id/clone/history` (Clones=Roles Ф4) — история версий клона роли.
 */
export function RoleCloneHistoryClient({ roleId }: { roleId: string }) {
  const { currentOrgId, isLoading } = useAuth();
  if (isLoading) return <HistorySkeleton />;
  if (!currentOrgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Раздел доступен только внутри организации."
      />
    );
  }
  return <Content orgId={currentOrgId} roleId={roleId} />;
}

function Content({ orgId, roleId }: { orgId: string; roleId: string }) {
  const { data, error, isLoading } = useSWR(
    ['clone-history', orgId, roleId],
    () => clonesApi.getCloneHistory(orgId, roleId),
  );

  const versions: CloneVersionUiItem[] = useMemo(
    () => (data?.versions ?? []).map(mapCloneVersion),
    [data],
  );

  if (isLoading) return <HistorySkeleton />;

  if (error) {
    const message =
      error instanceof ApiError ? error.message : 'Не удалось загрузить историю.';
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        <BackLink roleId={roleId} />
        <div className="mt-4 rounded-md border border-border-subtle bg-bg-card p-6 text-sm">
          <p className="text-error">{message}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-6 py-8">
      <BackLink roleId={roleId} />

      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          История клона должности: {data.roleName}
        </h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Каждая версия — отдельный snapshot клона. Версии создаются при смене
          носителя роли или при накоплении значимых изменений в навыковом
          профиле.
        </p>
      </header>

      {versions.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <History className="mx-auto mb-3 h-8 w-8 text-fg-tertiary" />
            <p className="text-sm text-fg-primary">
              У клона пока единственная версия (v1).
            </p>
            <p className="mt-1 text-xs text-fg-tertiary">
              Новые версии появятся, когда сменится носитель роли или накопится
              достаточно изменений в навыковом профиле.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Версии ({versions.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border-subtle">
              {versions.map((v) => (
                <li
                  key={v.personaId}
                  className="grid grid-cols-1 gap-1 py-3 text-sm sm:grid-cols-[auto,1fr,auto] sm:items-center sm:gap-4"
                >
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={v.status === 'active' ? 'default' : 'secondary'}
                    >
                      v{v.version}
                    </Badge>
                    <span className="font-medium">{v.publicName}</span>
                  </div>
                  <div className="text-xs text-fg-secondary">
                    <div>
                      Носитель:{' '}
                      {v.bearerName ? (
                        v.bearerPersonId ? (
                          <Link
                            href={`/persons/${encodeURIComponent(v.bearerPersonId)}`}
                            className="text-accent underline-offset-2 hover:underline"
                          >
                            {v.bearerName}
                          </Link>
                        ) : (
                          v.bearerName
                        )
                      ) : (
                        <span className="text-fg-tertiary">не зафиксирован</span>
                      )}
                    </div>
                    <div className="mt-0.5">
                      Период:{' '}
                      {v.validFrom.toLocaleDateString('ru-RU')} —{' '}
                      {v.validUntil
                        ? v.validUntil.toLocaleDateString('ru-RU')
                        : 'по сейчас'}
                    </div>
                  </div>
                  <div className="text-xs text-fg-tertiary sm:text-right">
                    <div>Уверенность: {v.confidencePct}%</div>
                    <div>Черт: {v.traitsCount}</div>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function BackLink({ roleId }: { roleId: string }) {
  return (
    <Link
      href={`/roles/${encodeURIComponent(roleId)}/clone`}
      className="inline-flex items-center gap-1 text-sm text-fg-secondary hover:text-fg-primary"
    >
      <ArrowLeft size={14} />К клону должности
    </Link>
  );
}

function HistorySkeleton() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 px-6 py-8">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}
