'use client';

/**
 * `/admin/platform/limits` — глобальные лимиты. Фаза 8 редизайна Z-Admin.
 *
 * Вкладки (AdminTabs):
 *   - Глобальные: список `AdminSetting` с префиксом `limits.*` через
 *     `useAdminSettingEditor` (severity='high', reason обязателен).
 *   - По тарифу: список `Plan` с их `quotas` (read-only ссылка на CRUD).
 *   - Override по Org: AdminEmpty со ссылкой на /admin/orgs/entitlements.
 */

import { useState } from 'react';
import {
  ArrowRight,
  CreditCard,
  History as HistoryIcon,
  Loader2,
  Settings2,
  ToggleLeft,
} from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';

import { adminPlansApi } from '@/api/admin-plans.api';
import { ApiError } from '@/api/api-error';
import { GLOBAL_LIMITS, type LimitSpec } from '@/domain/admin-limit';
import {
  formatPlanPrice,
  planListFromApi,
  type PlanItemDomain,
} from '@/domain/admin-plan';
import { useAdminSettingEditor } from '@/hooks/useAdminSettingEditor';
import { AdminSection } from '@/ui/components/admin/AdminSection';
import { AdminSettingField } from '@/ui/components/admin/AdminSettingField';
import { AdminSettingHistoryDrawer } from '@/ui/components/admin/AdminSettingHistoryDrawer';
import { AdminTabs, type AdminTabDef } from '@/ui/components/admin/AdminTabs';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Textarea } from '@/ui/shadcn/textarea';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../../AdminStateViews';
import { useAdminQuery } from '../../useAdminQuery';

const MIN_REASON_LENGTH = 10;

const TABS: AdminTabDef[] = [
  { value: 'global', label: 'Глобальные', icon: Settings2 },
  { value: 'by-plan', label: 'По тарифу', icon: CreditCard },
  { value: 'by-org', label: 'Override по Org', icon: ToggleLeft },
];

export function LimitsClient() {
  const [historyKey, setHistoryKey] = useState<string | null>(null);

  return (
    <AdminSection
      breadcrumbs={[
        { label: 'Z-Admin', href: '/admin' },
        { label: 'Платформа' },
        { label: 'Лимиты и квоты' },
      ]}
      title="Глобальные лимиты"
      description="Жёсткие верхние границы платформы. Org может получить меньшие значения через тариф или override. Сохранение требует причину (severity='high')."
    >
      <AdminTabs tabs={TABS} defaultTab="global">
        {(active) => {
          if (active === 'global') {
            return (
              <div className="grid gap-3 sm:grid-cols-2">
                {GLOBAL_LIMITS.map((spec) => (
                  <LimitRow
                    key={spec.key}
                    spec={spec}
                    onOpenHistory={() => setHistoryKey(spec.key)}
                  />
                ))}
              </div>
            );
          }
          if (active === 'by-plan') {
            return <ByPlanTab />;
          }
          if (active === 'by-org') {
            return (
              <AdminEmpty
                title="Override по Org"
                description="Управление overrides по конкретной Org находится в разделе «Тенанты → Entitlements»."
              />
            );
          }
          return null;
        }}
      </AdminTabs>

      <AdminSettingHistoryDrawer
        settingKey={historyKey}
        open={Boolean(historyKey)}
        onOpenChange={(open) => {
          if (!open) setHistoryKey(null);
        }}
      />
    </AdminSection>
  );
}

// ─────────────────────────── Global tab ───────────────────────────

