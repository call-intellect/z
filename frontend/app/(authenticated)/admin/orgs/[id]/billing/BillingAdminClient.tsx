'use client';

import { useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/api/api-error';
import { entitlementsApi } from '@/api/entitlements.api';
import {
  ALL_FEATURES,
  ALL_QUOTAS,
  ALL_TIERS,
  entitlementFromApi,
  featureLabel,
  formatQuotaValue,
  quotaLabel,
  tierLabel,
  type EntitlementDomain,
  type FeatureKey,
  type QuotaKey,
  type TierKey,
} from '@/domain/entitlement';
import { useAuth } from '@/contexts/auth-context';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';
import { Textarea } from '@/ui/shadcn/textarea';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../../../AdminStateViews';

/**
 * `/admin/orgs/[id]/billing` — Z-Admin страница управления тарифом одной Org
 * (Фаза 12 шаг 12).
 *
 * Доступ: super_admin only. Backend защищает API (403 forbidden); фронт
 * показывает «Нет прав» empty-state.
 *
 * Что можно менять:
 *   - tier (Select из 3 опций).
 *   - featureOverrides (checkbox per feature; отдельный «inherit» режим).
 *   - quotaOverrides (numeric input per quota).
 *   - notes (textarea, макс 2000).
 *   - reason (обязательное, ≥3 символов — backend требует).
 *
 * Все эти поля отправляются в одном PATCH-запросе. Backend разруливает
 * каждое изменение отдельным AuditLog-эвентом.
 *
 * TODO: lazy-load AuditLog entries TIER_CHANGED / ENTITLEMENT_OVERRIDE_SET
 * для этой Org — ждёт общий auditLogApi (см. plans/decisions-log.md).
 */

type FeatureOverrideForm = Partial<Record<FeatureKey, boolean | 'inherit'>>;
type QuotaOverrideForm = Partial<Record<QuotaKey, string>>;

export function BillingAdminClient({ tenantId }: { tenantId: string }) {
  const { isSuperAdmin, isLoading: authLoading } = useAuth();
  const [entitlement, setEntitlement] = useState<EntitlementDomain | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tier, setTier] = useState<TierKey | null>(null);
  const [featureOverrides, setFeatureOverrides] = useState<FeatureOverrideForm>(
    {},
  );
  const [quotaOverrides, setQuotaOverrides] = useState<QuotaOverrideForm>({});
  const [notes, setNotes] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const reload = useMemo(
    () => async () => {
      setLoading(true);
      setForbidden(false);
      setError(null);
      try {
        const res = await entitlementsApi.getAdminOrg(tenantId);
        const ent = entitlementFromApi(res);
        setEntitlement(ent);
        setTier(ent.tier);
        setFeatureOverrides(featureOverridesToForm(ent));
        setQuotaOverrides(quotaOverridesToForm(ent));
        setNotes(ent.notes ?? '');
      } catch (e) {
        if (e instanceof ApiError && e.code === 'forbidden') {
          setForbidden(true);
        } else {
          setError(e instanceof ApiError ? e.message : 'Ошибка загрузки');
        }
      } finally {
        setLoading(false);
      }
    },
    [tenantId],
  );

  useEffect(() => {
    if (authLoading) return;
    if (!isSuperAdmin) {
      setLoading(false);
      setForbidden(true);
      return;
    }
    void reload();
  }, [authLoading, isSuperAdmin, reload]);

  const save = async () => {
    if (!entitlement || !tier) return;
    if (reason.trim().length < 3) {
      toast.error('Укажите причину изменений (минимум 3 символа).');
      return;
    }
    setSaving(true);
    try {
      const patch = buildPatchBody(
        tier,
        featureOverrides,
        quotaOverrides,
        notes,
        entitlement,
        reason.trim(),
      );
      const res = await entitlementsApi.patchAdminOrg(tenantId, patch);
      const ent = entitlementFromApi(res);
      setEntitlement(ent);
      setTier(ent.tier);
      setFeatureOverrides(featureOverridesToForm(ent));
      setQuotaOverrides(quotaOverridesToForm(ent));
      setNotes(ent.notes ?? '');
      setReason('');
      toast.success('Тариф обновлён');
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Не удалось сохранить';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  if (loading || authLoading) {
    return <AdminLoading rows={6} />;
  }
  if (forbidden) {
    return (
      <AdminForbidden
        title="Нет прав"
        description="Управление тарифами Org доступно только super_admin."
      />
    );
  }
  if (error) {
    return <AdminError message={error} onRetry={reload} />;
  }
  if (!entitlement || !tier) {
    return (
      <AdminEmpty
        title="Нет данных"
        description="Не удалось получить entitlement Org."
      />
    );
  }

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-lg border border-border-subtle bg-bg-card p-5">
        <h2 className="text-base font-medium">Тариф</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Select value={tier} onValueChange={(v) => setTier(v as TierKey)}>
            <SelectTrigger className="w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALL_TIERS.map((t) => (
                <SelectItem key={t} value={t}>
                  {tierLabel(t)} ({t})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {entitlement.failedSafe && (
            <Badge variant="warning" className="text-[10px]">
              fail-safe (raw: {entitlement.rawTier})
            </Badge>
          )}
          <span className="text-xs text-fg-tertiary">
            Текущее значение в БД: {entitlement.tier}
          </span>
        </div>
      </section>

      <FeatureOverridesSection
        entitlement={entitlement}
        currentTier={tier}
        overrides={featureOverrides}
        setOverrides={setFeatureOverrides}
      />

      <QuotaOverridesSection
        entitlement={entitlement}
        currentTier={tier}
        overrides={quotaOverrides}
        setOverrides={setQuotaOverrides}
      />

      <section className="space-y-2 rounded-lg border border-border-subtle bg-bg-card p-5">
        <Label htmlFor="notes" className="text-base font-medium">
          Заметка
        </Label>
        <p className="text-xs text-fg-tertiary">
          Видна owner Org на /settings/billing. Используется для пояснений
          override&apos;ов («бесплатно до Q1», «промо для пилота» и т.п.). До
          2000 символов.
        </p>
        <Textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Например: enterprise-фичи на пилот до 31.12"
        />
      </section>

      <section className="space-y-2 rounded-lg border border-warning/30 bg-warning/5 p-5">
        <Label htmlFor="reason" className="text-base font-medium">
          Причина изменения <span className="text-danger">*</span>
        </Label>
        <p className="text-xs text-fg-tertiary">
          Обязательное поле. Записывается в AuditLog для compliance.
          Минимум 3 символа.
        </p>
        <Textarea
          id="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="Например: апгрейд по запросу клиента (тикет #1234)"
        />
        <div className="text-[10px] text-fg-tertiary">{reason.length}/500</div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => void save()}
          disabled={saving || reason.trim().length < 3}
        >
          <Save size={14} />
          {saving ? 'Сохраняем…' : 'Применить'}
        </Button>
        <Button
          variant="outline"
          onClick={() => void reload()}
          disabled={saving}
        >
          Отменить и перезагрузить
        </Button>
      </div>
    </div>
  );
}

