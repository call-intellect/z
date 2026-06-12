'use client';

import { useMemo, useState } from 'react';
import { Edit3, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/api/api-error';
import { adminSystemMessagesApi } from '@/api/admin-system-messages.api';
import { adminOrgsApi } from '@/api/admin-orgs.api';
import { adminOrgListFromApi } from '@/domain/admin-org';
import {
  SYSTEM_MESSAGE_SEVERITY_LABELS,
  systemMessageListFromApi,
  type SystemMessageItemDomain,
} from '@/domain/admin-system-message';
import { AdminSection } from '@/ui/components/admin/AdminSection';
import { AdminTabs, type AdminTabDef } from '@/ui/components/admin/AdminTabs';
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
import { MessageEditDialog } from './MessageEditDialog';
import { adminRootCrumb } from '@/ui/components/admin/brand';

const TABS: AdminTabDef[] = [
  { value: 'banner', label: 'Баннеры' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'alert', label: 'Алёрты' },
];

/**
 * `/admin/content/system-messages` — управление SystemMessage записями.
 *
 * SystemMessage — единая таблица, разделённая по `type` на три вкладки.
 * Создание / редактирование — через `MessageEditDialog`. Soft-delete
 * деактивирует запись (isActive=false), полное удаление сделано через
 * DELETE-эндпоинт.
 */
export function SystemMessagesClient() {
  const [editing, setEditing] = useState<SystemMessageItemDomain | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogType, setDialogType] = useState<string>('banner');

  const q = useAdminQuery('admin-system-messages', async () => {
    const res = await adminSystemMessagesApi.list();
    return systemMessageListFromApi(res);
  });

  // Загружаем список Org один раз, чтобы в диалоге показать multiselect.
  const orgs = useAdminQuery('admin-system-messages-orgs', async () => {
    const res = await adminOrgsApi.list({ limit: 500 });
    return adminOrgListFromApi(res);
  });

  const itemsByType = useMemo(() => {
    const map = new Map<string, SystemMessageItemDomain[]>();
    for (const it of q.data?.items ?? []) {
      if (!map.has(it.type)) map.set(it.type, []);
      map.get(it.type)!.push(it);
    }
    return map;
  }, [q.data]);

  const openCreate = (type: string) => {
    setEditing(null);
    setDialogType(type);
    setDialogOpen(true);
  };

  const openEdit = (m: SystemMessageItemDomain) => {
    setEditing(m);
    setDialogType(m.type);
    setDialogOpen(true);
  };

  const toggleActive = async (m: SystemMessageItemDomain) => {
    try {
      await adminSystemMessagesApi.update(m.id, { isActive: !m.isActive });
      toast.success(!m.isActive ? 'Сообщение включено' : 'Сообщение выключено');
      q.refetch();
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Не удалось обновить статус',
      );
    }
  };

  const remove = async (m: SystemMessageItemDomain) => {
    try {
      await adminSystemMessagesApi.remove(m.id);
      toast.success('Сообщение удалено');
      q.refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Не удалось удалить');
    }
  };

  return (
    <AdminSection
      breadcrumbs={[
        adminRootCrumb(),
        { label: 'Контент' },
        { label: 'Системные сообщения' },
      ]}
      title="Системные сообщения"
      description="Баннеры пользователей, режим maintenance и критические алёрты. Можно ограничивать показ конкретным Org или показывать всем."
    >
      {q.isLoading && <AdminLoading rows={4} />}
      {!q.isLoading && q.isForbidden && <AdminForbidden />}
      {!q.isLoading && q.error && (
        <AdminError message={q.error} onRetry={q.refetch} />
      )}
      {!q.isLoading && q.data && (
        <AdminTabs tabs={TABS} defaultTab="banner">
          {(active) => {
            const items = itemsByType.get(active) ?? [];
            return (
              <div className="space-y-3">
                <div className="flex justify-end">
                  <Button size="sm" onClick={() => openCreate(active)}>
                    <Plus size={14} /> Создать
                  </Button>
                </div>
                {items.length === 0 ? (
                  <AdminEmpty
                    title={`Нет записей типа «${
                      TABS.find((t) => t.value === active)?.label ?? active
                    }»`}
                    description="Создайте новое сообщение через кнопку «Создать»."
                  />
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-border-subtle">
                    <table className="w-full text-sm">
                      <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
                        <tr>
                          <th className="px-3 py-2 text-left">Severity</th>
                          <th className="px-3 py-2 text-left">Текст</th>
                          <th className="px-3 py-2 text-left">Начало</th>
                          <th className="px-3 py-2 text-left">Конец</th>
                          <th className="px-3 py-2 text-center">Активно</th>
                          <th className="px-3 py-2 text-right">Org</th>
                          <th className="px-3 py-2 text-left">Действия</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((m) => (
                          <MessageRow
                            key={m.id}
                            item={m}
                            onEdit={() => openEdit(m)}
                            onToggleActive={() => void toggleActive(m)}
                            onRemove={() => void remove(m)}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          }}
        </AdminTabs>
      )}

      <MessageEditDialog
        item={editing}
        defaultType={dialogType}
        orgs={orgs.data?.items ?? []}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={() => {
          q.refetch();
        }}
      />
    </AdminSection>
  );
}

function MessageRow({
  item,
  onEdit,
  onToggleActive,
  onRemove,
}: {
  item: SystemMessageItemDomain;
  onEdit: () => void;
  onToggleActive: () => void;
  onRemove: () => void;
}) {
  const sevVariant: 'success' | 'warning' | 'danger' | 'secondary' =
    item.severity === 'critical'
      ? 'danger'
      : item.severity === 'warning'
        ? 'warning'
        : item.severity === 'info'
          ? 'secondary'
          : 'secondary';

  return (
    <tr className="border-t border-border-subtle align-top hover:bg-bg-overlay">
      <td className="px-3 py-3">
        <Badge variant={sevVariant} className="text-[10px]">
          {SYSTEM_MESSAGE_SEVERITY_LABELS[item.severity] ?? item.severity}
        </Badge>
      </td>
      <td className="max-w-[400px] px-3 py-3 text-xs text-fg-secondary">
        <span className="line-clamp-2">{item.body}</span>
      </td>
      <td className="px-3 py-3 text-xs text-fg-tertiary">
        {item.startsAt ? item.startsAt.toLocaleString('ru-RU') : '—'}
      </td>
      <td className="px-3 py-3 text-xs text-fg-tertiary">
        {item.endsAt ? item.endsAt.toLocaleString('ru-RU') : '—'}
      </td>
      <td className="px-3 py-3 text-center">
        <Switch checked={item.isActive} onCheckedChange={onToggleActive} />
      </td>
      <td className="px-3 py-3 text-right tabular-nums text-xs">
        {item.targetOrgs.length === 0 ? (
          <span className="text-fg-tertiary">все</span>
        ) : (
          item.targetOrgs.length
        )}
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onEdit}
            title="Редактировать"
          >
            <Edit3 size={14} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            className="text-danger hover:bg-danger/10"
            title="Удалить"
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </td>
    </tr>
  );
}
