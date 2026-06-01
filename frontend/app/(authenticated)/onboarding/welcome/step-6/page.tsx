'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { onboardingApi } from '@/api/onboarding.api';
import { OnboardingShell } from '../OnboardingShell';
import { Button } from '@/ui/shadcn/button';

const FEATURES = [
  { id: 'meetings', label: 'Видеовстречи с записью, транскрибацией и ИИ-отчётом', sub: 'Провели созвон — через 2 минуты готовая расшифровка и разбор от ИИ' },
  { id: 'tracker', label: 'Трекер задач и проектов', sub: 'Привычные доски, статусы и исполнители — как в Kaiten или Trello' },
  { id: 'sprints', label: 'Спринты с контролем цели', sub: 'Недельный ритм. Кора следит, что команда реально идёт к цели' },
  { id: 'memory', label: 'Память компании', sub: 'Все встречи, решения и переписки в одном месте навсегда' },
  { id: 'assistant', label: 'ИИ-помощник компании', sub: 'Спросите "что решили по клиенту в марте" — ИИ ответит со ссылкой' },
  { id: 'digital_twins', label: 'Цифровые двойники сотрудников', sub: 'Можно спросить эксперта, даже когда он в отпуске или уже уволился' },
  { id: 'operations_director', label: 'ИИ-операционный директор', sub: 'Картина целиком: кто чем занят, что обещано, где застряло' },
  { id: 'telegram', label: 'Доступ через Телеграм', sub: 'Любой вопрос компании прямо из мессенджера' },
] as const;

export default function Step6Page() {
  const router = useRouter();
  const { currentOrgId, refresh } = useAuth();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleComplete = async () => {
    if (saving || !currentOrgId) return;
    setSaving(true);
    try {
      await onboardingApi.patchWelcome(currentOrgId, { plannedFeatures: [...selected] });
      const { redirectTo } = await onboardingApi.completeWelcome(currentOrgId);
      await refresh();
      // Бэк возвращает '/onboarding/welcome/complete' (loading-экран авто-заливки
      // демо) для новой Org, иначе '/dashboard'.
      router.push(redirectTo || '/onboarding/welcome/complete');
    } catch {
      setSaving(false);
    }
  };

  return (
    <OnboardingShell step={6}>
      <h1 className="text-2xl font-semibold text-fg-primary text-center mb-8">
        Чем планируете пользоваться у нас?
      </h1>
      <div className="flex flex-col gap-3">
        {FEATURES.map((item) => {
          const checked = selected.has(item.id);
          return (
            <button
              key={item.id}
              onClick={() => toggle(item.id)}
              className={`rounded-lg border p-4 text-left transition-colors ${
                checked
                  ? 'border-accent bg-accent-muted'
                  : 'border-border-subtle bg-bg-surface hover:border-accent/50'
              }`}
            >
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 inline-block w-4 h-4 shrink-0 rounded border text-center text-xs leading-4 ${
                  checked ? 'bg-accent border-accent text-accent-fg' : 'border-border-default'
                }`}>
                  {checked ? '✓' : ''}
                </span>
                <div>
                  <p className="text-sm font-medium text-fg-primary">{item.label}</p>
                  <p className="text-xs text-fg-tertiary mt-0.5">{item.sub}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
      <div className="mt-6 flex justify-end">
        <Button onClick={handleComplete} disabled={saving}>
          Завершить →
        </Button>
      </div>
    </OnboardingShell>
  );
}
