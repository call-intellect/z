import type { Metadata } from 'next';

import { FeedbackForm } from './components/FeedbackForm';
import { FeedbackHistory } from './components/FeedbackHistory';

export const metadata: Metadata = {
  title: 'Ваши предложения — Z',
};

/**
 * `/feedback` — пользовательский канал «Ваши предложения».
 *
 * Серверный компонент-обёртка: заголовок + 2 клиентских блока (форма и
 * история). Лимит 5 сообщений в сутки на пользователя — контролируется на
 * backend, фронт лишь показывает счётчик.
 *
 * Фаза 3 ТЗ user-feedback-with-ai-clustering
 * (см. plans/tz/2026-05-25-user-feedback-with-ai-clustering.md).
 */
export default function FeedbackPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          Ваши предложения
        </h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Прямой канал к команде Z. Расскажите, чего вам не хватает, что
          мешает, а что — нравится. Раз в сутки мы агрегируем все обращения
          в смысловые блоки и используем их для приоритизации продукта.
        </p>
      </header>

      <FeedbackForm />
      <div className="mt-10">
        <FeedbackHistory />
      </div>
    </main>
  );
}
