'use client';

/**
 * `/admin/media/storage` — S3 хранилище. Фаза 7 редизайна Z-Admin.
 *
 * Три вкладки:
 *   - Бакеты (таблица: имя / провайдер / endpoint / объекты / размер / статус)
 *   - Статистика (KPI tiles: общий объём, прогноз, прирост, largest bucket)
 *   - Переключение провайдера (`storage.provider`, severity='destructive')
 *
 * Источник данных — backend `/api/v1/admin/media/storage`. Если эндпоинт ещё
 * не реализован — AdminEmpty. Переключение провайдера дополнительно требует
 * подтверждения через AdminDangerZone (причина ≥ 10 символов).
 */

import { useCallback } from 'react';
import {
  Boxes,
  Cloud,
  HardDrive,
  Loader2,
  RefreshCw,
  Settings2,
  TrendingUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';

import { adminStorageApi } from '@/api/admin-storage.api';
import { ApiError } from '@/api/api-error';
import {
  storageOverviewFromApi,
  STORAGE_PROVIDER_LABELS,
  type StorageBucketDomain,
  type StorageOverviewDomain,
  type StorageProviderApi,
  type StorageStatsDomain,
} from '@/domain/admin-storage';
import { AdminSection } from '@/ui/components/admin/AdminSection';
import { AdminTabs, type AdminTabDef } from '@/ui/components/admin/AdminTabs';
import {
  AdminDangerZone,
  DangerAction,
} from '@/ui/components/admin/AdminDangerZone';
import { AdminSettingField } from '@/ui/components/admin/AdminSettingField';
import { useAdminSettingEditor } from '@/hooks/useAdminSettingEditor';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../../AdminStateViews';
import { useAdminQuery } from '../../useAdminQuery';

const TABS: AdminTabDef[] = [
  { value: 'buckets', label: 'Бакеты', icon: Boxes },
  { value: 'stats', label: 'Статистика', icon: TrendingUp },
  { value: 'switch', label: 'Переключение провайдера', icon: Settings2 },
];

const STORAGE_PROVIDER_SCHEMA = z.enum([
  'yandex',
  'selectel',
  'sbercloud',
  'minio',
]);

export function StorageClient() {
  const q = useAdminQuery('admin-storage-overview', async () => {
    const res = await adminStorageApi.overview();
    return storageOverviewFromApi(res);
  });

  return (
    <AdminSection
      breadcrumbs={[
        { label: 'Z-Admin', href: '/admin' },
        { label: 'Записи и медиа' },
        { label: 'S3 хранилище' },
      ]}
      title="S3 хранилище"
      description="Обзор бакетов, объёмов и провайдера. Переключение провайдера затронет загрузку и скачивание записей — выполняйте в окно maintenance."
      actions={
        <Button
          size="sm"
          variant="outline"
          onClick={q.refetch}
          disabled={q.isLoading}
        >
          <RefreshCw size={13} className="mr-1" aria-hidden />
          Обновить
        </Button>
      }
    >
      {q.isLoading && <AdminLoading rows={5} />}
      {!q.isLoading && q.isForbidden && <AdminForbidden />}
      {!q.isLoading && q.error && (
        <AdminError message={q.error} onRetry={q.refetch} />
      )}
      {!q.isLoading && !q.error && !q.isForbidden ? (
        <AdminTabs tabs={TABS} defaultTab="buckets">
          {(active) => {
            if (active === 'buckets')
              return <BucketsTab data={q.data} fallback={!q.data} />;
            if (active === 'stats')
              return <StatsTab data={q.data} fallback={!q.data} />;
            if (active === 'switch')
              return <SwitchTab overview={q.data} onSaved={q.refetch} />;
            return null;
          }}
        </AdminTabs>
      ) : null}
    </AdminSection>
  );
}

// ─────────────────────────── Бакеты ───────────────────────────

function BucketsTab({
  data,
  fallback,
}: {
  data: StorageOverviewDomain | null;
  fallback: boolean;
}) {
  if (fallback) return <FallbackEmpty section="бакетов" />;
  if (!data || data.buckets.length === 0) {
    return (
      <AdminEmpty
        title="Бакеты не настроены"
        description="Добавьте бакет в backend-конфигурацию или подключите внешнее хранилище."
      />
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border-subtle">
      <table className="w-full text-sm">
        <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
          <tr>
            <th className="px-3 py-2 text-left">Бакет</th>
            <th className="px-3 py-2 text-left">Провайдер</th>
            <th className="px-3 py-2 text-left">Endpoint</th>
            <th className="px-3 py-2 text-right">Объекты</th>
            <th className="px-3 py-2 text-right">Размер, ГБ</th>
            <th className="px-3 py-2 text-left">Статус</th>
          </tr>
        </thead>
        <tbody>
          {data.buckets.map((b) => (
            <BucketRow key={b.name} bucket={b} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BucketRow({ bucket }: { bucket: StorageBucketDomain }) {
  const statusVariant: 'secondary' | 'danger' | 'outline' | 'success' =
    bucket.status === 'ok'
      ? 'success'
      : bucket.status === 'warning'
        ? 'secondary'
        : 'danger';
  return (
    <tr className="border-t border-border-subtle align-top hover:bg-bg-overlay">
      <td
        className="max-w-[200px] truncate px-3 py-2 font-mono text-xs"
        title={bucket.name}
      >
        {bucket.name}
      </td>
      <td className="px-3 py-2 text-xs">{bucket.providerLabel}</td>
      <td
        className="max-w-[220px] truncate px-3 py-2 font-mono text-[11px] text-fg-tertiary"
        title={bucket.endpoint}
      >
        {bucket.endpoint}
      </td>
      <td className="px-3 py-2 text-right text-xs">
        {bucket.objectsCount.toLocaleString('ru-RU')}
      </td>
      <td className="px-3 py-2 text-right text-xs font-semibold">
        {bucket.sizeGB.toLocaleString('ru-RU')}
      </td>
      <td className="px-3 py-2 text-xs">
        <Badge variant={statusVariant}>{bucket.statusLabel}</Badge>
      </td>
    </tr>
  );
}

// ─────────────────────────── Статистика ───────────────────────────

function StatsTab({
  data,
  fallback,
}: {
  data: StorageOverviewDomain | null;
  fallback: boolean;
}) {
  if (fallback || !data) return <FallbackEmpty section="статистики" />;
  const s: StorageStatsDomain = data.stats;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <KpiTile
        label="Общий объём, ГБ"
        value={s.totalGB.toLocaleString('ru-RU')}
        icon={<HardDrive size={14} className="text-fg-secondary" />}
      />
      <KpiTile
        label="Всего объектов"
        value={s.totalObjects.toLocaleString('ru-RU')}
        icon={<Boxes size={14} className="text-fg-secondary" />}
      />
      <KpiTile
        label="Самый большой бакет"
        value={s.largestBucket ?? '—'}
        icon={<Cloud size={14} className="text-fg-secondary" />}
        valueClassName="text-sm font-mono"
      />
      <KpiTile
        label="Прирост, ГБ/день"
        value={
          s.growthGBPerDay !== null
            ? s.growthGBPerDay.toLocaleString('ru-RU')
            : '—'
        }
        icon={<TrendingUp size={14} className="text-fg-secondary" />}
      />
      <KpiTile
        label="Прогноз через месяц, ГБ"
        value={
          s.forecastNextMonthGB !== null
            ? s.forecastNextMonthGB.toLocaleString('ru-RU')
            : 'недостаточно данных'
        }
        icon={<TrendingUp size={14} className="text-fg-secondary" />}
      />
      <KpiTile
        label="Проверено"
        value={s.checkedAt.toLocaleString('ru-RU')}
      />
    </div>
  );
}

function KpiTile({
  label,
  value,
  icon,
  valueClassName,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-xl border border-border-subtle bg-bg-elevated p-4">
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-fg-tertiary">
        {icon ?? null}
        <span>{label}</span>
      </div>
      <div
        className={`mt-2 truncate text-lg font-semibold text-fg-primary ${
          valueClassName ?? ''
        }`}
      >
        {value}
      </div>
    </div>
  );
}

// ─────────────────────────── Переключение провайдера ───────────────────────────

function SwitchTab({
  overview,
  onSaved,
}: {
  overview: StorageOverviewDomain | null;
  onSaved: () => void;
}) {
  const editor = useAdminSettingEditor<StorageProviderApi>('storage.provider', {
    schema: STORAGE_PROVIDER_SCHEMA,
    defaultValue: overview?.currentProvider ?? 'minio',
    requiresReason: 'destructive',
  });

  const handleConfirm = useCallback(
    async (reason?: string) => {
      const finalReason = (reason ?? '').trim();
      if (finalReason.length < 10) {
        throw new Error(
          'Причина обязательна и должна быть не короче 10 символов.',
        );
      }
      try {
        await editor.save(finalReason);
        // Параллельно — низкоуровневый switch, если backend требует отдельный
        // эндпоинт для применения (drain queue, кэшсброса и т.п.). Игнорируем
        // 404 — основной путь это AdminSetting.
        try {
          await adminStorageApi.switchProvider(editor.value, finalReason);
        } catch (e) {
          if (e instanceof ApiError && e.code === 'http_404') {
            // эндпоинт необязательный — настройка уже сохранена
          } else {
            throw e;
          }
        }
        toast.success(
          'Провайдер S3 обновлён. Все процессы подхватят изменение в течение 30 секунд.',
        );
        onSaved();
      } catch (e) {
        const msg =
          e instanceof ApiError
            ? e.message
            : e instanceof Error
              ? e.message
              : 'Не удалось переключить провайдера';
        toast.error(msg);
        throw e instanceof Error ? e : new Error(msg);
      }
    },
    [editor, onSaved],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
        Переключение провайдера S3 затронет загрузку, скачивание и шеринг всех
        записей. Перед сменой убедитесь, что данные перенесены в новый бакет
        (миграция объектов выполняется отдельным скриптом). Делайте в окно
        maintenance.
      </div>

      <div className="rounded-xl border border-border-subtle bg-bg-elevated p-4">
        <p className="mb-2 text-xs text-fg-tertiary">
          Текущий провайдер:{' '}
          <span className="font-medium text-fg-primary">
            {STORAGE_PROVIDER_LABELS[
              overview?.currentProvider ?? editor.value
            ] ?? editor.value}
          </span>
        </p>
        <AdminSettingField<StorageProviderApi>
          schema={STORAGE_PROVIDER_SCHEMA}
          value={editor.value}
          onChange={editor.setValue}
          label="Провайдер S3"
          description="yandex / selectel / sbercloud / minio. Изменение требует причины не короче 10 символов — попадёт в журнал super_admin."
          disabled={editor.isLoading || editor.isSaving}
          error={editor.error ?? undefined}
        />
      </div>

      <AdminDangerZone
        title="Опасная зона"
        description="Переключение провайдера — необратимая операция в рамках текущей сессии (откат возможен через ту же форму, но идущие upload'ы могут зафейлиться)."
      >
        <div className="flex flex-col gap-2">
          <DangerAction
            label={
              editor.isSaving ? 'Переключаем…' : 'Переключить провайдера S3'
            }
            title="Переключить провайдера S3?"
            description={
              <span>
                Текущий: <b>{overview?.currentProviderLabel ?? '—'}</b>. Новый:{' '}
                <b>{STORAGE_PROVIDER_LABELS[editor.value] ?? editor.value}</b>.
                Все идущие upload&apos;ы будут переадресованы на новый бакет.
                Опишите причину переключения — она попадёт в журнал super_admin.
              </span>
            }
            severity="destructive"
            onConfirm={(reason) => handleConfirm(reason)}
            disabled={!editor.isDirty || editor.isSaving}
            confirmLabel={editor.isSaving ? 'Переключаем…' : 'Подтвердить'}
          />
          {editor.isSaving ? (
            <p className="inline-flex items-center gap-1 text-xs text-fg-tertiary">
              <Loader2 size={12} className="animate-spin" aria-hidden />
              Применяем изменения…
            </p>
          ) : null}
        </div>
      </AdminDangerZone>
    </div>
  );
}

// ─────────────────────────── helpers ───────────────────────────

function FallbackEmpty({ section }: { section: string }) {
  return (
    <AdminEmpty
      title={`Раздел «${section}» недоступен`}
      description="Backend-эндпоинт /api/v1/admin/media/storage ещё не реализован. Управление перейдёт сюда после Фазы 7 (backend)."
    />
  );
}
