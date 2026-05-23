'use client';

import { useState } from 'react';

import { ApiError } from '@/api/api-error';
import { adminEconomicsApi } from '@/api/admin-economics.api';
import type {
  AdminEconomicsOrgApi,
  UpdateOrgBudgetRequest,
} from '@/domain/admin-economics';
import { useToast } from '@/contexts/toast-context';
import { Button } from '@/ui/shadcn/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/ui/shadcn/card';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../../../AdminStateViews';
import { useAdminQuery } from '../../../useAdminQuery';

/**
 * SBA α-10 wave 3 — /admin/economics/orgs/[id].
 */
export function OrgEconomicsDetailClient({ tenantId }: { tenantId: string }) {
  const { addToast } = useToast();
  const q = useAdminQuery(
    `admin-economics-org:${tenantId}`,
    () => adminEconomicsApi.org(tenantId, { days: 30 }),
    [tenantId],
  );

  const [editing, setEditing] = useState(false);

  const onSaveBudget = async (body: UpdateOrgBudgetRequest) => {
    try {
      await adminEconomicsApi.setBudget(tenantId, body);
      addToast({ type: 'success', message: 'Бюджет сохранён' });
      setEditing(false);
      q.refetch();
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiError ? e.message : 'Не удалось сохранить',
      });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {q.data?.orgName ?? tenantId}
        </h1>
        <p className="text-sm text-fg-tertiary">
          Per-org разбор затрат AI за 30 дней + бюджет.
        </p>
      </div>

      {q.isLoading && <AdminLoading rows={4} />}
      {!q.isLoading && q.isForbidden && <AdminForbidden />}
      {!q.isLoading && q.error && (
        <AdminError message={q.error} onRetry={q.refetch} />
      )}
      {!q.isLoading && q.data && (
        <OrgDetail
          data={q.data}
          editing={editing}
          onEdit={() => setEditing(true)}
          onCancel={() => setEditing(false)}
          onSave={onSaveBudget}
        />
      )}
    </div>
  );
}

function OrgDetail({
  data,
  editing,
  onEdit,
  onCancel,
  onSave,
}: {
  data: AdminEconomicsOrgApi;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (body: UpdateOrgBudgetRequest) => Promise<void>;
}) {
  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Stat title="За 30 дней, ₽" value={data.costRubLast30d.toLocaleString('ru-RU')} />
        <Stat title="Этот месяц, ₽" value={Math.round(data.costRubMonthToDate).toLocaleString('ru-RU')} />
        <Stat title="Вызовов 30d" value={data.callsCountLast30d.toLocaleString('ru-RU')} />
        <Stat title="Средний ₽/user" value={Math.round(data.avgCostPerUserRub).toLocaleString('ru-RU')} />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Бюджет</CardTitle>
            {!editing && (
              <Button size="sm" variant="outline" onClick={onEdit}>
                {data.budget ? 'Изменить' : 'Установить'}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {editing ? (
            <BudgetForm data={data} onSave={onSave} onCancel={onCancel} />
          ) : data.budget ? (
            <BudgetView data={data} />
          ) : (
            <p className="text-sm text-fg-tertiary">
              Лимит не установлен. Алерты не отправляются.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Топ задач по стоимости</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead className="bg-bg-overlay text-xs uppercase tracking-wide text-fg-tertiary">
              <tr>
                <th className="px-3 py-2 text-left">Тип задачи</th>
                <th className="px-3 py-2 text-right">Стоимость, ₽</th>
                <th className="px-3 py-2 text-right">Вызовов</th>
              </tr>
            </thead>
            <tbody>
              {data.topTaskTypes.map((t) => (
                <tr key={t.taskType} className="border-t border-border-subtle">
                  <td className="px-3 py-2 font-mono text-xs">{t.taskType}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {Math.round(t.costRub).toLocaleString('ru-RU')}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {t.calls.toLocaleString('ru-RU')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}

function Stat({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm text-fg-tertiary">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-xl font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function BudgetView({ data }: { data: AdminEconomicsOrgApi }) {
  const b = data.budget!;
  return (
    <div className="space-y-2 text-sm">
      <div>
        Лимит: <strong>{b.monthlyCapRub?.toLocaleString('ru-RU') ?? '—'} ₽/мес</strong>{' '}
        ({b.capKind})
      </div>
      <div>Пороги алертов: {b.alertThresholds.join('%, ')}%</div>
      {b.utilizationPercent != null && (
        <div>
          Использовано: <strong>{b.utilizationPercent.toFixed(1)}%</strong>
        </div>
      )}
      {b.lastAlertAt && (
        <div className="text-xs text-fg-tertiary">
          Последний алерт: {new Date(b.lastAlertAt).toLocaleString('ru-RU')}{' '}
          (порог {b.lastAlertThreshold}%)
        </div>
      )}
    </div>
  );
}

function BudgetForm({
  data,
  onSave,
  onCancel,
}: {
  data: AdminEconomicsOrgApi;
  onSave: (body: UpdateOrgBudgetRequest) => Promise<void>;
  onCancel: () => void;
}) {
  const [monthlyCap, setMonthlyCap] = useState(
    data.budget?.monthlyCapRub != null ? String(data.budget.monthlyCapRub) : '',
  );
  const [capKind, setCapKind] = useState<'soft' | 'hard'>(
    (data.budget?.capKind as 'soft' | 'hard') ?? 'soft',
  );
  const [thresholdsStr, setThresholdsStr] = useState(
    (data.budget?.alertThresholds ?? [80, 100]).join(','),
  );

  const handleSubmit = () => {
    const numCap = monthlyCap.trim() === '' ? null : Number(monthlyCap);
    const thresholds = thresholdsStr
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    void onSave({
      monthlyCapRub: numCap,
      capKind,
      alertThresholds: thresholds.length > 0 ? thresholds : [80, 100],
    });
  };

  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">Месячный лимит, ₽ (пусто = без лимита)</Label>
        <Input
          value={monthlyCap}
          onChange={(e) => setMonthlyCap(e.target.value)}
          type="number"
        />
      </div>
      <div>
        <Label className="text-xs">Тип лимита</Label>
        <select
          value={capKind}
          onChange={(e) => setCapKind(e.target.value as 'soft' | 'hard')}
          className="block w-full rounded border border-border-subtle bg-bg-card px-2 py-1 text-sm"
        >
          <option value="soft">soft (только alert)</option>
          <option value="hard">hard (заблокировать AI)</option>
        </select>
      </div>
      <div>
        <Label className="text-xs">Пороги алертов через запятую (%)</Label>
        <Input
          value={thresholdsStr}
          onChange={(e) => setThresholdsStr(e.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSubmit}>
          Сохранить
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </div>
  );
}
