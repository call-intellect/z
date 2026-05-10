'use client';

import { useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  CreditCard,
  Info,
  Loader2,
  Mail,
  X,
} from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { entitlementsApi } from '@/api/entitlements.api';
import {
  ALL_QUOTAS,
  FEATURE_GROUPS,
  entitlementFromApi,
  featureLabel,
  formatQuotaValue,
  quotaLabel,
  tierLabel,
  type EntitlementDomain,
  type FeatureKey,
} from '@/domain/entitlement';
import { useAuth } from '@/contexts/auth-context';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Skeleton } from '@/ui/shadcn/skeleton';

/**
 * `/settings/billing` — owner-only страница «Тариф и лимиты» (Фаза 12 шаг 11).
 *
 * Что показываем:
 *   - Текущий tier — крупно, badge, дата активации (`updatedAt`).
 *   - «Что входит» — таблица feature → ✓/✗, сгруппированная по разделам:
 *     Знания / Коммуникация / Источники / Базовые.
 *   - «Лимиты» — таблица quota → значение, с форматированием для байтов.
 *   - Заметка от super_admin (`notes`), если задана.
 *   - CTA «Связаться с нами» — на MVP без онлайн-апгрейда (`mailto:`).
 *
 * Доступ:
 *   - Owner Org → видит данные. Не-owner видит «empty state» с пояснением.
 *   - Backend дополнительно защищает endpoint (403 если не-owner).
 */
export function BillingClient() {
  const { currentOrgRole } = useAuth();
  const [entitlement, setEntitlement] = useState<EntitlementDomain | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (currentOrgRole !== 'owner') {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    entitlementsApi
      .getBilling()
      .then((res) => {
        if (cancelled) return;
        setEntitlement(entitlementFromApi(res));
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof ApiError ? e.message : 'Не удалось загрузить тариф');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [currentOrgRole]);

  if (currentOrgRole !== 'owner') {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">Тариф и лимиты</h1>
        <div className="rounded-lg border border-dashed border-border-subtle px-6 py-12 text-center">
          <Info size={28} className="mx-auto mb-3 text-fg-tertiary" />
          <p className="text-sm text-fg-secondary">
            Только владелец организации (owner) может видеть тариф и лимиты.
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-7 w-1/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">Тариф и лимиты</h1>
        <div className="rounded-lg border border-danger/40 bg-danger/5 px-6 py-8 text-center">
          <AlertCircle size={28} className="mx-auto mb-3 text-danger" />
          <p className="text-sm text-fg-secondary">{error}</p>
        </div>
      </div>
    );
  }

  if (!entitlement) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">Тариф и лимиты</h1>
        <div className="rounded-lg border border-dashed border-border-subtle px-6 py-12 text-center">
          <Loader2 size={20} className="mx-auto mb-2 animate-spin text-fg-tertiary" />
          <p className="text-sm text-fg-tertiary">Нет данных по тарифу.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Тариф и лимиты</h1>
        <p className="mt-1 text-sm text-fg-tertiary">
          Что входит в ваш тариф и какие действуют квоты.
        </p>
      </header>

      <CurrentTierSection entitlement={entitlement} />

      {entitlement.failedSafe && (
        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-xs text-warning">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <div>
            В базе указан неизвестный тариф «{entitlement.rawTier}». Временно
            применяется {tierLabel(entitlement.tier)}. Свяжитесь с нами для
            уточнения.
          </div>
        </div>
      )}

      <FeaturesSection entitlement={entitlement} />
      <QuotasSection entitlement={entitlement} />

      {entitlement.notes && (
        <section className="rounded-lg border border-accent-border/40 bg-accent-muted/40 p-5">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Info size={14} /> Заметка от поддержки
          </h2>
          <p className="whitespace-pre-wrap text-sm text-fg-secondary">
            {entitlement.notes}
          </p>
        </section>
      )}

      <ChangeTierSection />
    </div>
  );
}

