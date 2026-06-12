'use client';

/**
 * `/admin/orgs/plans` — карточка единого тарифа Z (Z-Admin, ТЗ 2026-05-31
 * collapse-to-standard, Фаза 5).
 *
 * После сворачивания CRUD-тарифов:
 *   - Тариф один — `tier_standard`.
 *   - Доп. сотрудники — единственная опция (по решению владельца).
 *   - Цена и параметры пакета редактируются super_admin через 6 ключей
 *     `billing.*` в `AdminSetting` (severity='high', нужен `reason`).
 *
 * Структура карточки:
 *   1. Заголовок «Стандартный тариф Z» + подзаголовок.
 *   2. «Параметры пакета (редактируется super_admin)» — 6 `AdminSettingField`
 *      через `useAdminSettingEditor` с `requiresReason: 'high'`.
 *   3. «Калькулятор» — слайдер 0..1000 доп. сотрудников + live-пересчёт.
 *   4. «Что включено в Z (фичи)» — read-only список `features` из снимка.
 *   5. «Org» — два бейджа: на текущем тарифе + на legacy.
 *   6. Кнопка «История правок прайса» — `AdminSettingHistoryDrawer` для
 *      выбранного ключа.
 */

import { useMemo, useState } from 'react';
import {
  Check,
  History as HistoryIcon,
  Info,
  Loader2,
  Sigma,
  Sliders,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { z, type ZodTypeAny } from 'zod';

import { ApiError } from '@/api/api-error';
import { adminPlansApi } from '@/api/admin-plans.api';
import {
  calculatePlanPrice,
  formatRub,
  planSnapshotFromApi,
  type PlanSnapshotDomain,
  type PlanSnapshotEditableSettingApi,
} from '@/domain/admin-plan';
import { useAdminSettingEditor } from '@/hooks/useAdminSettingEditor';
import { AdminSection } from '@/ui/components/admin/AdminSection';
import { AdminSettingField } from '@/ui/components/admin/AdminSettingField';
import { AdminSettingHistoryDrawer } from '@/ui/components/admin/AdminSettingHistoryDrawer';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Slider } from '@/ui/shadcn/slider';
import { Textarea } from '@/ui/shadcn/textarea';

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../../AdminStateViews';
import { useAdminQuery } from '../../useAdminQuery';
import { adminRootCrumb } from '@/ui/components/admin/brand';

const MIN_REASON_LENGTH = 10;
const MAX_EXTRA_SEATS = 1000;

// ─────────────────────────────────────── Спецификации полей ──

/**
 * 6 ключей `billing.*`. Zod-схемы и метки повторяют backend-регистратор
 * (admin-setting-schema-registry.ts) — это интерфейс «как UI должен показать
 * это поле». На бэке схема та же, валидация дублируется.
 */
type FieldSpec = {
  /** Ключ AdminSetting (`billing.baseMonthlyKopecks` и т. п.). */
  key: string;
  /** Подпись поля в UI. */
  label: string;
  /** Подсказка под полем. */
  description: string;
  /** Zod-схема — используется и `AdminSettingField`, и save-валидацией. */
  schema: ZodTypeAny;
  /** Дефолт (на случай, если БД пустая) — должен совпадать с code-fallback. */
  defaultValue: number;
};