function LimitRow({
  spec,
  onOpenHistory,
}: {
  spec: LimitSpec;
  onOpenHistory: () => void;
}) {
  const editor = useAdminSettingEditor<number>(spec.key, {
    schema: spec.schema,
    defaultValue: spec.defaultValue,
    requiresReason: 'high',
  });
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);

  const handleSave = async () => {
    setReasonError(null);
    const trimmed = reason.trim();
    if (trimmed.length < MIN_REASON_LENGTH) {
      setReasonError(
        `Опишите причину минимум в ${MIN_REASON_LENGTH} символов.`,
      );
      return;
    }
    try {
      await editor.save(trimmed);
      toast.success(`Лимит «${spec.label}» сохранён`);
      setReason('');
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Не удалось сохранить';
      toast.error(msg);
    }
  };

  return (
    <div className="rounded-md border border-border-subtle bg-bg-card p-3">
      <AdminSettingField<number>
        schema={spec.schema}
        value={editor.value}
        onChange={editor.setValue}
        label={spec.label}
        description={spec.description}
        disabled={editor.isLoading || editor.isSaving}
        error={editor.error ?? undefined}
        rightSlot={
          <button
            type="button"
            onClick={onOpenHistory}
            className="inline-flex items-center gap-1 text-[10px] text-fg-tertiary hover:text-fg-primary"
            aria-label="История изменений"
          >
            <HistoryIcon size={11} aria-hidden />
            История
          </button>
        }
      />
      {editor.isDirty ? (
        <div className="mt-2 space-y-1">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={`Причина изменения (мин. ${MIN_REASON_LENGTH} символов)`}
            rows={2}
            disabled={editor.isSaving}
          />
          {reasonError ? (
            <p className="text-[11px] text-danger">{reasonError}</p>
          ) : null}
        </div>
      ) : null}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-fg-tertiary">{spec.key}</span>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={editor.reset}
            disabled={!editor.isDirty || editor.isSaving}
          >
            Сбросить
          </Button>
          <Button
            size="sm"
            onClick={() => void handleSave()}
            disabled={!editor.isDirty || editor.isSaving}
          >
            {editor.isSaving ? (
              <Loader2 size={12} className="mr-1 animate-spin" aria-hidden />
            ) : null}
            Сохранить
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── By-plan tab ───────────────────────────

function ByPlanTab() {
  const q = useAdminQuery('admin-platform-limits-plans', async () => {
    const res = await adminPlansApi.list();
    return planListFromApi(res);
  });

  return (
    <div className="space-y-3">
      {q.isLoading && <AdminLoading rows={3} />}
      {!q.isLoading && q.isForbidden && <AdminForbidden />}
      {!q.isLoading && q.error && (
        <AdminError message={q.error} onRetry={q.refetch} />
      )}
      {!q.isLoading && q.data && q.data.items.length === 0 ? (
        <AdminEmpty
          title="Тарифы не созданы"
          description="Создайте тарифы в разделе «Тенанты → Тарифы»."
        />
      ) : null}
      {!q.isLoading && q.data && q.data.items.length > 0 ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-fg-tertiary">
              Лимиты по каждому тарифу применяются к Org с этим `tier`. Редактирование — в разделе «Тенанты → Тарифы».
            </p>
            <Link
              href="/admin/orgs/plans"
              className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent-hover"
            >
              Открыть тарифы <ArrowRight size={12} aria-hidden />
            </Link>
          </div>
          <div className="space-y-2">
            {q.data.items.map((plan) => (
              <PlanQuotasRow key={plan.id} plan={plan} />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function PlanQuotasRow({ plan }: { plan: PlanItemDomain }) {
  const entries = Object.entries(plan.quotas);
  return (
    <div className="rounded-md border border-border-subtle bg-bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-medium text-fg-primary">
            {plan.displayName}{' '}
            <code className="ml-1 rounded bg-bg-overlay px-1 py-0.5 text-[10px] text-fg-secondary">
              {plan.id}
            </code>
          </h4>
          <p className="text-[11px] text-fg-tertiary">
            {formatPlanPrice(plan.monthlyPriceRub)} · Org с этим тарифом:{' '}
            {plan.orgsCount}
          </p>
        </div>
        {!plan.isActive ? (
          <Badge variant="warning" className="text-[10px]">
            неактивен
          </Badge>
        ) : null}
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-fg-tertiary">Квоты не заданы.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {entries.map(([key, value]) => (
            <Badge
              key={key}
              variant="secondary"
              className="text-[10px] font-mono"
            >
              {key}: {String(value)}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
