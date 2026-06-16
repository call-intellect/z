'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { referralsApi } from '@/api/referrals.api';
import { referralFromApi, type ReferralDomain } from '@/domain/referral';
import { GlassCard } from '@/ui/components/dashboard/modern';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';

interface Props {
  onCreated: (referral: ReferralDomain) => void;
}

/**
 * CreateLinkCard — состояние A (`referral === null`): главное действие
 * «Создать ссылку» в один клик с чекбоксом оферты.
 *
 * Правила (ТЗ §6.1, §6.2):
 *   - Кнопка disabled пока не отмечен чекбокс оферты (юридически обязательный).
 *   - Без ИНН и реквизитов — это отдельная задача «подготовиться к выводу
 *     денег», она не блокирует получение ссылки.
 *   - Чекбокс отправляет `contractAccepted: true` в backend; backend
 *     валидирует через Zod `literal(true)` и фиксирует `contractAcceptedAt = now()`.
 *
 * Текст копи — ТЗ §9 (вариант 3, финальный).
 * Редизайн B10: стеклянная обёртка `GlassCard`. Логику создания не трогаем.
 */
export function CreateLinkCard({ onCreated }: Props) {
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!agreed) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await referralsApi.create({ contractAccepted: true });
      onCreated(referralFromApi(created));
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : 'Не удалось создать ссылку. Попробуй ещё раз.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <GlassCard className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          Получи ссылку прямо сейчас
        </h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
          Один клик — и ты можешь начать делиться. Реквизиты для вывода
          заполнишь, когда захочешь получить деньги.
        </p>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <Button
          type="button"
          size="lg"
          onClick={handleSubmit}
          disabled={!agreed || submitting}
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          Создать ссылку
        </Button>

        <label
          className="flex cursor-pointer items-start gap-2 text-sm"
          style={{ color: 'var(--text-secondary)' }}
        >
          <Checkbox
            checked={agreed}
            onCheckedChange={(v) => setAgreed(v === true)}
            className="mt-0.5"
            aria-label="Согласен с офертой партнёрской программы"
          />
          <span>
            Создаю ссылку → соглашаюсь с условиями{' '}
            <Link
              href="/legal/partner-offer"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline-offset-2 hover:underline"
            >
              оферты партнёрской программы
            </Link>
          </span>
        </label>
      </div>

      {error && (
        <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </div>
      )}
    </GlassCard>
  );
}