const FIELD_SPECS: FieldSpec[] = [
  {
    key: 'billing.baseMonthlyKopecks',
    label: 'Базовая цена за месяц, ₽',
    description:
      'Сколько Org платит за базовый пакет в месяц. Сохраняется в копейках, ввод и показ — в рублях. По умолчанию 60 000 ₽.',
    schema: z.number().int().nonnegative(),
    defaultValue: 6_000_000,
  },
  {
    key: 'billing.perExtraSeatKopecks',
    label: 'Цена доп. сотрудника, ₽',
    description:
      'Сколько Org платит за каждое дополнительное место сверх пакета. По умолчанию 1 000 ₽ в месяц за человека.',
    schema: z.number().int().nonnegative(),
    defaultValue: 100_000,
  },
  {
    key: 'billing.yearlyDiscountRate',
    label: 'Множитель годовой подписки',
    description:
      'Коэффициент цены при оплате за год. 0.8 = скидка 20%. Значение 0.0–1.0.',
    schema: z.number().min(0).max(1),
    defaultValue: 0.8,
  },
  {
    key: 'billing.baseSeatsIncluded',
    label: 'Мест включено в базе',
    description:
      'Сколько участников Org может позвать без доплаты. По умолчанию 31 (1 владелец + 30 человек).',
    schema: z.number().int().positive(),
    defaultValue: 31,
  },
  {
    key: 'billing.baseMeetingsGrant',
    label: 'Встреч в базе, шт/мес',
    description:
      'Сколько встреч включено в базовый пакет в месяц. По умолчанию 150.',
    schema: z.number().int().nonnegative(),
    defaultValue: 150,
  },
  {
    key: 'billing.perExtraSeatMeetingsGrant',
    label: 'Встреч за доп. сотрудника, шт/мес',
    description:
      'Сколько встреч в месяц добавляется к лимиту за каждое доп. место. По умолчанию 5.',
    schema: z.number().int().nonnegative(),
    defaultValue: 5,
  },
];

// ─────────────────────────────────────── PlansClient ──

