'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { onboardingApi } from '@/api/onboarding.api';
import { OnboardingShell } from '../OnboardingShell';
import { toast } from 'sonner';
import { humanizeApiError } from '@/api/api-error';

const ROLES = [
  { value: 'founder', label: 'Собственник или основатель' },
  { value: 'general_director', label: 'Генеральный директор' },
  { value: 'operations_director', label: 'Операционный директор' },
  { value: 'department_head', label: 'Руководитель отдела' },
  { value: 'team_lead', label: 'Руководитель проекта или команды' },
  { value: 'specialist', label: 'Сотрудник или специалист' },
] as const;

export default function Step1Page() {
  const router = useRouter();
  const { currentOrgId } = useAuth();
  const [saving, setSaving] = useState<string | null>(null);

  const handleSelect = async (value: string) => {
    if (saving) return;
    setSaving(value);
    try {
      await onboardingApi.patchUserRole({ companyRole: value });
      router.push('/onboarding/welcome/step-2');
    } catch (e) {
      setSaving(null);
      toast.error(humanizeApiError(e, 'Не удалось сохранить. Попробуйте ещё раз.'));
    }
  };

  return (
    <OnboardingShell step={1}>
      <h1 className="text-2xl font-semibold text-fg-primary text-center mb-8">
        Кто вы в компании?
      </h1>
      <div className="grid grid-cols-2 gap-3">
        {ROLES.map((role) => (
          <button
            key={role.value}
            onClick={() => handleSelect(role.value)}
            disabled={saving !== null}
            className="rounded-lg border border-border-subtle bg-bg-surface p-4 text-left text-sm font-medium text-fg-primary transition-colors hover:border-accent hover:bg-accent-muted disabled:opacity-50"
          >
            {role.label}
          </button>
        ))}
      </div>
    </OnboardingShell>
  );
}
