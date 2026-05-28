'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/auth-context';
import { onboardingApi } from '@/api/onboarding.api';
import { Button } from '@/ui/shadcn/button';

export default function DemoChoicePage() {
  const router = useRouter();
  const { currentOrgId, refresh } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleDemo = async () => {
    if (loading || !currentOrgId) return;
    setLoading(true);
    try {
      await onboardingApi.seedDemoWorkspace(currentOrgId);
      await refresh();
      toast.success('Демо-данные загружены! Это пример компании «ТехноСтрим»');
      router.push('/dashboard');
    } catch {
      toast.error('Не удалось загрузить демо-данные');
      setLoading(false);
    }
  };

  const handleFresh = () => {
    router.push('/dashboard');
  };

  return (
    <div className="min-h-screen bg-bg-base flex flex-col">
      {/* Шапка */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border-default">
        <span className="text-lg font-semibold text-fg-primary">Кора</span>
      </header>

      {/* Контент */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-8">
        <div className="w-full max-w-2xl">
          <h1 className="text-2xl font-semibold text-fg-primary text-center mb-3">
            Хотите посмотреть, как это работает?
          </h1>
          <p className="text-sm text-fg-secondary text-center mb-8">
            Загрузите демо-данные готовой компании или начните с пустого кабинета
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Карточка «Демо» */}
            <button
              onClick={handleDemo}
              disabled={loading}
              className="group rounded-xl border border-border-subtle bg-bg-surface p-6 text-left transition-all hover:border-accent hover:shadow-md disabled:opacity-60"
            >
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-accent/10 text-accent text-xl">
                🚀
              </div>
              <h2 className="text-base font-semibold text-fg-primary mb-2">
                Посмотреть демо
              </h2>
              <p className="text-sm text-fg-secondary mb-4">
                Компания «ТехноСтрим», 12 сотрудников, 3 проекта, 7 встреч с AI-отчётами,
                граф знаний и клоны сотрудников.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {['Встречи', 'Трекер', 'Граф знаний', 'Клоны', 'Цели'].map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-bg-subtle px-2 py-0.5 text-[11px] text-fg-tertiary"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <div className="mt-4">
                <Button size="sm" disabled={loading} className="w-full">
                  {loading ? 'Загружаем...' : 'Загрузить демо'}
                </Button>
              </div>
            </button>

            {/* Карточка «С нуля» */}
            <button
              onClick={handleFresh}
              className="group rounded-xl border border-border-subtle bg-bg-surface p-6 text-left transition-all hover:border-accent/50 hover:shadow-sm"
            >
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-bg-subtle text-fg-tertiary text-xl">
                ✨
              </div>
              <h2 className="text-base font-semibold text-fg-primary mb-2">
                Начать с нуля
              </h2>
              <p className="text-sm text-fg-secondary mb-4">
                Создайте свои проекты, пригласите команду и начните проводить встречи.
                Всё будет настроено под вашу компанию.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {['Свои данные', 'Приглашения', 'Настройка'].map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-bg-subtle px-2 py-0.5 text-[11px] text-fg-tertiary"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <div className="mt-4">
                <Button size="sm" variant="ghost" className="w-full">
                  Продолжить
                </Button>
              </div>
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
