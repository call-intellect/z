'use client';

import Link from 'next/link';
import {
  Building2,
  FileText,
  IdCard,
  Sparkles,
  Users,
} from 'lucide-react';
import useSWR from 'swr';

import { ApiError } from '@/api/api-error';
import { structureApi } from '@/api/structure.api';
import { useAuth } from '@/contexts/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';

/**
 * Виджет «Структура компании» — карточки-счётчики (отделов / должностей /
 * сотрудников / документов / карт должностей). Каждая кликабельна.
 *
 * Если API `/api/v1/structure/summary` ещё не готов — виджет тихо
 * сворачивается до плэйсхолдера «Раздел в разработке».
 */
export function StructureSummaryWidget() {
  const { currentOrgId } = useAuth();
  const swr = useSWR(
    currentOrgId ? ['dashboard-structure-summary', currentOrgId] : null,
    () => structureApi.summary(currentOrgId!),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 size={16} className="text-accent" />
          Структура компании
        </CardTitle>
      </CardHeader>
      <CardContent>
        {swr.isLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        ) : swr.error ? (
          <p className="text-sm text-fg-tertiary">
            {swr.error instanceof ApiError && swr.error.code === 'http_404'
              ? 'Сводка появится после готовности backend.'
              : 'Не удалось загрузить сводку.'}
          </p>
        ) : swr.data ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <SummaryTile
              href="/structure?tab=departments"
              icon={<Building2 size={16} />}
              label="Отделов"
              value={swr.data.departments}
            />
            <SummaryTile
              href="/structure?tab=roles"
              icon={<IdCard size={16} />}
              label="Должностей"
              value={swr.data.roles}
            />
            <SummaryTile
              href="/structure?tab=persons"
              icon={<Users size={16} />}
              label="Сотрудников"
              value={swr.data.persons}
            />
            <SummaryTile
              href="/documents"
              icon={<FileText size={16} />}
              label="Документов"
              value={swr.data.documents}
            />
            <SummaryTile
              href="/roles"
              icon={<Sparkles size={16} />}
              label="Карт должностей"
              value={swr.data.roleProfiles.total}
              caption={`${swr.data.roleProfiles.ready} готово · ${swr.data.roleProfiles.forming} формируется`}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SummaryTile({
  href,
  icon,
  label,
  value,
  caption,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  value: number;
  caption?: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-md border border-border-subtle bg-bg-card p-3 transition-colors hover:border-accent"
    >
      <div className="flex items-center justify-between text-fg-tertiary">
        {icon}
        <span className="text-xs uppercase tracking-wider">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-fg-primary">
        {value}
      </div>
      {caption && (
        <div className="mt-1 text-[10px] text-fg-tertiary">{caption}</div>
      )}
    </Link>
  );
}
