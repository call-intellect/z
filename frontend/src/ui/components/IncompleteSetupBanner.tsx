'use client';

/**
 * IncompleteSetupBanner — плашка «Настройка компании: N из 6» на дашборде.
 * Показывается если Org.setupCompletedAt === null.
 *
 * ТЗ 2026-05-29 onboarding-v2 §5.7.
 * Фикс 2026-06-17: прогресс берём с бэка (GET /orgs/:orgId/setup-progress —
 * «timestamp ИЛИ факт существования сущности»), а не по полям Org.*CompletedAt,
 * иначе отделы/сотрудники, заведённые вне мастера, давали «0 из 6».
 */

import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { X } from 'lucide-react';

import { Button } from '@/ui/shadcn/button';
import { useAuth } from '@/contexts/auth-context';
import { useOrgSetup } from '@/hooks/useOrgSetup';
import { useTourContext } from '@/ui/tour';
import { onboardingApi, type SetupProgressApi } from '@/api/onboarding.api';

const DISMISS_KEY = 'onboarding.banner.dismissed';

// Маппинг 6 вех setup-progress → русские лейблы «Осталось» (порядок сохранить).
const SETUP_STEPS: { key: keyof SetupProgressApi['steps']; label: string }[] = [
  { key: 'welcome', label: 'познакомить Кору с компанией' },
  { key: 'companyInfo', label: 'заполнить данные компании' },
  { key: 'departments', label: 'добавить отделы' },
  { key: 'roles', label: 'завести должности' },
  { key: 'team', label: 'пригласить команду' },
  { key: 'firstActivity', label: 'провести первую встречу или создать спринт' },
];

export function IncompleteSetupBanner() {
  const { currentOrgId, isSuperAdmin } = useAuth();
  const { org, setupCompletedAt } = useOrgSetup(currentOrgId);
  const { forceStart } = useTourContext();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setDismissed(localStorage.getItem(DISMISS_KEY) === '1');
    }
  }, []);

  const progressSwr = useSWR(
    currentOrgId ? ['onboarding-setup-progress', currentOrgId] : null,
    () => onboardingApi.getSetupProgress(currentOrgId!),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  if (setupCompletedAt || dismissed || !org || isSuperAdmin) return null;

  // Пока прогресс не пришёл — не мигаем «0 из 6».
  const progress = progressSwr.data;
  if (!progress) return null;

  const completed = progress.completed;
  const pending = SETUP_STEPS.filter((s) => progress.steps[s.key] === false);

  const handleContinue = () => {
    forceStart('welcome');
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  return (
    <div className="mb-4 rounded-lg border border-accent/30 bg-accent-muted/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="text-sm font-semibold text-fg-primary">
            Настройка компании: {completed} из 6
          </p>
          {pending.length > 0 && (
            <p className="mt-1 text-xs text-fg-secondary">
              Осталось: {pending.slice(0, 3).map((s) => s.label).join(', ')}
              {pending.length > 3 && ` и ещё ${pending.length - 3}`}
            </p>
          )}
        </div>
        <button
          onClick={handleDismiss}
          className="shrink-0 text-fg-tertiary hover:text-fg-primary transition-colors"
          aria-label="Скрыть"
        >
          <X size={16} />
        </button>
      </div>
      <div className="mt-3">
        <Button size="sm" variant="outline" onClick={handleContinue}>
          Продолжить →
        </Button>
      </div>
    </div>
  );
}
