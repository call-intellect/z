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
  type DailyDigestTrendPointApi,
} from '@/api/operations-daily-digest.api';
import { useAuth } from '@/contexts/auth-context';
import {
  CHRONIC_BLOCKER_STATUS_LABEL,
  fromDailyDigestApi,
  type DailyDigestChronicBlockerDomain,
  type DailyDigestDomain,
  type DailyDigestEventDomain,
  type DailyDigestPersonShinedDomain,
  type DailyDigestPersonStruggledDomain,
  type DailyDigestUrgentItemDomain,
} from '@/domain/operations-daily-digest';
import {
  AlarmClock,
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  FileText,
  Flag,
  Gauge,
  Sparkles,
  Star,
  ThermometerSun,
  TrendingUp,
} from 'lucide-react';

import {
  AreaTrend,
  CardTitle,
  CHART,
  DonutCard,
  GlassCard,
  glass,
  GRAD,
  ModernPageShell,
  StatCard,
} from '@/ui/components/dashboard/modern';
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
    <ModernPageShell
      title="Ежедневный отчёт"
      subtitle="Сводка за сутки в МСК: температура команды, новые блокеры, просроченные обещания, цели, сигналы. Генерируется автоматически каждый день в 01:00 МСК."
    >
      {/* §5.1 — Общая навигация по операционному разделу. */}
      <OperationsTabs />

      {/* Стеклянная панель навигации по датам + кнопка перегенерации. */}
      <div
        style={glass({ borderRadius: 18 })}
        className="mb-6 flex flex-wrap items-center gap-3 p-3"
      >
        <button
          type="button"
          onClick={() => goToDate(prevDate)}
          className="rounded-xl px-3 py-1.5 text-sm transition-colors hover:bg-[var(--surface-hover)]"
          style={{ border: '1px solid var(--border-inset)', color: CHART.text }}
        >
          ← Предыдущий день
        </button>
        <label
          className="flex items-center gap-2 text-sm"
          style={{ color: CHART.dim }}
        >
          <span>Дата:</span>
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => goToDate(e.target.value)}
            className="rounded-xl bg-transparent px-2 py-1 text-sm"
            style={{ border: '1px solid var(--border-inset)', color: CHART.text }}
          />
        </label>
        <button
          type="button"
          onClick={() => goToDate(nextDate)}
          disabled={nextDisabled}
          className="rounded-xl px-3 py-1.5 text-sm transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-50"
          style={{ border: '1px solid var(--border-inset)', color: CHART.text }}
        >
          Следующий день →
        </button>
        {canRegenerate ? (
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={generating}
            className="ml-auto rounded-xl px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: GRAD.violet, color: CHART.text }}
            title="Принудительно пересобрать отчёт (admin / super_admin)"
          >
            {generating ? 'Пересобираем…' : 'Перегенерировать'}
          </button>
        ) : null}
      </div>

      {generateError ? (
        <div
          style={glass({ borderRadius: 18 })}
          className="mb-6 p-3 text-sm"
        >
          <span style={{ color: CHART.red }}>{generateError}</span>
        </div>
      ) : null}

      {swr.isLoading ? (
        <GlassCard>
          <p className="text-sm" style={{ color: CHART.dim }}>
            Загрузка отчёта…
          </p>
        </GlassCard>
      ) : errorMessage ? (
        <GlassCard>
          <p className="text-sm" style={{ color: CHART.amber }}>
            {errorMessage}
          </p>
        </GlassCard>
      ) : domain ? (
        <DigestView data={domain} rawApi={swr.data!} />
      ) : (
        <EmptyState date={date} />
      )}
    </ModernPageShell>
  );
}