export function PlansClient() {
  const [historyKey, setHistoryKey] = useState<string | null>(null);

  const q = useAdminQuery('admin-plans-snapshot', async () => {
    const res = await adminPlansApi.getCurrent();
    return planSnapshotFromApi(res);
  });

  return (
    <AdminSection
      breadcrumbs={[
        adminRootCrumb(),
        { label: 'Тенанты' },
        { label: 'Тариф' },
      ]}
      title="Стандартный тариф Z"
      description="Один тариф для всех Org. Цена и параметры пакета редактируются ниже. Все правки требуют причину (severity=high) и попадают в историю."
    >
      {q.isLoading && <AdminLoading rows={4} />}
      {!q.isLoading && q.isForbidden && <AdminForbidden />}
      {!q.isLoading && q.error && (
        <AdminError message={q.error} onRetry={q.refetch} />
      )}
      {!q.isLoading && q.data && (
        <PlanCard
          snapshot={q.data}
          onSaved={() => q.refetch()}
          onOpenHistory={(key) => setHistoryKey(key)}
        />
      )}

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

// ─────────────────────────────────────── PlanCard ──

function PlanCard({
  snapshot,
  onSaved,
  onOpenHistory,
}: {
  snapshot: PlanSnapshotDomain;
  onSaved: () => void;
  onOpenHistory: (key: string) => void;
}) {
  return (
    <div className="space-y-6">
      <ParametersSection
        snapshot={snapshot}
        onSaved={onSaved}
        onOpenHistory={onOpenHistory}
      />
      <CalculatorSection snapshot={snapshot} />
      <FeaturesSection snapshot={snapshot} />
      <OrgsSection snapshot={snapshot} />
      <PriceChangeNote />
    </div>
  );
}

// ─────────────────────────────────────── Секция: Параметры ──

function ParametersSection({
  snapshot,
  onSaved,
  onOpenHistory,
}: {
  snapshot: PlanSnapshotDomain;
  onSaved: () => void;
  onOpenHistory: (key: string) => void;
}) {
  const editableByKey = useMemo(() => {
    const map = new Map<string, PlanSnapshotEditableSettingApi>();
    for (const item of snapshot.editableSettings) {
      map.set(item.key, item);
    }
    return map;
  }, [snapshot.editableSettings]);

  return (
    <section className="rounded-lg border border-border-subtle bg-bg-card p-5">
      <header className="mb-4 flex items-start gap-2">
        <Sliders size={18} className="mt-0.5 shrink-0 text-fg-tertiary" aria-hidden />
        <div>
          <h2 className="text-base font-semibold text-fg-primary">
            Параметры пакета
          </h2>
          <p className="text-xs text-fg-tertiary">
            Редактируется только super_admin. При сохранении каждого поля
            нужно описать причину (минимум {MIN_REASON_LENGTH} символов).
            История правок — по ссылке рядом с полем.
          </p>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {FIELD_SPECS.map((spec) => (
          <SettingRow
            key={spec.key}
            spec={spec}
            severity={editableByKey.get(spec.key)?.severity ?? 'high'}
            onSaved={onSaved}
            onOpenHistory={() => onOpenHistory(spec.key)}
          />
        ))}
      </div>
    </section>
  );
}

function SettingRow({
  spec,
  severity,
  onSaved,
  onOpenHistory,
}: {
  spec: FieldSpec;
  severity: PlanSnapshotEditableSettingApi['severity'];
  onSaved: () => void;
  onOpenHistory: () => void;
}) {
  const editor = useAdminSettingEditor<number>(spec.key, {
    schema: spec.schema,
    defaultValue: spec.defaultValue,
    requiresReason: severity === 'high' || severity === 'destructive' ? severity : undefined,
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
      toast.success(`Параметр «${spec.label}» сохранён`);
      setReason('');
      onSaved();
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
    <div className="rounded-md border border-border-subtle bg-bg-base p-3">
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
            <p className="text-[11px] text-danger" role="alert">
              {reasonError}
            </p>
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

// ─────────────────────────────────────── Секция: Калькулятор ──

function CalculatorSection({ snapshot }: { snapshot: PlanSnapshotDomain }) {
  const [seatsExtra, setSeatsExtra] = useState(0);

  const result = useMemo(
    () => calculatePlanPrice(snapshot, seatsExtra),
    [snapshot, seatsExtra],
  );

  return (
    <section className="rounded-lg border border-border-subtle bg-bg-card p-5">
      <header className="mb-4 flex items-start gap-2">
        <Sigma size={18} className="mt-0.5 shrink-0 text-fg-tertiary" aria-hidden />
        <div>
          <h2 className="text-base font-semibold text-fg-primary">Калькулятор</h2>
          <p className="text-xs text-fg-tertiary">
            Подбирает итоговую цену по текущим значениям сверху.
            Перетащите слайдер — пересчитается мгновенно.
          </p>
        </div>
      </header>

      <div className="space-y-4">
        <div>
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <label className="text-sm font-medium text-fg-primary" htmlFor="seats-slider">
              Доп. сотрудников
            </label>
            <span className="font-mono text-sm tabular-nums text-fg-primary">
              {seatsExtra}
            </span>
          </div>
          <Slider
            id="seats-slider"
            value={[seatsExtra]}
            min={0}
            max={MAX_EXTRA_SEATS}
            step={1}
            onValueChange={(values) => {
              const next = values[0];
              if (typeof next === 'number') setSeatsExtra(next);
            }}
          />
          <div className="mt-1 flex justify-between text-[10px] text-fg-tertiary">
            <span>0</span>
            <span>{MAX_EXTRA_SEATS}</span>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-border-subtle bg-bg-base p-3">
            <div className="text-[10px] uppercase tracking-wider text-fg-tertiary">
              Месяц
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-fg-primary">
              {formatRub(result.monthly)}
            </div>
            <div className="mt-1 text-[11px] text-fg-tertiary">
              {snapshot.base.seatsIncluded + Math.max(0, seatsExtra)} мест ·{' '}
              {snapshot.base.meetingsIncludedPerMonth +
                Math.max(0, seatsExtra) * snapshot.extraSeat.meetingsPerSeat}{' '}
              встреч/мес
            </div>
          </div>
          <div className="rounded-md border border-accent/30 bg-accent/5 p-3">
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-[10px] uppercase tracking-wider text-accent">
                Год (−{snapshot.yearly.discountPercent}%)
              </div>
              <Badge variant="default" className="text-[10px]">
                выгодно
              </Badge>
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-fg-primary">
              {formatRub(result.yearlyMonthEquivalent)}
              <span className="ml-1 text-xs font-normal text-fg-tertiary">
                /мес
              </span>
            </div>
            <div className="mt-1 text-[11px] text-fg-tertiary">
              {formatRub(result.yearlyFull)} за год · экономия{' '}
              {formatRub(result.yearlySavings)}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────── Секция: Что включено ──

function FeaturesSection({ snapshot }: { snapshot: PlanSnapshotDomain }) {
  const entries = Object.entries(snapshot.features);

  return (
    <section className="rounded-lg border border-border-subtle bg-bg-card p-5">
      <header className="mb-4 flex items-start gap-2">
        <Check size={18} className="mt-0.5 shrink-0 text-fg-tertiary" aria-hidden />
        <div>
          <h2 className="text-base font-semibold text-fg-primary">
            Что включено в Z
          </h2>
          <p className="text-xs text-fg-tertiary">
            Набор фич зашит в коде (TIER_CONFIG) — изменение требует релиза.
            Здесь отображается только текущее состояние.
          </p>
        </div>
      </header>

      {entries.length === 0 ? (
        <p className="text-sm text-fg-tertiary">Фичи не заданы.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {entries.map(([key, enabled]) => (
            <li
              key={key}
              className="flex items-center gap-2 text-sm text-fg-secondary"
            >
              <Check
                size={14}
                className={
                  enabled ? 'shrink-0 text-success' : 'shrink-0 text-fg-tertiary opacity-30'
                }
                aria-hidden
              />
              <span className="font-mono text-xs">{key}</span>
              {!enabled ? (
                <span className="text-[10px] text-fg-tertiary">(выключена)</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {Object.keys(snapshot.quotas).length > 0 ? (
        <div className="mt-4 border-t border-border-subtle pt-3">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-fg-tertiary">
            Лимиты
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(snapshot.quotas).map(([key, value]) => (
              <Badge
                key={key}
                variant="secondary"
                className="font-mono text-[10px]"
              >
                {key}: {String(value)}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

// ─────────────────────────────────────── Секция: Org ──

function OrgsSection({ snapshot }: { snapshot: PlanSnapshotDomain }) {
  const legacyOk = snapshot.legacyOrgsRemainingCount === 0;

  return (
    <section className="rounded-lg border border-border-subtle bg-bg-card p-5">
      <header className="mb-4 flex items-start gap-2">
        <Users size={18} className="mt-0.5 shrink-0 text-fg-tertiary" aria-hidden />
        <div>
          <h2 className="text-base font-semibold text-fg-primary">Org</h2>
          <p className="text-xs text-fg-tertiary">
            Сколько компаний сейчас на стандартном тарифе и сколько ещё
            не перевели с legacy-тиров (`tier_basic` / `tier_pro` /
            `tier_enterprise`).
          </p>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-border-subtle bg-bg-base p-3">
          <div className="text-[10px] uppercase tracking-wider text-fg-tertiary">
            На стандартном тарифе
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums text-fg-primary">
              {snapshot.orgsUsingCount}
            </span>
            <Badge variant="default" className="text-[10px]">
              tier_standard
            </Badge>
          </div>
        </div>
        <div
          className={
            legacyOk
              ? 'rounded-md border border-success/30 bg-success/5 p-3'
              : 'rounded-md border border-warning/30 bg-warning/5 p-3'
          }
        >
          <div className="text-[10px] uppercase tracking-wider text-fg-tertiary">
            На legacy-тарифах
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums text-fg-primary">
              {snapshot.legacyOrgsRemainingCount}
            </span>
            {legacyOk ? (
              <Badge variant="success" className="text-[10px]">
                ок
              </Badge>
            ) : (
              <Badge variant="warning" className="text-[10px]">
                нужен перевод
              </Badge>
            )}
          </div>
          {!legacyOk ? (
            <p className="mt-2 text-[11px] text-fg-tertiary">
              Запустите `scripts/migrate-entitlements-to-standard.ts` —
              переводит legacy-Org в `tier_standard`. Идемпотентно.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────── Сноска ──

function PriceChangeNote() {
  return (
    <div className="flex items-start gap-2 rounded-md border border-border-subtle bg-bg-overlay/50 p-3 text-xs text-fg-secondary">
      <Info size={14} className="mt-0.5 shrink-0 text-fg-tertiary" aria-hidden />
      <div>
        <strong className="text-fg-primary">Как работает правка прайса:</strong>{' '}
        новая цена применяется только к новым счетам и продлениям. Активные
        подписки сохраняют цену на момент покупки. Чтобы пересчитать цену
        конкретной Org — пересоздайте подписку через `/admin/orgs/[id]/billing`.
      </div>
    </div>
  );
}
