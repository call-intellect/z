'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { onboardingApi } from '@/api/onboarding.api';
import { OnboardingShell } from '../OnboardingShell';
import { Button } from '@/ui/shadcn/button';
import { toast } from 'sonner';
import { humanizeApiError } from '@/api/api-error';

const STACK_OPTIONS = [
  { id: 'video_meetings', label: 'Видеовстречи (Зум, Google Meet, Телемост, Контур.Толк)' },
  { id: 'task_tracker', label: 'Трекер задач (Kaiten, Jira, Trello, Битрикс24)' },
  { id: 'knowledge_base', label: 'База знаний (Notion, Confluence, Teamly)' },
  { id: 'messengers', label: 'Командные мессенджеры (Телеграм, Слак)' },
  { id: 'spreadsheets', label: 'Таблицы (Эксель, Google Таблицы)' },
  { id: 'crm', label: 'Учёт клиентов и продаж (amoCRM, Битрикс24, RetailCRM)' },
  { id: 'accounting', label: 'Бухгалтерия и склад (1С, МойСклад)' },
  { id: 'corporate_email', label: 'Корпоративная почта' },
  { id: 'nothing_systematic', label: 'Ничего системного, всё в голове и на словах' },
] as const;

export default function Step5Page() {
  const router = useRouter();
  const { currentOrgId } = useAuth();
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

  const handleNext = async () => {
    if (saving) return;
    if (!currentOrgId) {
      toast.error('Данные профиля ещё загружаются — подождите пару секунд и попробуйте снова.');
      return;
    }
    setSaving(true);
    try {
      await onboardingApi.patchWelcome(currentOrgId, { currentStack: [...selected] });
      router.push('/onboarding/welcome/step-6');
    } catch (e) {
      setSaving(false);
      toast.error(humanizeApiError(e, 'Не удалось сохранить ответ. Попробуйте ещё раз.'));
    }
  };

  return (
    <OnboardingShell step={5}>
      <h1 className="text-2xl font-semibold text-fg-primary text-center mb-8">
        Чем сейчас пользуетесь?
      </h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {STACK_OPTIONS.map((item) => {
          const checked = selected.has(item.id);
          return (
            <button
              key={item.id}
              onClick={() => toggle(item.id)}
              className={`rounded-lg border p-3 text-left text-sm transition-colors ${
                checked
                  ? 'border-accent bg-accent-muted text-fg-primary'
                  : 'border-border-subtle bg-bg-surface text-fg-secondary hover:border-accent/50'
              }`}
            >
              <span className={`mr-2 inline-block w-4 h-4 rounded border text-center text-xs leading-4 ${
                checked ? 'bg-accent border-accent text-accent-fg' : 'border-border-default'
              }`}>
                {checked ? '✓' : ''}
              </span>
              {item.label}
            </button>
          );
        })}
      </div>
      <div className="mt-6 flex justify-end">
        <Button onClick={handleNext} disabled={saving}>
          Далее →
        </Button>
      </div>
    </OnboardingShell>
  );
}
