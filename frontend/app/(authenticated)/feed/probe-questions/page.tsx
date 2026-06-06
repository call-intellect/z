import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Вопросы агентов — Кора',
};

/**
 * Phase 0.3 — пока сводный список probe-вопросов не реализован отдельным
 * REST-эндпоинтом, отправляем пользователя в общий раздел «Уведомления»,
 * где Кора и так задаёт уточняющие вопросы (см. NotificationsClient,
 * eventType='probe.question' → ProbeAnswerInput). Когда появится фильтр
 * `notifications?eventType=probe.question&status=pending` на бэке — заменим
 * заглушку на реальный список.
 */
export default function ProbeQuestionsPage() {
  return (
    <div className="mx-auto w-full max-w-4xl p-4 md:p-6">
      <h1 className="text-xl font-semibold text-fg-primary md:text-2xl">
        Вопросы агентов
      </h1>
      <p className="text-sm text-fg-tertiary">
        AI-агенты задают уточняющие вопросы, чтобы поддержать актуальность памяти.
      </p>
      <div className="mt-4 space-y-2 rounded-md border border-dashed border-border-subtle bg-bg-elevated px-4 py-8 text-sm text-fg-secondary">
        <p>
          Здесь будут все вопросы Коры. Сейчас они приходят в раздел уведомлений,
          ответ — свободным текстом или голосом, без вариантов на выбор.
        </p>
        <Link
          href="/me/notifications"
          className="inline-flex items-center text-accent hover:underline"
        >
          Перейти к уведомлениям
        </Link>
      </div>
    </div>
  );
}
