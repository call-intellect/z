'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import useSWR from 'swr';

import { ApiError } from '@/api/api-error';
import {
  operationsDailyDigestApi,
  type DailyDigestApi,
} from '@/api/operations-daily-digest.api';
import { useAuth } from '@/contexts/auth-context';
import {
  fromDailyDigestApi,
  type DailyDigestDomain,
  type DailyDigestEventDomain,
  type DailyDigestPersonShinedDomain,
  type DailyDigestPersonStruggledDomain,
  type DailyDigestUrgentItemDomain,
} from '@/domain/operations-daily-digest';
import { CountUp } from '@/ui/components/dashboard/charts';
import { OperationsTabs } from '@/ui/components/dashboard/OperationsTabs';

/**
 * SBA β-8.3 Wave 1 — клиентский UI ежедневного отчёта операционного директора.
 *
 * Загрузка: SWR + `operationsDailyDigestApi.getByDate(date)`. Возвращает
 * `null` при 404 (digest_not_found), показывает empty-state.
 *
 * Date-picker:
 *   - По умолчанию — «вчера в МСК» (если в query нет `date=YYYY-MM-DD`).
 *   - Кнопки ← / →, native input[type=date].
 *
 * Кнопка «Перегенерировать» — только при admin / super_admin (через
 * `useAuth().currentOrgRole / isSuperAdmin`). После успешного POST —
 * mutate SWR кэша.
 *
 * UI:
 *   - Карточка shortSummary сверху.
 *   - Markdown-рендер bodyMarkdown (react-markdown + rehype-sanitize, как в
 *     `MeetingSummaryRender`).
 *   - Структурированные виджеты (счётчики метрик).
 *
 * Все строки — на русском (см. CLAUDE.md, feedback admin_ui_russian_only).
 */
