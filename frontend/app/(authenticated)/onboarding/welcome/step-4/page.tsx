'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { onboardingApi } from '@/api/onboarding.api';
import { OnboardingShell } from '../OnboardingShell';
import { Button } from '@/ui/shadcn/button';

const PAIN_POINTS = [
  { id: 'goals_dissolve', label: 'Цели на квартал растворяются, к середине никто не помнит куда шли' },
  { id: 'problems_hidden', label: 'Сотрудники замалчивают проблемы, узнаю когда уже сгорело' },
  { id: 'green_status_no_progress', label: 'В трекере зелёные галочки, а реального движения нет' },
  { id: 'broken_client_promises', label: 'Клиенту пообещали на встрече — забыли сделать' },
  { id: 'key_person_risk', label: 'Уйдёт ключевой человек — встанет половина компании' },
  { id: 'no_knowledge_base', label: 'Каждого нового сотрудника учу заново, базы знаний нет' },
  { id: 'drowning_in_operations', label: 'Тону в операционке, на стратегию нет ни одного часа в неделю' },
  { id: 'chat_chaos', label: 'Всё важное в чатах — нужное решение не найти через неделю' },
  { id: 'meetings_no_outcome', label: 'Планёрки идут по два часа, на выходе непонятно что решили' },
  { id: 'unclear_workload', label: 'Не вижу кто чем загружен — кто-то завален, кто-то простаивает' },
  { id: 'bottleneck_on_owner', label: 'Без меня ничего не двигается, я как бутылочное горлышко' },
  { id: 'repeated_questions', label: 'Одни и те же вопросы по десять раз — никто ничего не запоминает' },
] as const;

export default function Step4Page() {
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
    if (saving || !currentOrgId || selected.size === 0) return;
    setSaving(true);
    try {
      await onboardingApi.patchWelcome(currentOrgId, { painPoints: [...selected] });
      router.push('/onboarding/welcome/step-5');
    } catch {
      setSaving(false);
    }
  };

  return (
    <OnboardingShell step={4}>
      <h1 className="text-2xl font-semibold text-fg-primary text-center mb-8">
        Что у вас сейчас болит?
      </h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PAIN_POINTS.map((item) => {
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
        <Button
          onClick={handleNext}
          disabled={selected.size === 0 || saving}
        >
          Далее →
        </Button>
      </div>
    </OnboardingShell>
  );
}
