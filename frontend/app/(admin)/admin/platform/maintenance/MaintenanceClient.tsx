'use client';

/**
 * `/admin/platform/maintenance` — Фаза 8 редизайна Z-Admin.
 *
 * Три блока:
 *   - Бэкапы: статус + кнопка «Запустить бэкап сейчас». Если бэк вернул 501
 *     (Not Implemented) — кнопка disabled с подсказкой TODO.
 *   - Реиндексация: кнопка «Запустить реиндексацию» (тот же 501-flow).
 *   - Активные maintenance windows — из SystemMessage type='maintenance'.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Archive,
  DatabaseZap,
  Loader2,
  RefreshCw,
  ServerCog,
} from 'lucide-react';
import { toast } from 'sonner';

import { adminMaintenanceApi } from '@/api/admin-maintenance.api';
import { adminSystemMessagesApi } from '@/api/admin-system-messages.api';
import { ApiError } from '@/api/api-error';
import {
  formatBytes,
  maintenanceStatusFromApi,
  type MaintenanceStatusDomain,
} from '@/domain/admin-maintenance';
import {
  systemMessageListFromApi,
  SYSTEM_MESSAGE_SEVERITY_LABELS,
  type SystemMessageItemDomain,
} from '@/domain/admin-system-message';
import { AdminSection } from '@/ui/components/admin/AdminSection';
import { DangerAction } from '@/ui/components/admin/AdminDangerZone';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../../AdminStateViews';
import { useAdminQuery } from '../../useAdminQuery';
import { adminRootCrumb } from '@/ui/components/admin/brand';

type StatusState =
  | { kind: 'loading' }
  | { kind: 'forbidden' }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'ready'; data: MaintenanceStatusDomain };

export function MaintenanceClient() {
  const [status, setStatus] = useState<StatusState>({ kind: 'loading' });

  const loadStatus = useCallback(async () => {
    setStatus({ kind: 'loading' });
    try {
      const res = await adminMaintenanceApi.status();
      setStatus({ kind: 'ready', data: maintenanceStatusFromApi(res) });
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 'forbidden') {
          setStatus({ kind: 'forbidden' });
          return;
        }
        if (e.code === 'http_404' || e.code === 'http_501') {
          setStatus({
            kind: 'unavailable',
            reason:
              'Бэкенд-эндпоинт /api/v1/admin/platform/maintenance ещё не реализован.',
          });
          return;
        }
        setStatus({ kind: 'unavailable', reason: e.message });
        return;
      }
      setStatus({
        kind: 'unavailable',
        reason:
          e instanceof Error ? e.message : 'Не удалось загрузить статус',
      });
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  return (
    <AdminSection
      breadcrumbs={[
        adminRootCrumb(),
        { label: 'Платформа' },
        { label: 'Бэкапы и обслуживание' },
      ]}
      title="Бэкапы и обслуживание"
      description="Резервное копирование БД, реиндексация поисковых индексов и активные maintenance-окна для пользователей."
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => void loadStatus()}
          disabled={status.kind === 'loading'}
        >
          <RefreshCw size={14} className="mr-1" aria-hidden />
          Обновить
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        {status.kind === 'loading' ? <AdminLoading rows={3} /> : null}
        {status.kind === 'forbidden' ? <AdminForbidden /> : null}
        {status.kind === 'unavailable' ? (
          <AdminEmpty
            title="Состояние обслуживания недоступно"
            description={status.reason}
          />
        ) : null}

        {status.kind === 'ready' ? (
          <>
            <BackupsCard
              data={status.data}
              onRunBackup={async (reason) => {
                try {
                  await adminMaintenanceApi.backupNow(reason ?? '');
                  toast.success('Бэкап запущен');
                  await loadStatus();
                } catch (e) {
                  const msg =
                    e instanceof ApiError
                      ? e.message
                      : e instanceof Error
                        ? e.message
                        : 'Не удалось запустить бэкап';
                  toast.error(msg);
                  throw e instanceof Error ? e : new Error(msg);
                }
              }}
            />
            <ReindexCard
              data={status.data}
              onRunReindex={async (reason) => {
                try {
                  await adminMaintenanceApi.reindexNow(reason ?? '');
                  toast.success('Реиндексация запущена');
                  await loadStatus();
                } catch (e) {
                  const msg =
                    e instanceof ApiError
                      ? e.message
                      : e instanceof Error
                        ? e.message
                        : 'Не удалось запустить реиндексацию';
                  toast.error(msg);
                  throw e instanceof Error ? e : new Error(msg);
                }
              }}
            />
          </>
        ) : null}

        <ActiveMaintenanceWindowsCard />
      </div>
    </AdminSection>
  );
}

// ─────────────────────────── Бэкапы ───────────────────────────

function BackupsCard({
  data,
  onRunBackup,
}: {
  data: MaintenanceStatusDomain;
  onRunBackup: (reason?: string) => Promise<void>;
}) {
  const enabled = data.backups.enabled;
  return (
    <Card icon={Archive} title="Бэкапы">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <KV
          label="Последний бэкап"
          value={
            data.backups.lastBackupAt
              ? data.backups.lastBackupAt.toLocaleString('ru-RU')
              : '—'
          }
        />
        <KV
          label="Размер"
          value={formatBytes(data.backups.lastBackupSizeBytes)}
        />
        <KV
          label="Следующий по расписанию"
          value={
            data.backups.nextScheduledAt
              ? data.backups.nextScheduledAt.toLocaleString('ru-RU')
              : '—'
          }
        />
      </div>
      <div className="mt-3 flex items-center gap-2">
        {enabled ? (
          <DangerAction
            label="Запустить бэкап сейчас"
            triggerVariant="outline"
            title="Запустить внеочередной бэкап?"
            description="Это может занять несколько минут и нагрузит БД. Лучше делать в часы низкой нагрузки."
            severity="medium"
            confirmLabel="Запустить"
            onConfirm={onRunBackup}
          />
        ) : (
          <Button variant="outline" size="sm" disabled title="Бэкапы не подключены">
            Запустить бэкап сейчас
          </Button>
        )}
        {!enabled ? (
          <p className="text-[11px] text-fg-tertiary">
            TODO: подключить backup-pipeline в этой инсталляции
            (см. plan Фазы 8 backend).
          </p>
        ) : null}
      </div>
    </Card>
  );
}

// ─────────────────────────── Реиндексация ───────────────────────────

function ReindexCard({
  data,
  onRunReindex,
}: {
  data: MaintenanceStatusDomain;
  onRunReindex: (reason?: string) => Promise<void>;
}) {
  return (
    <Card icon={DatabaseZap} title="Реиндексация">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <KV
          label="Последний запуск"
          value={
            data.reindex.lastRunAt
              ? data.reindex.lastRunAt.toLocaleString('ru-RU')
              : '—'
          }
        />
        <KV
          label="Сейчас выполняется"
          value={data.reindex.inProgress ? 'да' : 'нет'}
        />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <DangerAction
          label="Запустить реиндексацию"
          triggerVariant="outline"
          title="Запустить реиндексацию?"
          description="Пересчитываются HNSW + GIN индексы для pgvector. На больших таблицах может занять долго."
          severity="medium"
          confirmLabel="Запустить"
          disabled={data.reindex.inProgress}
          onConfirm={onRunReindex}
        />
        {data.reindex.inProgress ? (
          <span className="inline-flex items-center gap-1 text-xs text-fg-tertiary">
            <Loader2 size={12} className="animate-spin" aria-hidden />
            идёт реиндексация…
          </span>
        ) : null}
      </div>
    </Card>
  );
}

// ─────────────────────────── Maintenance окна ───────────────────────────

function ActiveMaintenanceWindowsCard() {
  const q = useAdminQuery(
    'admin-platform-maintenance-windows',
    async () => {
      const res = await adminSystemMessagesApi.list();
      return systemMessageListFromApi(res);
    },
  );

  const now = Date.now();
  const active =
    q.data?.items.filter(
      (m) =>
        m.type === 'maintenance' &&
        m.isActive &&
        (!m.startsAt || m.startsAt.getTime() <= now) &&
        (!m.endsAt || m.endsAt.getTime() >= now),
    ) ?? [];

  return (
    <Card icon={ServerCog} title="Активные maintenance-окна">
      {q.isLoading ? <AdminLoading rows={2} /> : null}
      {q.error ? <AdminError message={q.error} onRetry={q.refetch} /> : null}
      {!q.isLoading && !q.error && active.length === 0 ? (
        <p className="text-xs text-fg-tertiary">
          Активных окон обслуживания нет. Окна создаются в разделе{' '}
          <a
            href="/admin/content/system-messages"
            className="underline hover:text-fg-primary"
          >
            «Контент → Системные сообщения»
          </a>{' '}
          (type=maintenance).
        </p>
      ) : null}
      {active.length > 0 ? (
        <ul className="space-y-2">
          {active.map((m) => (
            <MaintenanceWindowRow key={m.id} m={m} />
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function MaintenanceWindowRow({ m }: { m: SystemMessageItemDomain }) {
  const severityVariant: 'danger' | 'warning' | 'secondary' =
    m.severity === 'critical'
      ? 'danger'
      : m.severity === 'warning'
        ? 'warning'
        : 'secondary';
  return (
    <li className="rounded-md border border-border-subtle bg-bg-card p-3">
      <div className="mb-1 flex items-center gap-2">
        <Badge variant={severityVariant} className="text-[10px]">
          {SYSTEM_MESSAGE_SEVERITY_LABELS[m.severity] ?? m.severity}
        </Badge>
        <span className="text-[11px] text-fg-tertiary">
          {m.startsAt ? m.startsAt.toLocaleString('ru-RU') : '∞'} →{' '}
          {m.endsAt ? m.endsAt.toLocaleString('ru-RU') : '∞'}
        </span>
      </div>
      <p className="text-sm text-fg-primary">{m.body}</p>
      {m.targetOrgs.length > 0 ? (
        <p className="mt-1 text-[11px] text-fg-tertiary">
          Только для Org:{' '}
          {m.targetOrgs.map((id) => (
            <code key={id} className="ml-1 rounded bg-bg-overlay px-1 py-0.5">
              {id}
            </code>
          ))}
        </p>
      ) : null}
    </li>
  );
}

// ─────────────────────────── helpers ───────────────────────────

function Card({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Archive;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border-subtle bg-bg-card p-4">
      <header className="mb-3 flex items-center gap-2">
        <Icon size={16} className="text-fg-secondary" aria-hidden />
        <h3 className="text-sm font-medium text-fg-primary">{title}</h3>
      </header>
      <div>{children}</div>
    </section>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border-subtle bg-bg-overlay px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-fg-tertiary">
        {label}
      </p>
      <p className="text-sm tabular-nums text-fg-primary">{value}</p>
    </div>
  );
}