function CurrentTierSection({ entitlement }: { entitlement: EntitlementDomain }) {
  const tier = entitlement.tier;
  const variant: 'default' | 'secondary' | 'success' =
    tier === 'tier_enterprise'
      ? 'success'
      : tier === 'tier_pro'
      ? 'default'
      : 'secondary';
  return (
    <section className="rounded-lg border border-border-subtle bg-bg-card p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-fg-tertiary">
            Текущий тариф
          </div>
          <div className="mt-1 flex items-center gap-3">
            <div className="text-3xl font-semibold">{tierLabel(tier)}</div>
            <Badge variant={variant}>{tier}</Badge>
          </div>
        </div>
        {entitlement.updatedAt && (
          <div className="text-xs text-fg-tertiary">
            Обновлено{' '}
            {entitlement.updatedAt.toLocaleDateString('ru-RU', {
              day: '2-digit',
              month: 'long',
              year: 'numeric',
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function FeaturesSection({ entitlement }: { entitlement: EntitlementDomain }) {
  return (
    <section className="space-y-3 rounded-lg border border-border-subtle bg-bg-card p-5">
      <h2 className="text-base font-medium">Что входит</h2>
      <div className="space-y-5">
        {FEATURE_GROUPS.map((group) => (
          <FeatureGroupTable
            key={group.title}
            title={group.title}
            features={group.features}
            entitlement={entitlement}
          />
        ))}
      </div>
    </section>
  );
}

function FeatureGroupTable({
  title,
  features,
  entitlement,
}: {
  title: string;
  features: readonly FeatureKey[];
  entitlement: EntitlementDomain;
}) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-tertiary">
        {title}
      </div>
      <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle bg-bg-elevated">
        {features.map((f) => {
          const enabled = entitlement.features[f] === true;
          const overridden =
            entitlement.featureOverrides[f] !== undefined &&
            entitlement.featureOverrides[f] !== null;
          return (
            <li key={f} className="flex items-center gap-3 px-4 py-2.5">
              {enabled ? (
                <Check size={16} className="text-success shrink-0" />
              ) : (
                <X size={16} className="text-fg-tertiary shrink-0" />
              )}
              <span
                className={
                  enabled ? 'text-sm text-fg-primary' : 'text-sm text-fg-tertiary'
                }
              >
                {featureLabel(f)}
              </span>
              {overridden && (
                <Badge variant="outline" className="ml-auto text-[10px]">
                  индивидуально
                </Badge>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function QuotasSection({ entitlement }: { entitlement: EntitlementDomain }) {
  return (
    <section className="space-y-3 rounded-lg border border-border-subtle bg-bg-card p-5">
      <h2 className="text-base font-medium">Лимиты</h2>
      <div className="overflow-hidden rounded-md border border-border-subtle">
        <table className="w-full text-sm">
          <thead className="bg-bg-elevated text-xs uppercase tracking-wider text-fg-tertiary">
            <tr>
              <th className="px-4 py-2 text-left font-normal">Параметр</th>
              <th className="px-4 py-2 text-right font-normal">Лимит</th>
            </tr>
          </thead>
          <tbody>
            {ALL_QUOTAS.map((q) => {
              const value = entitlement.quotas[q] ?? 0;
              const overridden =
                entitlement.quotaOverrides[q] !== undefined &&
                entitlement.quotaOverrides[q] !== null;
              return (
                <tr
                  key={q}
                  className="border-t border-border-subtle hover:bg-bg-overlay/40"
                >
                  <td className="px-4 py-2.5">
                    {quotaLabel(q)}
                    {overridden && (
                      <Badge
                        variant="outline"
                        className="ml-2 align-middle text-[10px]"
                      >
                        индивидуально
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {formatQuotaValue(q, value)}
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

function ChangeTierSection() {
  return (
    <section className="rounded-lg border border-border-subtle bg-bg-card p-5">
      <h2 className="text-base font-medium">Сменить тариф</h2>
      <p className="mt-1 text-sm text-fg-tertiary">
        На MVP апгрейд в один клик ещё не подключён. Напишите нам — поможем
        подобрать тариф под задачи и оформим переход.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild>
          <a href="mailto:support@call-intellect.ai" className="gap-2">
            <Mail size={14} /> Связаться с нами
          </a>
        </Button>
        <Button variant="outline" asChild>
          <a
            href="https://t.me/callintellect_support"
            target="_blank"
            rel="noopener noreferrer"
            className="gap-2"
          >
            <CreditCard size={14} /> Через Telegram
          </a>
        </Button>
      </div>
    </section>
  );
}
