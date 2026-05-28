'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { onboardingApi } from '@/api/onboarding.api';
import { OnboardingShell } from '../OnboardingShell';

const INDUSTRIES = [
  { value: 'software', label: 'Разработка программного обеспечения' },
  { value: 'services', label: 'Услуги, агентство, консалтинг' },
  { value: 'manufacturing', label: 'Производство' },
  { value: 'retail', label: 'Торговля и интернет-магазины' },
  { value: 'construction', label: 'Строительство и недвижимость' },
  { value: 'finance', label: 'Финансы и страхование' },
  { value: 'education', label: 'Образование' },
  { value: 'other', label: 'Другое' },
] as const;

export default function Step3Page() {
  const router = useRouter();
  const { currentOrgId } = useAuth();
  const [saving, setSaving] = useState(false);

  const handleSelect = async (value: string) => {
    if (saving || !currentOrgId) return;
    setSaving(true);
    try {
      await onboardingApi.patchWelcome(currentOrgId, { industry: value });
      router.push('/onboarding/welcome/step-4');
    } catch {
      setSaving(false);
    }
  };

  return (
    <OnboardingShell step={3}>
      <h1 className="text-2xl font-semibold text-fg-primary text-center mb-8">
        В какой сфере работает компания?
      </h1>
      <div className="grid grid-cols-2 gap-3">
        {INDUSTRIES.map((item) => (
          <button
            key={item.value}
            onClick={() => handleSelect(item.value)}
            disabled={saving}
            className="rounded-lg border border-border-subtle bg-bg-surface p-4 text-left text-sm font-medium text-fg-primary transition-colors hover:border-accent hover:bg-accent-muted disabled:opacity-50"
          >
            {item.label}
          </button>
        ))}
      </div>
    </OnboardingShell>
  );
}
