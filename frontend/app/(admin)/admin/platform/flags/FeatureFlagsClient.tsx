'use client';

/**
 * `/admin/platform/flags` — список и редактирование FeatureFlag.
 * Фаза 8 редизайна Z-Admin.
 *
 * Вкладки (AdminTabs):
 *   - Список: таблица всех FeatureFlag.
 *   - По Org: группировка overrides по tenantId (read-only с подсказкой).
 *   - История переключений (заглушка): отдельный эндпоинт пока не реализован.
 */

import { useMemo, useState } from 'react';
import {
  Edit3,
  History as HistoryIcon,
  List,
  Plus,
  Trash2,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';

import { adminFeatureFlagsApi } from '@/api/admin-feature-flags.api';
import { ApiError } from '@/api/api-error';
import {
  featureFlagListFromApi,
  type FeatureFlagDomain,
  FEATURE_FLAG_CATEGORIES,
} from '@/domain/admin-feature-flag';
import { AdminSection } from '@/ui/components/admin/AdminSection';
import { AdminTabs, type AdminTabDef } from '@/ui/components/admin/AdminTabs';
import { DangerAction } from '@/ui/components/admin/AdminDangerZone';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Switch } from '@/ui/shadcn/switch';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../../AdminStateViews';
import { useAdminQuery } from '../../useAdminQuery';
import { FlagEditDialog } from './FlagEditDialog';
import { adminRootCrumb } from '@/ui/components/admin/brand';

const TABS: AdminTabDef[] = [
  { value: 'list', label: 'Список', icon: List },
  { value: 'by-org', label: 'По Org', icon: Users },
  { value: 'history', label: 'История переключений', icon: HistoryIcon },
];

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  FEATURE_FLAG_CATEGORIES.map((c) => [c.value, c.label]),
);

export function FeatureFlagsClient() {
  const [editing, setEditing] = useState<FeatureFlagDomain | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const q = useAdminQuery('admin-platform-flags', async () => {
    const res = await adminFeatureFlagsApi.list();
    return featureFlagListFromApi(res);
  });

  const handleToggleDefault = async (flag: FeatureFlagDomain) => {
    try {
      await adminFeatureFlagsApi.update(flag.key, {
        defaultValue: !flag.defaultValue,
      });
      toast.success(
        !flag.defaultValue
          ? `Флаг «${flag.key}» включён глобально`
          : `Флаг «${flag.key}» выключен глобально`,
      );
      q.refetch();
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Не удалось переключить флаг',
      );
    }
  };

  const handleDelete = async (flag: FeatureFlagDomain) => {
    try {
      await adminFeatureFlagsApi.remove(flag.key);
      toast.success(`Флаг «${flag.key}» удалён`);
      q.refetch();
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Не удалось удалить флаг',
      );
      throw e;
    }
  };

  return (
    <AdminSection
      breadcrumbs={[
        adminRootCrumb(),
        { label: 'Платформа' },
        { label: 'Feature flags' },
      ]}
      title="Feature flags"
      description="Глобальные дефолты и Org-overrides для фич Z. Изменения сразу попадают в LRU-кэш всех процессов через Redis pub/sub."
      actions={
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus size={14} className="mr-1" aria-hidden />
          Новый флаг
        </Button>
      }
    >
      {q.isLoading && <AdminLoading rows={5} />}
      {!q.isLoading && q.isForbidden && <AdminForbidden />}
      {!q.isLoading && q.error && (
        <AdminError message={q.error} onRetry={q.refetch} />
      )}
      {!q.isLoading && !q.error && !q.isForbidden && !q.data ? (
        <AdminEmpty
          title="Feature flags недоступны"
          description="Бэкенд-эндпоинт /api/v1/admin/platform/feature-flags ещё не реализован. Управление перейдёт сюда после Фазы 8 (backend)."
        />
      ) : null}
      {!q.isLoading && q.data ? (
        <AdminTabs tabs={TABS} defaultTab="list">
          {(active) => {
            if (active === 'list') {
              return q.data!.items.length === 0 ? (
                <AdminEmpty
                  title="Флагов пока нет"
                  description="Создайте первый флаг через кнопку «Новый флаг»."
                />
              ) : (
                <FlagsTable
                  rows={q.data!.items}
                  onEdit={(f) => setEditing(f)}
                  onToggle={(f) => void handleToggleDefault(f)}
                  onDelete={(f) => handleDelete(f)}
                />
              );
            }
            if (active === 'by-org') {
              return <ByOrgTab flags={q.data!.items} />;
            }
            return (
              <AdminEmpty
                title="История переключений ещё не реализована"
                description="После Фазы 9 здесь появится журнал всех изменений флагов с временными метками и причинами."
              />
            );
          }}
        </AdminTabs>
      ) : null}

      <FlagEditDialog
        flag={editing}
        open={editing !== null || createOpen}
        mode={editing !== null ? 'edit' : 'create'}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null);
            setCreateOpen(false);
          }
        }}
        onSaved={() => {
          setEditing(null);
          setCreateOpen(false);
          q.refetch();
        }}
      />
    </AdminSection>
  );
}

