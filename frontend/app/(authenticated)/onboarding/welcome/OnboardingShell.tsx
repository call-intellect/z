'use client';

import { useRouter } from 'next/navigation';

interface OnboardingShellProps {
  step: number; // 1..6
  children: React.ReactNode;
}

const STEPS_COUNT = 6;

export function OnboardingShell({ step, children }: OnboardingShellProps) {
  const router = useRouter();

  const goBack = () => {
    if (step > 1) router.push(`/onboarding/welcome/step-${step - 1}`);
  };

  return (
    <div className="min-h-screen bg-bg-base flex flex-col">
      {/* Шапка */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border-default">
        <span className="text-lg font-semibold text-fg-primary">Кора</span>
        <span className="text-sm text-fg-secondary">Шаг {step} из {STEPS_COUNT}</span>
      </header>

      {/* Прогресс-бар */}
      <div className="h-1 bg-bg-subtle">
        <div
          className="h-1 bg-accent-primary transition-all duration-300"
          style={{ width: `${(step / STEPS_COUNT) * 100}%` }}
        />
      </div>

      {/* Кнопка «Назад» */}
      {step > 1 && (
        <button
          onClick={goBack}
          className="mx-6 mt-4 w-fit text-sm text-fg-secondary hover:text-fg-primary transition-colors"
        >
          ← Назад
        </button>
      )}

      {/* Контент */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-8">
        <div className="w-full max-w-lg">
          {children}
        </div>
      </main>
    </div>
  );
}