// ─── Sections ───────────────────────────────────────────────────────────────

function FeatureOverridesSection({
  entitlement,
  currentTier,
  overrides,
  setOverrides,
}: {
  entitlement: EntitlementDomain;
  currentTier: TierKey;
  overrides: FeatureOverrideForm;
  setOverrides: React.Dispatch<React.SetStateAction<FeatureOverrideForm>>;
}) {
  return (
    <section className="space-y-3 rounded-lg border border-border-subtle bg-bg-card p-5">
      <div>
        <h2 className="text-base font-medium">Переопределения фич</h2>
        <p className="text-xs text-fg-tertiary">
          По умолчанию используются значения тарифа {tierLabel(currentTier)}.
          Можно явно включить или выключить отдельную фичу для этой Org —
          такое значение перебьёт тарифное.
        </p>
      </div>
      <div className="overflow-hidden rounded-md border border-border-subtle">
        <table className="w-full text-sm">
          <thead className="bg-bg-elevated text-xs uppercase tracking-wider text-fg-tertiary">
            <tr>
              <th className="px-3 py-2 text-left font-normal">Фича</th>
              <th className="px-3 py-2 text-center font-normal">
                По тарифу
              </th>
              <th className="px-3 py-2 text-left font-normal">
                Override для Org
              </th>
            </tr>
          </thead>
          <tbody>
            {ALL_FEATURES.map((f) => {
              // resolved (`features[f]`) уже содержит merge tier + override.
              // Чтобы показать «по тарифу» отдельно — снимаем эффект override.
              const overrideValue = overrides[f];
              const tierValue =
                entitlement.featureOverrides[f] === undefined
                  ? entitlement.features[f] === true
                  : // если в БД был override — значит resolved=override, тарифное прячется.
                    // Достаём «по тарифу» из публичного API: features без overrides.
                    // Backend нам этого не отдаёт, поэтому показываем resolved
                    // как «по тарифу» когда override снят (inherit).
                    entitlement.features[f] === true;
              return (
                <tr
                  key={f}
                  className="border-t border-border-subtle hover:bg-bg-overlay/40"
                >
                  <td className="px-3 py-2.5">{featureLabel(f)}</td>
                  <td className="px-3 py-2.5 text-center text-xs text-fg-tertiary">
                    {tierValue ? 'включено' : 'выключено'}
                  </td>
                  <td className="px-3 py-2.5">
                    <FeatureOverrideControl
                      feature={f}
                      value={overrideValue ?? 'inherit'}
                      onChange={(v) =>
                        setOverrides((prev) => {
                          const next: FeatureOverrideForm = { ...prev };
                          if (v === 'inherit') {
                            delete next[f];
                          } else {
                            next[f] = v;
                          }
                          return next;
                        })
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-fg-tertiary">
        Подсказка: «inherit» → значение возьмётся из тарифа. Любое явное «включено» / «выключено» сохранится в БД как override.
      </p>
    </section>
  );
}

function FeatureOverrideControl({
  feature,
  value,
  onChange,
}: {
  feature: FeatureKey;
  value: 'inherit' | true | false;
  onChange: (next: 'inherit' | true | false) => void;
}) {
  const stringValue = value === 'inherit' ? 'inherit' : value ? 'on' : 'off';
  return (
    <Select
      value={stringValue}
      onValueChange={(v) => {
        if (v === 'inherit') onChange('inherit');
        else if (v === 'on') onChange(true);
        else onChange(false);
      }}
    >
      <SelectTrigger
        className="h-8 w-[180px]"
        aria-label={`Override для ${featureLabel(feature)}`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="inherit">из тарифа (inherit)</SelectItem>
        <SelectItem value="on">включить (override)</SelectItem>
        <SelectItem value="off">выключить (override)</SelectItem>
      </SelectContent>
    </Select>
  );
}

function QuotaOverridesSection({
  entitlement,
  currentTier,
  overrides,
  setOverrides,
}: {
  entitlement: EntitlementDomain;
  currentTier: TierKey;
  overrides: QuotaOverrideForm;
  setOverrides: React.Dispatch<React.SetStateAction<QuotaOverrideForm>>;
}) {
  return (
    <section className="space-y-3 rounded-lg border border-border-subtle bg-bg-card p-5">
      <div>
        <h2 className="text-base font-medium">Переопределения квот</h2>
        <p className="text-xs text-fg-tertiary">
          Пустое поле — значение берётся из тарифа {tierLabel(currentTier)}.
          Любое заданное число (≥0) перебивает тарифное значение для этой Org.
        </p>
      </div>
      <div className="overflow-hidden rounded-md border border-border-subtle">
        <table className="w-full text-sm">
          <thead className="bg-bg-elevated text-xs uppercase tracking-wider text-fg-tertiary">
            <tr>
              <th className="px-3 py-2 text-left font-normal">Квота</th>
              <th className="px-3 py-2 text-right font-normal">По тарифу</th>
              <th className="px-3 py-2 text-left font-normal">
                Override для Org
              </th>
            </tr>
          </thead>
          <tbody>
            {ALL_QUOTAS.map((q) => {
              const resolvedValue = entitlement.quotas[q] ?? 0;
              return (
                <tr
                  key={q}
                  className="border-t border-border-subtle hover:bg-bg-overlay/40"
                >
                  <td className="px-3 py-2.5">{quotaLabel(q)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-xs text-fg-tertiary">
                    {formatQuotaValue(q, resolvedValue)}
                  </td>
                  <td className="px-3 py-2.5">
                    <Input
                      type="number"
                      min={0}
                      step={1}
                      className="h-8 w-[200px]"
                      placeholder="из тарифа"
                      value={overrides[q] ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        setOverrides((prev) => {
                          const next: QuotaOverrideForm = { ...prev };
                          if (v === '') {
                            delete next[q];
                          } else {
                            next[q] = v;
                          }
                          return next;
                        });
                      }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ─── Form helpers ───────────────────────────────────────────────────────────

function featureOverridesToForm(ent: EntitlementDomain): FeatureOverrideForm {
  const result: FeatureOverrideForm = {};
  for (const k of Object.keys(ent.featureOverrides) as FeatureKey[]) {
    const v = ent.featureOverrides[k];
    if (v === undefined || v === null) continue;
    result[k] = v;
  }
  return result;
}

function quotaOverridesToForm(ent: EntitlementDomain): QuotaOverrideForm {
  const result: QuotaOverrideForm = {};
  for (const k of Object.keys(ent.quotaOverrides) as QuotaKey[]) {
    const v = ent.quotaOverrides[k];
    if (v === undefined || v === null) continue;
    result[k] = String(v);
  }
  return result;
}

/**
 * Собирает PATCH-body. Шлём только diff'ы относительно текущего состояния:
 *   - tier — если поменялся.
 *   - featureOverrides — все ключи, где явно задан bool (без inherit).
 *   - quotaOverrides — все ключи, где задано валидное число.
 *   - notes — если изменилось.
 *
 * Backend сам решает, что записать в OrgEntitlement — мы только декларируем
 * желаемое состояние.
 */
function buildPatchBody(
  tier: TierKey,
  featureOverrides: FeatureOverrideForm,
  quotaOverrides: QuotaOverrideForm,
  notes: string,
  current: EntitlementDomain,
  reason: string,
): {
  tier?: TierKey;
  featureOverrides?: Partial<Record<FeatureKey, boolean>>;
  quotaOverrides?: Partial<Record<QuotaKey, number>>;
  notes?: string | null;
  reason: string;
} {
  const body: ReturnType<typeof buildPatchBody> = { reason };

  if (tier !== current.tier) {
    body.tier = tier;
  }

  const fo: Partial<Record<FeatureKey, boolean>> = {};
  for (const [k, v] of Object.entries(featureOverrides) as Array<
    [FeatureKey, FeatureOverrideForm[FeatureKey]]
  >) {
    if (v === undefined) continue;
    if (v === 'inherit') continue;
    fo[k] = v;
  }
  if (Object.keys(fo).length > 0) {
    body.featureOverrides = fo;
  }

  const qo: Partial<Record<QuotaKey, number>> = {};
  for (const [k, raw] of Object.entries(quotaOverrides) as Array<
    [QuotaKey, string | undefined]
  >) {
    if (raw === undefined || raw === '') continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) continue;
    qo[k] = Math.floor(n);
  }
  if (Object.keys(qo).length > 0) {
    body.quotaOverrides = qo;
  }

  const currentNotes = current.notes ?? '';
  const newNotes = notes ?? '';
  if (currentNotes !== newNotes) {
    body.notes = newNotes === '' ? null : newNotes;
  }

  return body;
}
