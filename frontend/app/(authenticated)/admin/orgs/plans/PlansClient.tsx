'use client';

import { useState } from 'react';
import { Edit3, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/api/api-error';
import { adminPlansApi } from '@/api/admin-plans.api';
import {
  formatPlanPrice,
  planListFromApi,
  type PlanItemDomain,
} from '@/domain/admin-plan';
import { AdminSection } from '@/ui/components/admin/AdminSection';
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
import { PlanEditDialog } from './PlanEditDialog';

/**
 * `/admin/orgs/plans` — CRUD тарифов продукта (Z-Admin Фаза 4).
 *
 * Список Plan с количеством Org на каждом тарифе. Создание / редактирование —
 * через `PlanEditDialog`. Soft-delete (isActive=false) кнопкой «Удалить» —
 * если есть хотя бы одна Org на этом тарифе. Если использующих Org нет,
 * админ через DangerAction может выполнить hard-delete.
 */
export function PlansClient() {
  const [editing, setEditing] = useState<PlanItemDomain | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const q = useAdminQuery('admin-plans', async () => {
    const res = await adminPlansApi.list();
    return planListFromApi(res);
  });

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (p: PlanItemDomain) => {
    setEditing(p);
    setDialogOpen(true);
  };

  const toggleActive = async (p: PlanItemDomain) => {
    try {
      await adminPlansApi.update(p.id, { isActive: !p.isActive });
      toast.success(
        !p.isActive ? `Тариф ${p.id} включён` : `Тариф ${p.id} выключен`,
      );
      q.refetch();
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Не удалось обновить статус',
      );
    }
  };

  const softDelete = async (p: PlanItemDomain) => {
    try {
      await adminPlansApi.remove(p.id);
      toast.success(`Тариф ${p.id} деактивирован`);
      q.refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Не удалось удалить');
    }
  };

  const hardDelete = async (p: PlanItemDomain) => {
    try {
      await adminPlansApi.remove(p.id, { hard: true });
      toast.success(`Тариф ${p.id} удалён`);
      q.refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Не удалось удалить');
      throw e;
    }
  };

  return (
    <AdminSection
      breadcrumbs={[
        { label: 'Z-Admin', href: '/admin' },
        { label: 'Тенанты' },
        { label: 'Тарифы' },
      ]}
      title="Тарифы продукта"
      description="CRUD планов продукта (Plan). Применяются к Org через OrgEntitlement.tier."
      actions={
        <Button onClick={openCreate} size="sm">
          <Plus size={14} /> Создать тариф
        </Button>
      }
    >
      {q.isLoading && <AdminLoading rows={4} />}
      {!q.isLoading && q.isForbidden && <AdminForbidden />}
      {!q.isLoading && q.error && (
        <AdminError message={q.error} onRetry={q.refetch} />
      )}
      {!q.isLoading &&
        q.data &&
        (q.data.items.length === 0 ? (
          <AdminEmpty
            title="Тарифы не созданы"
            description="Создайте первый тариф через кнопку «Создать тариф»."
          />
        ) : (
          <div className="space-y-3">
            <div className="overflow-x-auto rounded-lg border border-border-subtle">
              <table className="w-full text-sm">
                <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
                  <tr>
                    <th className="px-3 py-2 text-left">Id</th>
                    <th className="px-3 py-2 text-left">Название</th>
                    <th className="px-3 py-2 text-left">Описание</th>
                    <th className="px-3 py-2 text-right">Цена</th>
                    <th className="px-3 py-2 text-right">Org</th>
                    <th className="px-3 py-2 text-center">Активен</th>
                    <th className="px-3 py-2 text-left">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.items.map((p) => (
                    <PlanRow
                      key={p.id}
                      plan={p}
                      onEdit={() => openEdit(p)}
                      onToggleActive={() => void toggleActive(p)}
                      onSoftDelete={() => void softDelete(p)}
                      onHardDelete={() => hardDelete(p)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-fg-tertiary">
              Soft-delete (isActive=false) применяется автоматически, если на
              тарифе есть Org. Полное удаление возможно через раздел «Опасные
              действия» в каждой строке.
            </p>
          </div>
        ))}

      <PlanEditDialog
        plan={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={() => {
          q.refetch();
        }}
      />
    </AdminSection>
  );
}

function PlanRow({
  plan,
  onEdit,
  onToggleActive,
  onSoftDelete,
  onHardDelete,
}: {
  plan: PlanItemDomain;
  onEdit: () => void;
  onToggleActive: () => void;
  onSoftDelete: () => void;
  onHardDelete: () => Promise<void>;
}) {
  return (
    <tr className="border-t border-border-subtle align-top hover:bg-bg-overlay">
      <td className="px-3 py-3">
        <code className="rounded bg-bg-overlay px-1.5 py-0.5 text-[11px]">
          {plan.id}
        </code>
        {!plan.isActive && (
          <Badge variant="warning" className="ml-2 text-[10px]">
            неактивен
          </Badge>
        )}
      </td>
      <td className="px-3 py-3 font-medium">{plan.displayName}</td>
      <td className="px-3 py-3 max-w-[280px] text-xs text-fg-tertiary">
        {plan.description || '—'}
      </td>
      <td className="px-3 py-3 text-right tabular-nums">
        {formatPlanPrice(plan.monthlyPriceRub)}
      </td>
      <td className="px-3 py-3 text-right tabular-nums">{plan.orgsCount}</td>
      <td className="px-3 py-3 text-center">
        <Switch checked={plan.isActive} onCheckedChange={onToggleActive} />
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
          {plan.orgsCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onSoftDelete}
              className="text-danger hover:bg-danger/10"
              title="Деактивировать (soft-delete)"
              disabled={!plan.isActive}
            >
              <Trash2 size={14} />
            </Button>
          ) : (
            <DangerAction
              label="Удалить"
              triggerVariant="ghost"
              title={`Удалить тариф ${plan.id}?`}
              description="Этот тариф никем не используется — можно удалить полностью. Действие необратимо."
              severity="destructive"
              confirmLabel="Удалить навсегда"
              onConfirm={onHardDelete}
            />
          )}
        </div>
      </td>
    </tr>
  );
}

