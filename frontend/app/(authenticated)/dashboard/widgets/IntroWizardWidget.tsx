'use client';

import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';
import useSWR from 'swr';

import { departmentsApi } from '@/api/structure.api';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/ui/shadcn/button';

/**
 * Виджет «Знакомство с компанией» на дашборде owner/admin.
 *
 * Показывается только если в Org ещё нет отделов (`Department.count === 0`)
 * — мощный CTA пройти wizard. Как только структура появляется — виджет
 * исчезает (`null`), и владелец видит «Структуру компании» вместо него.
 *
 * Если API не готов — виджет тихо скрывается (не блокирует дашборд).
 */
export function IntroWizardWidget() {
  const { currentOrgId, currentOrgRole } = useAuth();
  const swr = useSWR(
    currentOrgId ? ['intro-departments', currentOrgId] : null,
    () => departmentsApi.list(currentOrgId!),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  // Виджет — только для owner (только он может пройти wizard).
  if (currentOrgRole !== 'owner') return null;
  if (!swr.data) return null;
  if (swr.data.items.length > 0) return null;

  return (
    <div className="rounded-xl border border-accent/30 bg-accent/5 p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-accent">
            <Sparkles size={14} />
            Первый шаг
          </div>
          <h2 className="text-lg font-semibold text-fg-primary">
            Знакомство с компанией — 15 минут
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-fg-secondary">
            Введите отделы, должности и сотрудников. После этого AI начнёт
            собирать карты должностей и подсказывать «кто за что отвечает».
          </p>
        </div>
        <Button asChild size="lg">
          <Link href="/onboarding/company/step-1">
            Пройти знакомство <ArrowRight size={16} className="ml-1" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
