'use client';

/**
 * OnboardingSection — кнопки перезапуска онбординг-туров.
 * ТЗ 2026-05-29 onboarding-v2 §5.9.
 */

import { Button } from '@/ui/shadcn/button';
import { useTourContext } from '@/ui/tour';

export function OnboardingSection() {
  const { forceStart, resetAll } = useTourContext();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-fg-primary">Знакомство</h2>
        <p className="mt-1 text-sm text-fg-secondary">
          Запустить туры заново или сбросить весь прогресс знакомства.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between rounded-lg border border-border-subtle p-4">
          <div>
            <p className="text-sm font-medium text-fg-primary">Тур: Обзор кабинета</p>
            <p className="text-xs text-fg-tertiary">17 подсказок по разделам сайдбара.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => forceStart('overview')}>
            Запустить
          </Button>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border-subtle p-4">
          <div>
            <p className="text-sm font-medium text-fg-primary">Тур: Настройка компании</p>
            <p className="text-xs text-fg-tertiary">6 шагов по настройке cabinet: отделы, должности, команда, спринты.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => forceStart('welcome')}>
            Запустить
          </Button>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border-subtle p-4">
          <div>
            <p className="text-sm font-medium text-fg-primary">Сбросить все туры</p>
            <p className="text-xs text-fg-tertiary">Сбросить прогресс всех туров и показать всё заново.</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => resetAll()}>
            Сбросить
          </Button>
        </div>
      </div>
    </div>
  );
}
