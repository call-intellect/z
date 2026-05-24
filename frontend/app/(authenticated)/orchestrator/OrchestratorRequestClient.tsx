'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactElement } from 'react';

import { streamOrchestratorRun } from '@/api/orchestrator.api';

/**
 * SBA δ-1 — клиент request page `/orchestrator`.
 *
 * Минимальный UI: textarea + примеры запросов + кнопка «Запустить research».
 * При запуске:
 *   1) открываем SSE → получаем первый event `started` → берём runId;
 *   2) НЕ ждём окончания — сразу redirect на `/orchestrator/runs/:id`,
 *      где live-view замаунтит свой stream.
 *
 * Это даёт быстрый UX: пользователь не висит на «Подключение...» —
 * сразу видит live timeline.
 */
const EXAMPLES = [
  'Составь отчёт по проекту: что обсуждали последний квартал, какие решения, какие риски.',
  'Сравни наши процессы онбординга и оффбординга сотрудников.',
  'Построй хронологию принятых решений по теме «ребрендинг» за последний год.',
  'Что компания знает о клиенте «Альфа»? Собери всё, что знаем.',
];

export function OrchestratorRequestClient(): ReactElement {
  const router = useRouter();
  const [task, setTask] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = task.trim();
    if (trimmed.length < 5) {
      setError('Опишите запрос (минимум 5 символов).');
      return;
    }
    setSubmitting(true);
    try {
      const stream = streamOrchestratorRun({ task: trimmed });
      for await (const ev of stream) {
        if (ev.type === 'started') {
          // Сразу redirect на live-view — там подхватит остальной stream через /events.
          router.push(`/orchestrator/runs/${ev.runId}`);
          return;
        }
        if (ev.type === 'error') {
          setError(`${ev.code}: ${ev.message}`);
          setSubmitting(false);
          return;
        }
      }
      setError('SSE прервался без события started');
      setSubmitting(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6 text-fg-primary">
      <header>
        <h1 className="text-2xl font-bold">Orchestrator — глубокий research</h1>
        <p className="mt-2 text-sm text-fg-tertiary">
          Сложные запросы: «составь отчёт по X», «сравни Y и Z», «построй
          хронологию». Запустит несколько subagent-ов параллельно, соберёт
          ответ, проверит качество.
        </p>
      </header>

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="text-sm font-semibold text-fg-primary">
          Запрос
        </label>
        <textarea
          className="min-h-[120px] w-full rounded-md border border-border-subtle bg-bg-overlay p-3 text-sm text-fg-primary focus:outline-none focus:ring-2 focus:ring-accent"
          placeholder="Опишите, что нужно собрать..."
          value={task}
          onChange={(e) => setTask(e.target.value)}
          disabled={submitting}
        />
        <div className="flex items-center justify-between">
          <p className="text-xs text-fg-tertiary">
            Лимиты: до 5 subagent-ов, до 15 минут на один research.
          </p>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:bg-accent-hover disabled:opacity-60"
          >
            {submitting ? 'Запускаю…' : 'Запустить research'}
          </button>
        </div>
        {error && (
          <div className="rounded-md border border-chip-danger-bg bg-chip-danger-bg p-3 text-sm text-chip-danger-fg">
            Ошибка: {error}
          </div>
        )}
      </form>

      <section className="rounded-md border border-border-subtle bg-bg-overlay p-4">
        <h2 className="mb-3 text-sm font-semibold text-fg-primary">
          Примеры
        </h2>
        <ul className="flex flex-col gap-2">
          {EXAMPLES.map((ex) => (
            <li key={ex}>
              <button
                type="button"
                className="w-full rounded-md border border-border-subtle bg-bg-base p-3 text-left text-sm text-fg-primary hover:border-accent"
                onClick={() => setTask(ex)}
                disabled={submitting}
              >
                {ex}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
