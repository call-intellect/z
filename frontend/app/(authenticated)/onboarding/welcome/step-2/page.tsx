'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { onboardingApi } from '@/api/onboarding.api';
import { OnboardingShell } from '../OnboardingShell';
import { toast } from 'sonner';
import { humanizeApiError } from '@/api/api-error';

const SIZES = [
  { value: '1-5', label: '1–5' },
  { value: '6-20', label: '6–20' },
  { value: '21-50', label: '21–50' },
  { value: '51-200', label: '51–200' },
  { value: '201-500', label: '201–500' },
  { value: '500+', label: 'Больше 500' },
] as const;

export default function Step2Page() {
  const router = useRouter();
  const { currentOrgId } = useAuth();
  const [saving, setSaving] = useState(false);

  const handleSelect = async (value: string) => {
    if (saving) return;
    if (!currentOrgId) {
      toast.error('Данные профиля ещё загружаются — подождите пару секунд и попробуйте снова.');
      return;
    }
    setSaving(true);
    try {
      await onboardingApi.patchWelcome(currentOrgId, { teamSize: value });
      router.push('/onboarding/welcome/step-3');
    } catch (e) {
      setSaving(false);
      toast.error(humanizeApiError(e, 'Не удалось сохранить ответ. Попробуйте ещё раз.'));
    }
  };

  return (
    <OnboardingShell step={2}>
      <h1 className="text-2xl font-semibold text-fg-primary text-center mb-8">
        Сколько вас в команде?
      </h1>
      <div className="grid grid-cols-2 gap-3">
        {SIZES.map((size) => (
          <button
            key={size.value}
            onClick={() => handleSelect(size.value)}
            disabled={saving}
            className="rounded-lg border border-border-subtle bg-bg-surface p-4 text-center text-lg font-medium text-fg-primary transition-colors hover:border-accent hover:bg-accent-muted disabled:opacity-50"
          >
            {size.label}
          </button>
        ))}
      </div>
    </OnboardingShell>
  );
}
