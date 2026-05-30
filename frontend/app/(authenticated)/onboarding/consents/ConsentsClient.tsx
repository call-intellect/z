'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ShieldCheck } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { privacyApi, type ConsentDataType } from '@/api/privacy.api';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/ui/shadcn/button';

interface ConsentDef {
  type: ConsentDataType;
  title: string;
  description: string;
  defaultValue: boolean;
}

const CONSENTS: readonly ConsentDef[] = [
  {
    type: 'checkin_processing',
    title: 'Обработка чек-инов и настроения',
    description:
      'Кора будет читать ваши утренние и вечерние чек-ины, определять их настроение (зелёное / жёлтое / красное) и использовать для агрегации температуры команды.',
    defaultValue: true,
  },
  {
    type: 'risk_analysis',
    title: 'Анализ сигналов риска',
    description:
      'AI ищет сигналы возможного выгорания, перегруза или конфликта и подсказывает руководителю, что стоит поговорить.',
    defaultValue: true,
  },
  {
    type: 'card_visible_to_manager',
    title: 'Показ карточки руководителю',
    description:
      'Ваша персональная pulse-карточка будет видна непосредственному руководителю. Полные тексты ваших чек-инов не показываются — только агрегаты и сигналы.',
    defaultValue: true,
  },
] as const;

export function ConsentsClient() {
  const router = useRouter();
  const { currentOrgId, isLoading } = useAuth();
  const [values, setValues] = useState<Record<ConsentDataType, boolean>>(() => {
    const init: Record<ConsentDataType, boolean> = {
      checkin_processing: true,
      risk_analysis: true,
      card_visible_to_manager: true,
    };
    for (const c of CONSENTS) init[c.type] = c.defaultValue;
    return init;
  });
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const handleToggle = (type: ConsentDataType) => {
    setValues((prev) => ({ ...prev, [type]: !prev[type] }));
  };

  const handleSubmit = async () => {
    if (!currentOrgId) {
      setErrorText('Не определена организация — обновите страницу.');
      return;
    }
    setSubmitting(true);
    setErrorText(null);
    try {
      for (const c of CONSENTS) {
        await privacyApi.upsertMyConsent(currentOrgId, {
          dataType: c.type,
          consented: values[c.type] ?? false,
        });
      }
      router.push('/dashboard');
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Не удалось сохранить согласия.';
      setErrorText(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <section className="mx-auto w-full max-w-2xl px-4 py-12">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-fg-tertiary" />
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-2xl px-4 py-8">
      <header className="mb-6 flex items-start gap-3">
        <ShieldCheck className="mt-1 shrink-0 text-accent" size={28} />
        <div>
          <h1 className="text-2xl font-semibold text-fg-primary">
            Согласия на обработку данных
          </h1>
          <p className="mt-1 text-sm text-fg-secondary">
            По 152-ФЗ для нашей работы нужно ваше согласие на три пункта.
            Эти решения можно изменить в любой момент в разделе «Приватность».
          </p>
        </div>
      </header>

      <div className="space-y-3">
        {CONSENTS.map((c) => {
          const checked = values[c.type] ?? false;
          return (
            <label
              key={c.type}
              className="flex cursor-pointer gap-3 rounded-xl border border-border-subtle bg-bg-card p-4 transition-colors hover:border-accent/40"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => handleToggle(c.type)}
                className="mt-0.5 size-4 shrink-0 rounded border-border-strong text-accent focus:ring-accent"
              />
              <div className="flex-1">
                <div className="text-sm font-medium text-fg-primary">{c.title}</div>
                <p className="mt-1 text-xs leading-relaxed text-fg-secondary">
                  {c.description}
                </p>
              </div>
            </label>
          );
        })}
      </div>

      {errorText && (
        <div className="mt-4 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger-fg">
          {errorText}
        </div>
      )}

      <Button
        onClick={handleSubmit}
        disabled={submitting || !currentOrgId}
        className="mt-6 w-full"
      >
        {submitting ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Сохраняем…
          </span>
        ) : (
          'Продолжить'
        )}
      </Button>
      <p className="mt-3 text-center text-xs text-fg-tertiary">
        Отказ от пунктов 1-2 отключит pulse-метрики персонально для вас.
      </p>
    </section>
  );
}
