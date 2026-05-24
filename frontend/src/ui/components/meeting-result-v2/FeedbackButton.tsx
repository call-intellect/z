/**
 * Фаза A.3 — Кнопка обратной связи 👍/👎 под AI-отчётом встречи.
 *
 * Источник: ТЗ A §7.3, §8.3 («Поделиться отзывом об отчёте»).
 *
 * Использование: <FeedbackButton meetingId="..." />.
 *
 * Поведение:
 *   1. При первом рендере — загружает свою реакцию через GET .../feedback/me.
 *   2. Клик «👍» — POST с reaction=positive. Если уже стоит positive — toggle = DELETE.
 *   3. Аналогично «👎».
 *   4. На любую ошибку показывает toast и не меняет локальное состояние.
 *
 * Доступ: запросы идут через CookieAuthGuard, серверная сторона определяет
 * доступ к встрече (host / member / participant).
 */

'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  type AiResultFeedbackApi,
  meetingResultFeedbackApi,
} from '@/api/meeting-result-feedback.api';
import { toast } from '@/ui/shadcn/toast';

interface FeedbackButtonProps {
  meetingId: string;
  /** Опциональный класс-обёртка. */
  className?: string;
}

export function FeedbackButton({ meetingId, className }: FeedbackButtonProps) {
  const [feedback, setFeedback] = useState<AiResultFeedbackApi | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fb = await meetingResultFeedbackApi.getOwn(meetingId);
        if (!cancelled) setFeedback(fb);
      } catch {
        // Тихо игнорируем — не критично, пользователь сможет поставить руками.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  const handleReact = useCallback(
    async (reaction: 'positive' | 'negative') => {
      if (submitting) return;
      setSubmitting(true);
      try {
        if (feedback?.reaction === reaction) {
          // toggle off
          await meetingResultFeedbackApi.remove(meetingId);
          setFeedback(null);
        } else {
          const updated = await meetingResultFeedbackApi.create(meetingId, {
            reaction,
          });
          setFeedback(updated);
        }
      } catch (err) {
        toast.error('Не удалось отправить отзыв', {
          description: err instanceof Error ? err.message : 'Попробуйте ещё раз',
        });
      } finally {
        setSubmitting(false);
      }
    },
    [feedback, meetingId, submitting],
  );

  if (loading) {
    return (
      <div className={className}>
        <div className="text-sm text-muted-foreground">Загрузка…</div>
      </div>
    );
  }

  return (
    <div className={className} data-testid="ai-feedback">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">
          Полезен ли этот отчёт?
        </span>
        <button
          type="button"
          aria-label="Полезно (большой палец вверх)"
          disabled={submitting}
          onClick={() => void handleReact('positive')}
          className={`inline-flex items-center justify-center rounded-md border px-2.5 py-1 text-sm transition-colors disabled:opacity-50 ${
            feedback?.reaction === 'positive'
              ? 'border-success bg-chip-success-bg text-chip-success-fg'
              : 'border-border bg-background hover:bg-muted'
          }`}
        >
          <span aria-hidden>👍</span>
        </button>
        <button
          type="button"
          aria-label="Не полезно (большой палец вниз)"
          disabled={submitting}
          onClick={() => void handleReact('negative')}
          className={`inline-flex items-center justify-center rounded-md border px-2.5 py-1 text-sm transition-colors disabled:opacity-50 ${
            feedback?.reaction === 'negative'
              ? 'border-danger bg-chip-danger-bg text-chip-danger-fg'
              : 'border-border bg-background hover:bg-muted'
          }`}
        >
          <span aria-hidden>👎</span>
        </button>
        {feedback ? (
          <span className="text-xs text-muted-foreground">
            Спасибо за отзыв — он попадёт в аналитику качества шаблона.
          </span>
        ) : null}
      </div>
    </div>
  );
}