export function DailyDigestClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { currentOrgRole, isSuperAdmin } = useAuth();

  const initialDate = searchParams?.get('date') ?? defaultYesterdayMsk();
  const [date, setDate] = useState(initialDate);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Если URL поменяли извне (через ссылку) — синхронизируем state.
  useEffect(() => {
    const fromUrl = searchParams?.get('date');
    if (fromUrl && fromUrl !== date) {
      setDate(fromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const swr = useSWR(
    ['daily-digest', date],
    async () => operationsDailyDigestApi.getByDate(date),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const domain = useMemo<DailyDigestDomain | null>(() => {
    if (!swr.data) return null;
    return fromDailyDigestApi(swr.data);
  }, [swr.data]);

  const canRegenerate =
    isSuperAdmin || currentOrgRole === 'admin' || currentOrgRole === 'owner';

  const goToDate = (next: string) => {
    setDate(next);
    setGenerateError(null);
    const params = new URLSearchParams(searchParams?.toString() ?? '');
    params.set('date', next);
    router.replace(`/dashboard/operations/daily?${params.toString()}`);
  };

  const handleRegenerate = async () => {
    setGenerating(true);
    setGenerateError(null);
    try {
      const fresh = await operationsDailyDigestApi.generate(date);
      // Принудительно обновляем SWR-кэш для этой даты.
      await swr.mutate(fresh, { revalidate: false });
    } catch (e) {
      if (e instanceof ApiError) {
        setGenerateError(
          e.code === 'forbidden_role'
            ? 'Только admin или super_admin может пересобрать отчёт.'
            : e.message,
        );
      } else {
        setGenerateError(
          e instanceof Error ? e.message : 'Не удалось пересобрать отчёт',
        );
      }
    } finally {
      setGenerating(false);
    }
  };

  const prevDate = shiftDate(date, -1);
  const nextDate = shiftDate(date, 1);
  const today = todayUtcDate();
  const nextDisabled = nextDate > today;

  const errorMessage = swrErrorMessage(swr.error);

  return (
    <div className="p-6">
      {/* §5.2 — Sticky-header. */}
      <header className="sticky top-0 z-20 -mx-6 mb-6 border-b border-border-subtle/50 bg-bg-base/85 px-6 py-3 backdrop-blur-md">
        <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
          Ежедневный отчёт
        </h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Сводка за сутки в МСК: температура команды, новые блокеры,
          просроченные обещания, цели, сигналы. Генерируется автоматически
          каждый день в 01:00 МСК.
        </p>
      </header>

      {/* §5.1 — Общая навигация по операционному разделу. */}
      <OperationsTabs />

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded border border-border-subtle bg-bg-surface p-3">
        <button
          type="button"
          onClick={() => goToDate(prevDate)}
          className="rounded border border-border-subtle px-3 py-1 text-sm text-fg-primary hover:bg-bg-overlay"
        >
          ← Предыдущий день
        </button>
        <label className="flex items-center gap-2 text-sm text-fg-secondary">
          <span>Дата:</span>
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => goToDate(e.target.value)}
            className="rounded border border-border-subtle bg-bg-base px-2 py-1 text-sm text-fg-primary"
          />
        </label>
        <button
          type="button"
          onClick={() => goToDate(nextDate)}
          disabled={nextDisabled}
          className="rounded border border-border-subtle px-3 py-1 text-sm text-fg-primary hover:bg-bg-overlay disabled:opacity-50"
        >
          Следующий день →
        </button>
        {canRegenerate ? (
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={generating}
            className="ml-auto rounded bg-accent px-3 py-1 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-50"
            title="Принудительно пересобрать отчёт (admin / super_admin)"
          >
            {generating ? 'Пересобираем…' : 'Перегенерировать'}
          </button>
        ) : null}
      </div>

      {generateError ? (
        <p className="mb-4 rounded border border-chip-danger-bg bg-chip-danger-bg p-3 text-sm text-chip-danger-fg">
          {generateError}
        </p>
      ) : null}

      {swr.isLoading ? (
        <p className="rounded border border-border-subtle bg-bg-surface p-4 text-sm text-fg-secondary">
          Загрузка отчёта…
        </p>
      ) : errorMessage ? (
        <p className="rounded border border-chip-warning-bg bg-chip-warning-bg p-4 text-sm text-chip-warning-fg">
          {errorMessage}
        </p>
      ) : domain ? (
        <DigestView data={domain} rawApi={swr.data!} />
      ) : (
        <EmptyState date={date} />
      )}
    </div>
  );
}

function EmptyState({ date }: { date: string }) {
  return (
    <div className="rounded border border-border-subtle bg-bg-surface p-6 text-center">
      <p className="text-sm text-fg-secondary">
        Отчёт за {formatRu(date)} ещё не сгенерирован.
      </p>
      <p className="mt-1 text-xs text-fg-tertiary">
        Автоматическая генерация — каждый день в 01:00 МСК. Если день уже
        прошёл, можно «Перегенерировать» вручную (admin / super_admin).
      </p>
    </div>
  );
}

function DigestView(props: { data: DailyDigestDomain; rawApi: DailyDigestApi }) {
  const { data } = props;
  const m = data.metrics;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const undelivered = data.deliveredAt === null;

  // Pulse Wave 2 §2.1 — если ВСЕ расширенные секции пусты, показываем
  // нейтральный «вчера было спокойно» вместо четырёх пустых блоков.
  const allRuntimeEmpty =
    data.eventsToday.length === 0 &&
    data.urgentItems.length === 0 &&
    data.whoShined.length === 0 &&
    data.whoStruggled.length === 0;

  return (
    <div className="space-y-6">
      {data.shortSummary ? (
        <section className="rounded border border-accent/30 bg-accent/5 p-4">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-xs uppercase tracking-wide text-fg-tertiary">
              Короткая выжимка
            </h2>
            {undelivered ? (
              <span className="rounded bg-chip-warning-bg px-2 py-0.5 text-[10px] text-chip-warning-fg">
                Не доставлено в Telegram
              </span>
            ) : null}
          </div>
          <p className="text-sm text-fg-primary">{data.shortSummary}</p>
        </section>
      ) : null}

      {/* Pulse Wave 2 §2.1 — приоритет вверху: срочное → события → люди. */}
      <UrgentItemsSection items={data.urgentItems} />
      <EventsTimelineSection items={data.eventsToday} />
      <WhoShinedSection items={data.whoShined} />
      <WhoStruggledSection items={data.whoStruggled} />

      {allRuntimeEmpty ? (
        <section className="rounded border border-border-subtle bg-bg-surface p-4 text-center">
          <p className="text-sm text-fg-secondary">
            Вчера было спокойно: ни срочных пунктов, ни заметных событий,
            ни просевших сотрудников.
          </p>
        </section>
      ) : null}

      <section className="rounded border border-border-subtle bg-bg-surface p-4">
        <h2 className="mb-2 text-lg font-semibold text-fg-primary">
          Полный отчёт
        </h2>
        <div className="prose prose-sm prose-invert max-w-none text-fg-primary [&>*]:my-2">
          <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
            {data.bodyMarkdown}
          </ReactMarkdown>
        </div>
      </section>

      <section className="rounded border border-border-subtle bg-bg-surface p-4">
        <h2 className="mb-2 text-lg font-semibold text-fg-primary">
          Температура команды
        </h2>
        {m.totalCheckIns === 0 ? (
          <p className="text-sm text-fg-secondary">
            За {formatRu(data.dateLocal)} нет чек-инов с настроением.
          </p>
        ) : (
          <p className="text-sm text-fg-secondary">
            Всего чек-инов: {m.totalCheckIns}. Зелёных {pct(m.greenShare)},
            жёлтых {pct(m.yellowShare)}, красных {pct(m.redShare)}.
          </p>
        )}
      </section>

      {/* §5.3/§5.4 — Hero-strip главных метрик дня с CountUp.
          Временных рядов в API daily-digest нет — sparkline не выдумываем. */}
      <section className="rounded-2xl bg-gradient-to-br from-bg-card via-bg-card to-accent/5 p-4 shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300 motion-safe:fill-mode-backwards md:p-5">
        <h2 className="mb-3 text-xs uppercase tracking-widest text-fg-tertiary">
          Главное за день
        </h2>
        <CountersRow
          items={[
            { label: 'Новые блокеры', value: m.newBlockers.length },
            { label: 'Просроченные обещания', value: m.overdueCommitments.length },
            { label: 'Цели закрыты', value: m.goals.completed },
            { label: 'Цели провалены', value: m.goals.failed },
            { label: 'Новые сигналы', value: m.newHighInsights.length },
            { label: 'Решения', value: m.decisions.length },
          ]}
        />
      </section>

      {m.newBlockers.length > 0 ? (
        <section className="rounded border border-border-subtle bg-bg-surface p-4">
          <h2 className="mb-2 text-lg font-semibold text-fg-primary">
            Новые блокеры
          </h2>
          <ul className="space-y-1 text-sm">
            {m.newBlockers.map((b) => (
              <li
                key={b.blockId}
                className="flex items-start gap-2 text-fg-primary"
              >
                <span className="text-fg-tertiary">·</span>
                <span className="flex-1">{b.name}</span>
                <span className="text-xs text-fg-tertiary">
                  уверенность {Math.round(b.confidence * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {m.overdueCommitments.length > 0 ? (
        <section className="rounded border border-border-subtle bg-bg-surface p-4">
          <h2 className="mb-2 text-lg font-semibold text-fg-primary">
            Просроченные обещания
          </h2>
          <ul className="space-y-1 text-sm">
            {m.overdueCommitments.map((c) => (
              <li
                key={c.blockId}
                className="flex items-start gap-2 text-fg-primary"
              >
                <span className="text-fg-tertiary">·</span>
                <span className="flex-1">{c.name}</span>
                {c.dueDate ? (
                  <span className="text-xs text-fg-tertiary">
                    срок {formatRu(c.dueDate.slice(0, 10))}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {m.topRedCheckIns.length > 0 ? (
        <section className="rounded border border-border-subtle bg-bg-surface p-4">
          <h2 className="mb-2 text-lg font-semibold text-fg-primary">
            Красные чек-ины
          </h2>
          <ul className="space-y-2 text-sm">
            {m.topRedCheckIns.map((r) => (
              <li key={r.checkInId} className="rounded bg-bg-overlay p-2">
                <div className="text-xs text-fg-tertiary">
                  {r.personName ?? 'без имени'}
                </div>
                <div className="text-fg-primary">{r.excerpt}</div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="text-xs text-fg-tertiary">
        Сгенерировано{' '}
        {data.createdAt.toLocaleString('ru-RU')}
        {data.llmTaskRouteId
          ? ` · модель: ${data.llmTaskRouteId}`
          : ' · автоматически (без LLM)'}
        {data.deliveredAt
          ? ` · доставлено в Telegram ${data.deliveredAt.toLocaleString('ru-RU')}`
          : ''}
      </p>
    </div>
  );
}

function CountersRow(props: {
  items: Array<{ label: string; value: number }>;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {props.items.map((it) => (
        <div
          key={it.label}
          className="rounded-xl border border-border-subtle bg-bg-surface p-3 shadow-sm transition-shadow hover:shadow-md"
        >
          <div className="text-[10px] uppercase tracking-wide text-fg-tertiary">
            {it.label}
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-fg-primary">
            <CountUp to={it.value} />
          </div>
        </div>
      ))}
    </div>
  );
}

function swrErrorMessage(err: unknown): string | null {
  if (!err) return null;
  if (err instanceof ApiError) {
    if (err.code === 'forbidden_role') {
      return 'Нет доступа к ежедневному отчёту (нужна роль coo / admin / owner).';
    }
    return err.message;
  }
  return err instanceof Error ? err.message : 'Не удалось загрузить отчёт';
}

function defaultYesterdayMsk(): string {
  // МСК = UTC+3. Берём «сейчас в МСК», вычитаем 24 часа, форматируем как
  // YYYY-MM-DD по МСК-таймзоне.
  const now = new Date();
  // Сдвинули на -1 день и +3 часа (МСК) — получили «вчера в МСК».
  const mskDate = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  mskDate.setUTCDate(mskDate.getUTCDate() - 1);
  return toIso(mskDate);
}

function shiftDate(dateLocal: string, days: number): string {
  const d = new Date(`${dateLocal}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

function todayUtcDate(): string {
  return toIso(new Date());
}

function toIso(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function formatRu(dateLocal: string): string {
  // YYYY-MM-DD → DD.MM.YYYY.
  const [y, m, d] = dateLocal.split('-');
  if (!y || !m || !d) return dateLocal;
  return `${d}.${m}.${y}`;
}

/* ──────────────────────────────────────────────────────────────────────
 * Pulse Wave 2 §2.1 — секции «Срочное / Хронология / Шайнили / Просели».
 * Каждая секция:
 *   - empty list → не рендерим карточку (общий fallback «вчера было спокойно»
 *     показывается в `DigestView`, если ВСЕ 4 пусты);
 *   - drill-down — через next/link на frontend-маршруты;
 *   - цвета — парные токены (chip-{role}-bg + chip-{role}-fg).
 * ────────────────────────────────────────────────────────────────────── */

function UrgentItemsSection({
  items,
}: {
  items: DailyDigestUrgentItemDomain[];
}) {
  if (items.length === 0) return null;
  return (
    <section className="rounded border border-border-subtle bg-bg-surface p-4">
      <h2 className="mb-3 text-lg font-semibold text-fg-primary">
        Срочные пункты
      </h2>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={`${item.kind}-${item.id}`}>
            <Link
              href={item.link}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md p-2 text-sm hover:bg-bg-overlay"
            >
              <span className="flex items-center gap-2 text-fg-primary">
                <span aria-hidden className="text-fg-tertiary">
                  {urgentIcon(item.kind)}
                </span>
                <span>{item.title}</span>
              </span>
              <span
                className={`rounded px-2 py-0.5 text-[11px] ${
                  item.urgency === 'high'
                    ? 'bg-chip-danger-bg text-chip-danger-fg'
                    : 'bg-chip-warning-bg text-chip-warning-fg'
                }`}
              >
                {item.badge}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EventsTimelineSection({
  items,
}: {
  items: DailyDigestEventDomain[];
}) {
  if (items.length === 0) return null;
  return (
    <section className="rounded border border-border-subtle bg-bg-surface p-4">
      <h2 className="mb-3 text-lg font-semibold text-fg-primary">
        Что произошло вчера
      </h2>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={`${item.kind}-${item.id}`}>
            <Link
              href={item.link}
              className="flex flex-wrap items-center gap-2 rounded-md p-2 text-sm hover:bg-bg-overlay"
            >
              <span
                aria-hidden
                className="w-12 shrink-0 font-mono text-xs text-fg-tertiary tabular-nums"
              >
                {formatTimeRu(item.occurredAt)}
              </span>
              <span aria-hidden className="text-fg-tertiary">
                {eventIcon(item.kind)}
              </span>
              <span className="flex-1 text-fg-primary">{item.title}</span>
              {item.detail ? (
                <span className="rounded bg-bg-overlay px-2 py-0.5 text-[11px] text-fg-tertiary">
                  {item.detail}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function WhoShinedSection({
  items,
}: {
  items: DailyDigestPersonShinedDomain[];
}) {
  if (items.length === 0) return null;
  return (
    <section className="rounded border border-border-subtle bg-bg-surface p-4">
      <h2 className="mb-3 text-lg font-semibold text-fg-primary">
        Кто выделился позитивом
      </h2>
      <ul className="space-y-1">
        {items.map((p) => (
          <li key={`${p.reason}-${p.personId}`}>
            <Link
              href={p.link}
              className="flex flex-wrap items-center gap-2 rounded-md p-2 text-sm hover:bg-bg-overlay"
            >
              <span aria-hidden className="text-chip-success-fg">★</span>
              <span className="font-medium text-fg-primary">{p.personName}</span>
              <span className="rounded bg-chip-success-bg px-2 py-0.5 text-[11px] text-chip-success-fg">
                {shinedReasonLabel(p.reason)}
              </span>
              <span className="flex-1 truncate text-xs text-fg-secondary">
                {p.detail}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function WhoStruggledSection({
  items,
}: {
  items: DailyDigestPersonStruggledDomain[];
}) {
  if (items.length === 0) return null;
  return (
    <section className="rounded border border-border-subtle bg-bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-fg-primary">
          Кому нужна поддержка
        </h2>
        <span className="text-xs text-fg-tertiary">
          для разговора с глазу на глаз
        </span>
      </div>
      <ul className="space-y-1">
        {items.map((p) => (
          <li key={`${p.reason}-${p.personId}`}>
            <Link
              href={p.link}
              className="flex flex-wrap items-center gap-2 rounded-md p-2 text-sm hover:bg-bg-overlay"
            >
              <span aria-hidden className="text-chip-warning-fg">⚑</span>
              <span className="font-medium text-fg-primary">{p.personName}</span>
              <span className="rounded bg-chip-warning-bg px-2 py-0.5 text-[11px] text-chip-warning-fg">
                {struggledReasonLabel(p.reason)}
              </span>
              <span className="flex-1 truncate text-xs text-fg-secondary">
                {p.detail}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function urgentIcon(kind: DailyDigestUrgentItemDomain['kind']): string {
  switch (kind) {
    case 'overdue_commitment':
      return '⏰';
    case 'raised_decision':
      return '↑';
    case 'high_insight':
      return '!';
    default:
      return '·';
  }
}

function eventIcon(kind: DailyDigestEventDomain['kind']): string {
  switch (kind) {
    case 'meeting':
      return '◉';
    case 'decision':
      return '✓';
    case 'signal':
      return '△';
    default:
      return '·';
  }
}

function shinedReasonLabel(
  reason: DailyDigestPersonShinedDomain['reason'],
): string {
  switch (reason) {
    case 'recognition_received':
      return 'получил признание';
    case 'helpful_acts':
      return 'помог коллегам';
    case 'commitments_kept':
      return 'сдержал обещания';
    default:
      return reason;
  }
}

function struggledReasonLabel(
  reason: DailyDigestPersonStruggledDomain['reason'],
): string {
  switch (reason) {
    case 'red_checkin':
      return 'красный чек-ин';
    case 'broken_commitment':
      return 'не выполнено обещание';
    case 'silent_3_days':
      return 'молчит 3 дня';
    default:
      return reason;
  }
}

function formatTimeRu(iso: string): string {
  // ISO → HH:MM в МСК. Безопасно: если строка кривая, отдаём пустоту.
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  return t.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Moscow',
  });
}
