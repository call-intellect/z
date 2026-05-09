'use client';

import { useToast } from '@/contexts/toast-context';
import { Button } from '@/ui/components/shared/Button';
import { t } from '@/lib/i18n';

type Props = { email: string };

export function FollowUpCard({ email }: Props) {
  const { addToast } = useToast();

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(email);
      addToast({ type: 'success', message: t('result.follow_up_copied') });
    } catch {
      addToast({ type: 'error', message: t('errors.unknown') });
    }
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">
          {t('result.follow_up')}
        </h2>
        <Button variant="secondary" size="sm" onClick={() => void onCopy()}>
          {t('result.follow_up_copy')}
        </Button>
      </header>
      <pre className="whitespace-pre-wrap rounded bg-slate-50 p-4 text-sm text-slate-800">
        {email}
      </pre>
    </section>
  );
}
