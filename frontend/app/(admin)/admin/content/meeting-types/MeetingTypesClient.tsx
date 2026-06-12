'use client';

import { useState } from 'react';
import { Edit3, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/api/api-error';
import { adminMeetingTypesApi } from '@/api/admin-meeting-types.api';
import {
  meetingTypeListFromApi,
  type MeetingTypeItemDomain,
} from '@/domain/admin-meeting-type';
import { AdminSection } from '@/ui/components/admin/AdminSection';
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
import { MeetingTypeEditDialog } from './MeetingTypeEditDialog';
import { adminRootCrumb } from '@/ui/components/admin/brand';

/**
 * `/admin/content/meeting-types` — CRUD конфигурации типов встреч (Z-Admin
 * Фаза 5). Каждая запись — это строка в `MeetingTypeConfig`, привязанная
 * к значению Prisma `enum MeetingType`.
 *
 * Бэкенд при пустой БД делает bootstrap-sync из enum, поэтому таблица
 * никогда не бывает пустой при первом открытии.
 */
export function MeetingTypesClient() {
  const [editing, setEditing] = useState<MeetingTypeItemDomain | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [existingIds, setExistingIds] = useState<string[]>([]);

  const q = useAdminQuery('admin-meeting-types', async () => {
    const res = await adminMeetingTypesApi.list();
    const dom = meetingTypeListFromApi(res);
    setExistingIds(dom.items.map((it) => it.id));
    return dom;
  });

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (m: MeetingTypeItemDomain) => {
    setEditing(m);
    setDialogOpen(true);
  };

  const toggleActive = async (m: MeetingTypeItemDomain) => {
    try {
      await adminMeetingTypesApi.update(m.id, { isActive: !m.isActive });
      toast.success(
        !m.isActive ? `Тип ${m.id} включён` : `Тип ${m.id} выключен`,
      );
      q.refetch();
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Не удалось обновить статус',
      );
    }
  };

  const softDelete = async (m: MeetingTypeItemDomain) => {
    try {
      await adminMeetingTypesApi.remove(m.id);
      toast.success(`Тип ${m.id} деактивирован`);
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
        { label: 'Типы встреч' },
      ]}
      title="Типы встреч"
      description="Конфигурация 9 типов встреч MVP: отображаемое имя, иконка, описание, привязка к промпту отчёта. id — это значение enum MeetingType."
      actions={
        <Button onClick={openCreate} size="sm">
          <Plus size={14} /> Создать тип
        </Button>
      }
    >
      {q.isLoading && <AdminLoading rows={5} />}
      {!q.isLoading && q.isForbidden && <AdminForbidden />}
      {!q.isLoading && q.error && (
        <AdminError message={q.error} onRetry={q.refetch} />
      )}
      {!q.isLoading &&
        q.data &&
        (q.data.items.length === 0 ? (
          <AdminEmpty
            title="Типов встреч пока нет"
            description="Бэкенд должен был засеять список из enum MeetingType. Проверьте, что эндпоинт /api/v1/admin/content/meeting-types отвечает."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border-subtle">
            <table className="w-full text-sm">
              <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
                <tr>
                  <th className="px-3 py-2 text-left">Id</th>
                  <th className="px-3 py-2 text-left">Название</th>
                  <th className="px-3 py-2 text-left">Описание</th>
                  <th className="px-3 py-2 text-left">Иконка</th>
                  <th className="px-3 py-2 text-left">Промпт</th>
                  <th className="px-3 py-2 text-center">Активен</th>
                  <th className="px-3 py-2 text-left">Действия</th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((m) => (
                  <MeetingTypeRow
                    key={m.id}
                    item={m}
                    onEdit={() => openEdit(m)}
                    onToggleActive={() => void toggleActive(m)}
                    onSoftDelete={() => void softDelete(m)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ))}

      <MeetingTypeEditDialog
        item={editing}
        existingIds={existingIds}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={() => {
          q.refetch();
        }}
      />
    </AdminSection>
  );
}

function MeetingTypeRow({
  item,
  onEdit,
  onToggleActive,
  onSoftDelete,
}: {
  item: MeetingTypeItemDomain;
  onEdit: () => void;
  onToggleActive: () => void;
  onSoftDelete: () => void;
}) {
  return (
    <tr className="border-t border-border-subtle align-top hover:bg-bg-overlay">
      <td className="px-3 py-3">
        <code className="rounded bg-bg-overlay px-1.5 py-0.5 text-[11px]">
          {item.id}
        </code>
        {!item.isActive && (
          <Badge variant="warning" className="ml-2 text-[10px]">
            неактивен
          </Badge>
        )}
      </td>
      <td className="px-3 py-3 font-medium">{item.displayName}</td>
      <td className="px-3 py-3 max-w-[280px] text-xs text-fg-tertiary">
        {item.description || '—'}
      </td>
      <td className="px-3 py-3 text-xs">
        {item.icon ? (
          <code className="rounded bg-bg-overlay px-1.5 py-0.5">{item.icon}</code>
        ) : (
          <span className="text-fg-tertiary">—</span>
        )}
      </td>
      <td className="px-3 py-3 text-xs text-fg-tertiary">
        {item.reportPromptKey || '—'}
      </td>
      <td className="px-3 py-3 text-center">
        <Switch checked={item.isActive} onCheckedChange={onToggleActive} />
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
            onClick={onSoftDelete}
            className="text-danger hover:bg-danger/10"
            title="Деактивировать (soft-delete)"
            disabled={!item.isActive}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </td>
    </tr>
  );
}