function EmptyState({ date }: { date: string }) {
  return (
    <GlassCard className="text-center">
      <p className="text-sm" style={{ color: CHART.dim }}>
        Отчёт за {formatRu(date)} ещё не сгенерирован.
      </p>
      <p className="mt-1 text-xs" style={{ color: CHART.faint }}>
        Автоматическая генерация — каждый день в 01:00 МСК. Если день уже
        прошёл, можно «Перегенерировать» вручную (admin / super_admin).
      </p>
    </GlassCard>
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
    data.whoStruggled.length === 0 &&
    data.chronicBlockers.length === 0;

  return (
    <div className="space-y-6">
      {data.shortSummary ? (
        <GlassCard>
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <h2
              className="text-xs uppercase tracking-wide"
              style={{ color: CHART.faint }}
            >
              Короткая выжимка
            </h2>
            {undelivered ? (
              <span
                className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{
                  color: CHART.amber,
                  background: 'oklch(0.84 0.16 80 / 0.14)',
                }}
              >
                Не доставлено в Telegram
              </span>
            ) : null}
          </div>
          <p className="text-sm" style={{ color: CHART.text }}>
            {data.shortSummary}
          </p>
        </GlassCard>
      ) : null}

      {/* Ф5 — hero-тренд из digest.trend (Ф1b): настроение и нагрузка по дням. */}
      <HeroTrend trend={data.trend} />

      {/* Pulse Wave 2 §2.1 — приоритет вверху: срочное → события → люди. */}
      <UrgentItemsSection items={data.urgentItems} />
      <EventsTimelineSection items={data.eventsToday} />
      <WhoShinedSection items={data.whoShined} />
      <WhoStruggledSection items={data.whoStruggled} />
      <ChronicBlockersSection items={data.chronicBlockers} />

      {allRuntimeEmpty ? (
        <GlassCard className="text-center">
          <p className="text-sm" style={{ color: CHART.dim }}>
            Вчера было спокойно: ни срочных пунктов, ни заметных событий,
            ни просевших сотрудников.
          </p>
        </GlassCard>
      ) : null}

      {/* Температура команды — пончик зелёный/жёлтый/красный, центр = всего чек-инов. */}
      {m.totalCheckIns === 0 ? (
        <GlassCard>
          <CardTitle icon={<ThermometerSun size={16} />} grad={GRAD.teal}>
            Температура команды
          </CardTitle>
          <p className="mt-3 text-sm" style={{ color: CHART.dim }}>
            За {formatRu(data.dateLocal)} нет чек-инов с настроением.
          </p>
        </GlassCard>
      ) : (
        <DonutCard
          title="Температура команды"
          icon={<ThermometerSun size={16} />}
          grad={GRAD.teal}
          data={[
            { name: `Зелёные ${pct(m.greenShare)}`, value: m.greenShare, c: CHART.mint },
            { name: `Жёлтые ${pct(m.yellowShare)}`, value: m.yellowShare, c: CHART.amber },
            { name: `Красные ${pct(m.redShare)}`, value: m.redShare, c: CHART.red },
          ]}
          centerValue={String(m.totalCheckIns)}
          centerLabel="чек-инов"
        />
      )}

      {/* §5.3/§5.4 — Hero-strip главных метрик дня (StatCard-ряд без спарклайнов —
          у этих KPI нет временных рядов, не выдумываем). */}
      <div>
        <h2
          className="mb-3 text-xs uppercase tracking-widest"
          style={{ color: CHART.faint }}
        >
          Главное за день
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard
            icon={<AlertTriangle size={20} />}
            grad={GRAD.amber}
            label="Новые блокеры"
            value={String(m.newBlockers.length)}
            tone={CHART.red}
          />
          <StatCard
            icon={<AlarmClock size={20} />}
            grad={GRAD.amber}
            label="Просроченные обещания"
            value={String(m.overdueCommitments.length)}
            tone={CHART.amber}
          />
          <StatCard
            icon={<CheckCircle2 size={20} />}
            grad={GRAD.teal}
            label="Цели закрыты"
            value={String(m.goals.completed)}
            tone={CHART.mint}
          />
          <StatCard
            icon={<Flag size={20} />}
            grad={GRAD.pink}
            label="Цели провалены"
            value={String(m.goals.failed)}
            tone={CHART.red}
          />
          <StatCard
            icon={<Sparkles size={20} />}
            grad={GRAD.violet}
            label="Новые сигналы"
            value={String(m.newHighInsights.length)}
            tone={CHART.violet}
          />
          <StatCard
            icon={<Gauge size={20} />}
            grad={GRAD.blue}
            label="Решения"
            value={String(m.decisions.length)}
            tone={CHART.blue}
          />
        </div>
      </div>

      {m.newBlockers.length > 0 ? (
        <GlassCard>
          <CardTitle icon={<AlertTriangle size={16} />} grad={GRAD.amber}>
            Новые блокеры
          </CardTitle>
          <ul className="mt-3 space-y-1 text-sm">
            {m.newBlockers.map((b) => (
              <li
                key={b.blockId}
                className="flex items-start gap-2 rounded-md p-2"
                style={{ color: CHART.text }}
              >
                <span style={{ color: CHART.faint }}>·</span>
                <span className="flex-1">{b.name}</span>
                <span className="text-xs" style={{ color: CHART.faint }}>
                  уверенность {Math.round(b.confidence * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </GlassCard>
      ) : null}

      {m.overdueCommitments.length > 0 ? (
        <GlassCard>
          <CardTitle icon={<AlarmClock size={16} />} grad={GRAD.amber}>
            Просроченные обещания
          </CardTitle>
          <ul className="mt-3 space-y-1 text-sm">
            {m.overdueCommitments.map((c) => (
              <li
                key={c.blockId}
                className="flex items-start gap-2 rounded-md p-2"
                style={{ color: CHART.text }}
              >
                <span style={{ color: CHART.faint }}>·</span>
                <span className="flex-1">{c.name}</span>
                {c.dueDate ? (
                  <span className="text-xs" style={{ color: CHART.faint }}>
                    срок {formatRu(c.dueDate.slice(0, 10))}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </GlassCard>
      ) : null}

      {m.topRedCheckIns.length > 0 ? (
        <GlassCard>
          <CardTitle icon={<AlertTriangle size={16} />} grad={GRAD.pink}>
            Красные чек-ины
          </CardTitle>
          <ul className="mt-3 space-y-2 text-sm">
            {m.topRedCheckIns.map((r) => (
              <li
                key={r.checkInId}
                className="rounded-xl p-2.5"
                style={{ background: 'var(--surface-inset)' }}
              >
                <div className="text-xs" style={{ color: CHART.faint }}>
                  {r.personName ?? 'без имени'}
                </div>
                <div style={{ color: CHART.text }}>{r.excerpt}</div>
              </li>
            ))}
          </ul>
        </GlassCard>
      ) : null}

      {/* Полный отчёт — markdown внутри стеклянной карточки. */}
      <GlassCard>
        <CardTitle icon={<FileText size={16} />} grad={GRAD.blue}>
          Полный отчёт
        </CardTitle>
        <div className="prose prose-sm prose-invert mt-3 max-w-none text-fg-primary [&>*]:my-2">
          <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
            {data.bodyMarkdown}
          </ReactMarkdown>
        </div>
      </GlassCard>

      <p className="text-xs" style={{ color: CHART.faint }}>
        Сгенерировано{' '}
        {data.createdAt.toLocaleString('ru-RU')}
        {data.deliveredAt
          ? ` · доставлено в Telegram ${data.deliveredAt.toLocaleString('ru-RU')}`
          : ''}
      </p>
    </div>
  );
}

/**
 * Ф5 — hero-тренд из digest.trend (Ф1b): два area-графика за последние дни.
 * При <2 точек — стеклянная заглушка вместо пустого графика.
 */
function HeroTrend({ trend }: { trend: DailyDigestTrendPointApi[] }) {
  if (trend.length < 2) {
    return (
      <GlassCard>
        <CardTitle icon={<TrendingUp size={16} />} grad={GRAD.violet}>
          Динамика по дням
        </CardTitle>
        <p className="mt-3 text-sm" style={{ color: CHART.dim }}>
          Тренд появится за несколько дней.
        </p>
      </GlassCard>
    );
  }
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <AreaTrend
        title="Настроение по дням"
        titleIcon={<ThermometerSun size={16} />}
        titleGrad={GRAD.teal}
        data={trend as unknown as Record<string, unknown>[]}
        xKey="dateLocal"
        height={220}
        series={[
          { key: 'greenShare', color: CHART.mint, label: 'Зелёные' },
          { key: 'redShare', color: CHART.red, label: 'Красные' },
        ]}
      />
      <AreaTrend
        title="Нагрузка по дням"
        titleIcon={<TrendingUp size={16} />}
        titleGrad={GRAD.amber}
        data={trend as unknown as Record<string, unknown>[]}
        xKey="dateLocal"
        height={220}
        series={[
          { key: 'blockers', color: CHART.amber, label: 'Блокеры' },
          {
            key: 'overdueCommitments',
            color: CHART.pink,
            label: 'Просроченные обещания',
          },
        ]}
      />
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
    <GlassCard>
      <CardTitle icon={<AlertTriangle size={16} />} grad={GRAD.pink}>
        Срочные пункты
      </CardTitle>
      <ul className="mt-3 space-y-1">
        {items.map((item) => (
          <li key={`${item.kind}-${item.id}`}>
            <Link
              href={item.link}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md p-2 text-sm hover:bg-[var(--surface-hover)]"
            >
              <span className="flex items-center gap-2" style={{ color: CHART.text }}>
                <span aria-hidden style={{ color: CHART.faint }}>
                  {urgentIcon(item.kind)}
                </span>
                <span>{item.title}</span>
              </span>
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={
                  item.urgency === 'high'
                    ? { color: CHART.red, background: 'oklch(0.66 0.22 25 / 0.16)' }
                    : { color: CHART.amber, background: 'oklch(0.84 0.16 80 / 0.14)' }
                }
              >
                {item.badge}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </GlassCard>
  );
}

function EventsTimelineSection({
  items,
}: {
  items: DailyDigestEventDomain[];
}) {
  if (items.length === 0) return null;
  return (
    <GlassCard>
      <CardTitle icon={<CalendarDays size={16} />} grad={GRAD.blue}>
        Что произошло вчера
      </CardTitle>
      <ul className="mt-3 space-y-1">
        {items.map((item) => (
          <li key={`${item.kind}-${item.id}`}>
            <Link
              href={item.link}
              className="flex flex-wrap items-center gap-2 rounded-md p-2 text-sm hover:bg-[var(--surface-hover)]"
            >
              <span
                aria-hidden
                className="w-12 shrink-0 font-mono text-xs tabular-nums"
                style={{ color: CHART.faint }}
              >
                {formatTimeRu(item.occurredAt)}
              </span>
              <span aria-hidden style={{ color: CHART.faint }}>
                {eventIcon(item.kind)}
              </span>
              <span className="flex-1" style={{ color: CHART.text }}>
                {item.title}
              </span>
              {item.detail ? (
                <span
                  className="rounded-full px-2 py-0.5 text-[11px]"
                  style={{ color: CHART.faint, background: 'var(--surface-inset)' }}
                >
                  {item.detail}
                </span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </GlassCard>
  );
}

function WhoShinedSection({
  items,
}: {
  items: DailyDigestPersonShinedDomain[];
}) {
  if (items.length === 0) return null;
  return (
    <GlassCard>
      <CardTitle icon={<Star size={16} />} grad={GRAD.teal}>
        Кто выделился позитивом
      </CardTitle>
      <ul className="mt-3 space-y-1">
        {items.map((p) => (
          <li key={`${p.reason}-${p.personId}`}>
            <Link
              href={p.link}
              className="flex flex-wrap items-center gap-2 rounded-md p-2 text-sm hover:bg-[var(--surface-hover)]"
            >
              <span aria-hidden style={{ color: CHART.mint }}>★</span>
              <span className="font-medium" style={{ color: CHART.text }}>
                {p.personName}
              </span>
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{ color: CHART.mint, background: 'oklch(0.85 0.15 165 / 0.14)' }}
              >
                {shinedReasonLabel(p.reason)}
              </span>
              <span className="flex-1 truncate text-xs" style={{ color: CHART.dim }}>
                {p.detail}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </GlassCard>
  );
}

function WhoStruggledSection({
  items,
}: {
  items: DailyDigestPersonStruggledDomain[];
}) {
  if (items.length === 0) return null;
  return (
    <GlassCard>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <CardTitle icon={<Flag size={16} />} grad={GRAD.amber}>
          Кому нужна поддержка
        </CardTitle>
        <span className="text-xs" style={{ color: CHART.faint }}>
          для разговора с глазу на глаз
        </span>
      </div>
      <ul className="space-y-1">
        {items.map((p) => (
          <li key={`${p.reason}-${p.personId}`}>
            <Link
              href={p.link}
              className="flex flex-wrap items-center gap-2 rounded-md p-2 text-sm hover:bg-[var(--surface-hover)]"
            >
              <span aria-hidden style={{ color: CHART.amber }}>⚑</span>
              <span className="font-medium" style={{ color: CHART.text }}>
                {p.personName}
              </span>
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{ color: CHART.amber, background: 'oklch(0.84 0.16 80 / 0.14)' }}
              >
                {struggledReasonLabel(p.reason)}
              </span>
              <span className="flex-1 truncate text-xs" style={{ color: CHART.dim }}>
                {p.detail}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </GlassCard>
  );
}

function ChronicBlockersSection({
  items,
}: {
  items: DailyDigestChronicBlockerDomain[];
}) {
  if (items.length === 0) return null;
  return (
    <GlassCard>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-fg-primary">
          Хронические блокеры
        </h2>
        <span className="text-xs text-fg-tertiary">
          повторяются изо дня в день
        </span>
      </div>
      <ul className="space-y-2">
        {items.map((b) => (
          <li
            key={b.id}
            className="flex flex-wrap items-center gap-2 rounded-md p-2 text-sm"
          >
            <span aria-hidden className="text-chip-danger-fg">
              ⚠
            </span>
            <span className="flex-1 text-fg-primary">{b.representativeText}</span>
            <span
              className={`rounded px-2 py-0.5 text-[11px] ${chronicStatusChipClass(
                b.status,
              )}`}
            >
              {CHRONIC_BLOCKER_STATUS_LABEL[b.status]}
            </span>
            <span className="text-xs text-fg-tertiary">
              {b.daysOpen} дн. открыт
            </span>
            {b.linkedInsightId ? (
              <Link
                href={`/insights/${b.linkedInsightId}`}
                className="rounded border border-border-subtle px-2 py-0.5 text-xs text-fg-secondary hover:bg-bg-overlay"
              >
                Причина: повторяющийся сигнал
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </GlassCard>
  );
}

function chronicStatusChipClass(
  status: DailyDigestChronicBlockerDomain['status'],
): string {
  switch (status) {
    case 'new':
      return 'bg-chip-warning-bg text-chip-warning-fg';
    case 'recurring':
      return 'bg-chip-danger-bg text-chip-danger-fg';
    case 'resolved':
      return 'bg-chip-success-bg text-chip-success-fg';
    default:
      return 'bg-bg-overlay text-fg-secondary';
  }
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
