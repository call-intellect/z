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

import { ApiError } from '@/api/api-error';
import { GLOBAL_LIMITS, type LimitSpec } from '@/domain/admin-limit';
import { useAdminSettingEditor } from '@/hooks/useAdminSettingEditor';
import { AdminSection } from '@/ui/components/admin/AdminSection';
import { AdminSettingField } from '@/ui/components/admin/AdminSettingField';
import { AdminSettingHistoryDrawer } from '@/ui/components/admin/AdminSettingHistoryDrawer';
import { AdminTabs, type AdminTabDef } from '@/ui/components/admin/AdminTabs';
import { Button } from '@/ui/shadcn/button';
import { Textarea } from '@/ui/shadcn/textarea';

import { AdminEmpty } from '../../AdminStateViews';

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

/**
 * После collapse-to-standard (ТЗ 2026-05-31) тариф в Z один — `tier_standard`,
 * и его лимиты/квоты редактируются вместе с ценой на отдельной карточке
 * `/admin/orgs/plans`. Здесь оставлена только ссылка туда — отдельный pivot
 * «лимиты по каждому тарифу» больше не нужен.
 */
function ByPlanTab() {
  return (
    <div className="space-y-3">
      <AdminEmpty
        title="Тариф один — стандартный"
        description="После collapse-to-standard у Z единственный тариф `tier_standard`. Квоты пакета (мест, встреч) и цена редактируются на карточке тарифа."
      />
      <div className="flex justify-center">
        <Link
          href="/admin/orgs/plans"
          className="inline-flex items-center gap-1 text-sm text-accent hover:text-accent-hover"
        >
          Открыть карточку тарифа <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
    </div>
  );
}
