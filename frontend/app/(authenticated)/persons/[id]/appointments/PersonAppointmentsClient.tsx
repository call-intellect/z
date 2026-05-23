'use client';

import Link from 'next/link';
import { ArrowLeft, Briefcase } from 'lucide-react';
import useSWR from 'swr';

import { ApiError } from '@/api/api-error';
import {
  appointmentsApi,
  type AppointmentTimelineItemApi,
} from '@/api/appointments.api';
import { useAuth } from '@/contexts/auth-context';
import { Badge } from '@/ui/shadcn/badge';
import { Skeleton } from '@/ui/shadcn/skeleton';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
} from '../../../admin/AdminStateViews';

const STATUS_LABEL: Record<AppointmentTimelineItemApi['status'], string> = {
  active: 'действующее',
  acting: 'и. о.',
  former: 'архив',
};

/**
 * SBA α-8 wave 4 — детальный timeline назначений сотрудника.
 * Альтернатива/дополнение к секции в PersonDetailClient.
 */
export function PersonAppointmentsClient({ entityId }: { entityId: string }) {
  const { currentOrgId, isLoading } = useAuth();
  if (isLoading) return null;
  if (!currentOrgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Этот раздел доступен только в рамках Org."
      />
    );
  }
  return <Content orgId={currentOrgId} entityId={entityId} />;
}

function Content({ orgId, entityId }: { orgId: string; entityId: string }) {
  const swr = useSWR(['appointments-timeline', orgId, entityId], () =>
    appointmentsApi.entityTimeline(orgId, entityId),
  );

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <Link
        href={`/persons/${entityId}`}
        className="mb-3 inline-flex items-center gap-1 text-xs text-fg-tertiary hover:text-fg-secondary"
      >
        <ArrowLeft size={12} /> К карточке персоны
      </Link>

      <header className="mb-6">
        <h1 className="inline-flex items-center gap-2 text-2xl font-semibold tracking-tight text-fg-primary">
          <Briefcase size={20} />
          История назначений
        </h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Полный timeline должностей: отделы, нагрузка, длительности, статусы.
        </p>
      </header>

      {swr.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : swr.error ? (
        swr.error instanceof ApiError && swr.error.code === 'http_404' ? (
          <AdminEmpty
            title="Назначения недоступны"
            description="API назначений не отвечает или сотрудник не найден."
          />
        ) : (
          <AdminError
            message={
              swr.error instanceof Error
                ? swr.error.message
                : 'Не удалось загрузить назначения'
            }
            onRetry={() => void swr.mutate()}
          />
        )
      ) : !swr.data?.items?.length ? (
        <AdminEmpty
          title="Назначений нет"
          description="Сотрудник ещё не был назначен ни на одну должность."
        />
      ) : (
        <ul className="space-y-3">
          {swr.data.items.map((it) => (
            <AppointmentRow key={it.id} item={it} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AppointmentRow({ item }: { item: AppointmentTimelineItemApi }) {
  return (
    <li className="rounded-lg border border-border-subtle bg-bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium text-fg-primary">
            {item.roleName ?? 'Должность'}
          </div>
          <div className="text-sm text-fg-secondary">
            {item.departmentName ?? 'Без отдела'} · нагрузка {item.loadPercent}%
          </div>
        </div>
        <Badge variant={item.status === 'active' ? 'default' : 'secondary'}>
          {STATUS_LABEL[item.status]}
        </Badge>
      </div>
      <div className="mt-2 text-xs text-fg-tertiary">
        {formatDate(item.validFrom)}
        {item.validTo
          ? ` — ${formatDate(item.validTo)}`
          : ' — по настоящее время'}
        {item.durationDays !== null && ` (${item.durationDays} дн.)`}
      </div>
    </li>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('ru-RU', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    return iso;
  }
}