// ─────────────────────────── List tab ───────────────────────────

function FlagsTable({
  rows,
  onEdit,
  onToggle,
  onDelete,
}: {
  rows: FeatureFlagDomain[];
  onEdit: (f: FeatureFlagDomain) => void;
  onToggle: (f: FeatureFlagDomain) => void;
  onDelete: (f: FeatureFlagDomain) => Promise<void>;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border-subtle">
      <table className="w-full text-sm">
        <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
          <tr>
            <th className="px-3 py-2 text-left">Ключ</th>
            <th className="px-3 py-2 text-left">Описание</th>
            <th className="px-3 py-2 text-left">Категория</th>
            <th className="px-3 py-2 text-center">Default</th>
            <th className="px-3 py-2 text-right">Org-overrides</th>
            <th className="px-3 py-2 text-right">Rollout %</th>
            <th className="px-3 py-2 text-right">Действия</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => (
            <tr
              key={f.key}
              className="border-t border-border-subtle align-top hover:bg-bg-overlay"
              title={`Дефолт: ${f.defaultValue ? 'вкл' : 'выкл'}; overrides: ${f.orgOverridesCount}`}
            >
              <td className="px-3 py-3">
                <code className="rounded bg-bg-overlay px-1.5 py-0.5 text-[11px] font-medium text-fg-primary">
                  {f.key}
                </code>
              </td>
              <td className="px-3 py-3 max-w-[280px] text-xs text-fg-secondary">
                {f.description || '—'}
              </td>
              <td className="px-3 py-3 text-xs">
                <Badge variant="secondary" className="text-[10px]">
                  {CATEGORY_LABELS[f.category] ?? f.category}
                </Badge>
              </td>
              <td className="px-3 py-3 text-center">
                <Switch
                  checked={f.defaultValue}
                  onCheckedChange={() => onToggle(f)}
                  aria-label="Переключить дефолтное значение"
                />
              </td>
              <td className="px-3 py-3 text-right tabular-nums">
                {f.orgOverridesCount}
              </td>
              <td className="px-3 py-3 text-right tabular-nums text-xs">
                {f.rolloutPercent === null
                  ? '—'
                  : `${f.rolloutPercent}%`}
              </td>
              <td className="px-3 py-3 text-right">
                <div className="flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onEdit(f)}
                    title="Редактировать"
                  >
                    <Edit3 size={13} aria-hidden />
                  </Button>
                  <DangerAction
                    label=""
                    triggerVariant="ghost"
                    title={`Удалить флаг «${f.key}»?`}
                    description="Удаление безвозвратно. Если код проверяет этот ключ — он получит дефолт false."
                    severity="destructive"
                    confirmLabel="Удалить"
                    onConfirm={async () => onDelete(f)}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────── By-org tab ───────────────────────────

function ByOrgTab({ flags }: { flags: FeatureFlagDomain[] }) {
  const grouped = useMemo(() => {
    const map = new Map<
      string,
      Array<{ key: string; value: boolean }>
    >();
    for (const f of flags) {
      for (const [orgId, value] of Object.entries(f.orgOverrides ?? {})) {
        const arr = map.get(orgId) ?? [];
        arr.push({ key: f.key, value });
        map.set(orgId, arr);
      }
    }
    return Array.from(map.entries()).sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
  }, [flags]);

  if (grouped.length === 0) {
    return (
      <AdminEmpty
        title="Override'ов нет"
        description="Ни одна Org не получает индивидуальные значения флагов. Все Org используют глобальный default."
      />
    );
  }

  return (
    <div className="space-y-3">
      {grouped.map(([orgId, entries]) => (
        <div
          key={orgId}
          className="rounded-md border border-border-subtle bg-bg-card p-3"
        >
          <div className="mb-2 flex items-center gap-2">
            <code className="rounded bg-bg-overlay px-2 py-0.5 text-xs font-medium">
              {orgId}
            </code>
            <Badge variant="secondary" className="text-[10px]">
              {entries.length} override(s)
            </Badge>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {entries.map((it) => (
              <Badge
                key={it.key}
                variant={it.value ? 'success' : 'warning'}
                className="text-[10px] font-mono"
              >
                {it.key}: {it.value ? 'вкл' : 'выкл'}
              </Badge>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
