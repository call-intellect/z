'use client';

import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '@/api/api-error';
import {
  type DailyCheckInApi,
  myCheckInsApi,
} from '@/api/my-check-ins.api';
import {
  VoiceInputButton,
  appendTranscript,
} from '@/ui/components/voice/VoiceInputButton';

/**
 * SBA β-8 — `/me/check-ins` (client).
 *
 * - История последних 30 дней (GET /history).
 * - Manual create: kind (morning|evening) + текст плана / сделанного / блокеров
 *   (один из трёх). Backend сделает upsert по unique (person, kind, dateLocal).
 */
export function MyCheckInsClient() {
  const [items, setItems] = useState<DailyCheckInApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form state.
  const [kind, setKind] = useState<'morning' | 'evening'>('morning');
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    myCheckInsApi
      .history(30)
      .then((res) => {
        setItems(res.items);
        setError(null);
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code === 'forbidden') {
          setError(
            'У вас нет персональной записи в этой организации — чек-ины недоступны. Обратитесь к администратору.',
          );
        } else {
          setError(
            err instanceof Error ? err.message : 'Не удалось загрузить историю',
          );
        }
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const submit = async () => {
    if (!text.trim()) {
      setSubmitMsg('Заполните хотя бы одну строку.');
      return;
    }
    setSubmitting(true);
    setSubmitMsg(null);
    try {
      const body =
        kind === 'morning'
          ? {
              kind,
              plans: text
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean)
                .slice(0, 50)
                .map((t) => ({ text: t })),
              rawText: text,
            }
          : {
              kind,
              dones: text
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean)
                .slice(0, 50)
                .map((t) => ({ text: t })),
              rawText: text,
            };
      await myCheckInsApi.create(body);
      setText('');
      setSubmitMsg('Чек-ин сохранён');
      refresh();
    } catch (err: unknown) {
      setSubmitMsg(
        err instanceof Error ? err.message : 'Не удалось сохранить чек-ин',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Мои чек-ины</h1>
        <p className="text-sm text-fg-secondary">
          Утренние и вечерние короткие отчёты — планы, что сделано, блокеры.
        </p>
      </header>

      <section className="mb-8 rounded border bg-bg-card p-4">
        <h2 className="mb-3 text-lg font-semibold">Новый чек-ин</h2>
        <div className="mb-3 flex items-center gap-3">
          <label className="text-sm">
            Тип:
            <select
              className="ml-2 rounded border px-2 py-1 text-sm"
              value={kind}
              onChange={(e) => setKind(e.target.value as 'morning' | 'evening')}
            >
              <option value="morning">Утренний (план)</option>
              <option value="evening">Вечерний (что сделано)</option>
            </select>
          </label>
        </div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-xs text-fg-secondary">
            {kind === 'morning' ? 'Планы на сегодня' : 'Что сделано'}
          </span>
          {/* Голосовой ВВОД: запись через MediaRecorder → серверный ASR (Vox),
              расшифровка аппендится в поле. Где запись недоступна (нет
              getUserMedia/MediaRecorder) — кнопка не появляется. iOS Safari ок. */}
          <VoiceInputButton
            onTranscript={(t) => setText((prev) => appendTranscript(prev, t))}
          />
        </div>
        <textarea
          className="mb-2 w-full rounded border p-2 text-sm"
          rows={4}
          placeholder={
            kind === 'morning'
              ? 'Что планирую сегодня (одна строка = один пункт)…'
              : 'Что удалось закрыть (одна строка = один пункт)…'
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={submitting}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="rounded bg-info px-4 py-1.5 text-sm font-medium text-info-fg disabled:opacity-50"
          >
            {submitting ? 'Сохраняем…' : 'Сохранить'}
          </button>
          {submitMsg ? (
            <span className="text-xs text-fg-secondary">{submitMsg}</span>
          ) : null}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">История за 30 дней</h2>
        {loading ? (
          <p className="text-sm text-fg-secondary">Загрузка…</p>
        ) : error ? (
          <p className="rounded border border-chip-danger-bg bg-chip-danger-bg p-3 text-sm text-chip-danger-fg">
            {error}
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm text-fg-secondary">Пока чек-инов нет.</p>
        ) : (
          <ul className="divide-y rounded border bg-bg-card">
            {items.map((c) => (
              <li key={c.id} className="p-3 text-sm">
                <div className="mb-1 flex items-center gap-3">
                  <span className="font-medium">
                    {c.kind === 'morning' ? 'Утро' : 'Вечер'}
                  </span>
                  <span className="text-xs text-fg-secondary">{c.dateLocal}</span>
                  <CheckInSourceBadge source={c.source} />
                  {c.curatorReview ? (
                    <span className="rounded bg-chip-warning-bg px-2 py-0.5 text-xs text-chip-warning-fg">
                      требует проверки
                    </span>
                  ) : null}
                </div>
                <CheckInBody dto={c} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function CheckInBody({ dto }: { dto: DailyCheckInApi }) {
  return (
    <div className="grid gap-2 text-xs md:grid-cols-3">
      <ListBlock title="Планы" items={dto.plans.map((p) => p.text)} />
      <ListBlock title="Сделано" items={dto.dones.map((d) => d.text)} />
      <ListBlock
        title="Блокеры"
        items={dto.blockers.map(
          (b) => `${b.text}${b.severity ? ` (${b.severity})` : ''}`,
        )}
      />
    </div>
  );
}

/**
 * ТЗ 2026-05-29 telegram-self-initiated-checkins Phase 6 — значок «источник».
 * 🌅 — ответ на cron-prompt, ✋ — сотрудник сам написал боту, 🖊 — manual через UI.
 */
function CheckInSourceBadge({
  source,
}: {
  source: 'cron_prompted' | 'self_initiated' | 'manual';
}) {
  const map: Record<typeof source, { icon: string; title: string }> = {
    cron_prompted: { icon: '🌅', title: 'Ответ на утренний/вечерний прампт от Коры' },
    self_initiated: { icon: '✋', title: 'Написал в Telegram-бот сам, без прампта' },
    manual: { icon: '🖊', title: 'Создан вручную через веб-кабинет' },
  };
  const m = map[source];
  return (
    <span
      title={m.title}
      className="rounded bg-bg-overlay px-2 py-0.5 text-xs text-fg-secondary"
    >
      {m.icon}
    </span>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <div className="text-fg-secondary">{title}:</div>
      {items.length === 0 ? (
        <div className="text-fg-tertiary">—</div>
      ) : (
        <ul className="list-disc pl-4">
          {items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
