'use client';

/**
 * PaywallModal — модальное окно оплаты подписки.
 *
 * Открывается автоматически при получении 403 `subscription_required` от
 * бэкенда (через subscription:required event → SubscriptionContext).
 * Также может быть открыт программно через `useSubscription().showPaywallModal()`.
 *
 * Контент: заголовок, список включённых возможностей, цена (месяц/год),
 * две CTA-кнопки → /settings/subscription.
 *
 * ТЗ: plans/tz/2026-05-28-paywall-no-trial.md §4.2.
 */

import Link from 'next/link';
import { Lock, Check, CreditCard } from 'lucide-react';

import { useSubscription } from '@/hooks/useSubscription';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/ui/shadcn/dialog';
import { Button } from '@/ui/shadcn/button';

const FEATURES = [
  '150 видеовстреч в месяц',
  '31 место для пользователей',
  'Безлимитные проекты и задачи',
  'AI-отчёты и граф знаний',
  'Клоны сотрудников',
  'Все интеграции',
];

export function PaywallModal() {
  const { isPaywallModalOpen, hidePaywallModal } = useSubscription();

  return (
    <Dialog open={isPaywallModalOpen} onOpenChange={(open) => !open && hidePaywallModal()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-warning/10">
              <Lock size={20} className="text-warning" />
            </div>
            <div>
              <DialogTitle>Оплатите подписку</DialogTitle>
              <DialogDescription>
                Чтобы начать работу и создавать данные, оплатите подписку.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-border-subtle bg-bg-elevated p-4">
            <h3 className="mb-2 text-sm font-semibold text-fg-primary">
              Что включено:
            </h3>
            <ul className="space-y-1.5" data-testid="paywall-features">
              {FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-fg-secondary">
                  <Check size={16} className="shrink-0 text-success" />
                  {f}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="text-2xl font-bold text-fg-primary">
              60 000 ₽/мес
            </div>
            <div className="text-sm text-fg-tertiary">
              или 576 000 ₽/год (скидка 20%)
            </div>
          </div>

          <div className="space-y-2">
            <Button asChild size="default" className="w-full">
              <Link href="/settings/subscription" data-testid="paywall-card-btn">
                <CreditCard size={16} />
                Оплатить картой
              </Link>
            </Button>
            <Button asChild variant="outline" size="default" className="w-full">
              <Link href="/settings/subscription" data-testid="paywall-invoice-btn">
                Безналичный расчёт
              </Link>
            </Button>
          </div>

          <p className="text-center text-xs text-fg-tertiary">
            Доп. места: +1 000 ₽/мес за каждого пользователя сверх 31
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
