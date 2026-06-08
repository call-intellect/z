'use client';

import Link from 'next/link';
import { useState } from 'react';
import useSWR from 'swr';

import { ApiError } from '@/api/api-error';
import { commitmentsApi, type OpenCommitmentsListApi } from '@/api/commitments.api';
import {
  operationsDashboardApi,
  type OperationsMissingCheckInsApi,
  type OperationsStaleIssuesApi,
  type OperationsTeamTemperatureApi,
  type OperationsTeamTemperatureSummaryApi,
} from '@/api/operations-dashboard.api';
import {
  fromOperationsOverviewApi,
  type OperationsOverviewDomain,
} from '@/domain/operations-dashboard';
import { useAuth } from '@/contexts/auth-context';
import { ActivityFeedWidget } from '@/ui/components/dashboard/ActivityFeedWidget';
import { MODERN_PAGE_BG } from '@/ui/components/dashboard/modern';
import { OperationsTabs } from '@/ui/components/dashboard/OperationsTabs';
import { RequiresActionBanner } from '@/ui/components/dashboard/RequiresActionBanner';
import { TeamTemperatureHeatmap } from '@/ui/components/operations/TeamTemperatureHeatmap';
import { KpiHero } from '@/ui/components/shared/KpiHero';
import { InsightsTopWidget } from '../widgets/InsightsTopWidget';
import { CauseCategoryMapWidget } from './widgets/CauseCategoryMapWidget';
import { ChronicBlockersWidget } from './widgets/ChronicBlockersWidget';
import { MaturityWidget } from './widgets/MaturityWidget';
import { TeamCapacityWidget } from './widgets/TeamCapacityWidget';

/**
 * SBA β-8 — клиентский COO-дашборд.
 *
 * Показывает агрегат `/api/v1/dashboard/operations/overview`:
 *   - кол-во активных блокеров (с разбивкой по severity);
 *   - missed goals + cascade-missed;
 *   - team friction count;
 *   - средний % загрузки + перегруженные сотрудники;
 *   - топ-5 свежих блокеров / team frictions.
 *
 * Без Recharts (пакет не подключён к проекту) — простой grid из «карточек».
 * Для визуализации severity используем CSS-плашки. Когда Recharts добавят
 * в `package.json` — переделаем на BarChart / PieChart.
 */
export function OperationsDashboardClient() {
  const { currentOrgId } = useAuth();

  // R2 — overview и open-commitments через SWR (раньше императивная загрузка
  // через Promise.all). Каждый запрос независим: провал commitments не валит
  // overview.
  const overviewSwr = useSWR(
    ['operations-overview'],
    () => operationsDashboardApi.getOverview(),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const commitmentsSwr = useSWR(
    ['operations-open-commitments', 14, 100],
    () => commitmentsApi.listOpen({ days: 14, limit: 100 }).catch(() => null),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const data: OperationsOverviewDomain | null = overviewSwr.data
    ? fromOperationsOverviewApi(overviewSwr.data)
    : null;
  const commitments: OpenCommitmentsListApi | null = commitmentsSwr.data ?? null;
  const loading = overviewSwr.isLoading;
  // Сохраняем спец-обработку forbidden → понятный текст про роль.
  const error = (() => {
    const err = overviewSwr.error;
    if (!err) return null;
    if (err instanceof ApiError && err.code === 'forbidden') {
      return 'Нет доступа к COO-дашборду (нужна роль coo / admin / owner).';
    }
    return err instanceof Error ? err.message : 'Не удалось загрузить дашборд';
  })();

  // Pulse Wave 2.3 — данные для расширенных виджетов. Каждый — независимый
  // SWR, чтобы провал одного не валил весь дашборд.
  const temperatureSwr = useSWR(
    ['operations-team-temperature', 7],
    async () => operationsDashboardApi.getTeamTemperature(7),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const missingCheckInsSwr = useSWR(
    ['operations-missing-checkins'],
    async () => operationsDashboardApi.getMissingCheckIns(),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const staleIssuesSwr = useSWR(
    ['operations-stale-issues', 5, 20],
    async () => operationsDashboardApi.getStaleIssues({ staleDays: 5, limit: 20 }),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  if (loading) {
    return <div className="p-6 text-sm text-fg-secondary">Загрузка дашборда…</div>;
  }
  if (error) {
    return (
      <div className="p-6">
        <h1 className="mb-2 text-2xl font-semibold">Операции</h1>
        <p className="rounded border border-chip-danger-bg bg-chip-danger-bg p-4 text-sm text-chip-danger-fg">
          {error}
        </p>
      </div>
    );
  }
  if (!data) {
    return <div className="p-6 text-sm text-fg-secondary">Нет данных</div>;
  }

  // ТЗ-2 Ф2 — инфо-перекомпоновка под kill-switch (default true). При OFF
  // дашборд возвращается к легаси-раскладке («Свежие блокеры», без новых
  // виджетов).
  const reworkEnabled = data.reworkEnabled;
  // ТЗ-2 Ф2 — «доменов посчитано N»: явного поля в снапшоте нет, считаем
  // distinct-домены по slug среди сильных+слабых (лучшее доступное приближение).
  const maturityDomainCount = new Set(
    [...data.maturity.weakestDomains, ...data.maturity.topDomains].map(
      (d) => d.slug,
    ),
  ).size;

  return (
    <div style={{ background: MODERN_PAGE_BG, minHeight: '100vh' }}>
      <div className="p-6">
      {/* §5.2 — Sticky-header c backdrop-blur и тонким border. */}
      <header className="sticky top-0 z-20 -mx-6 mb-6 border-b border-border-subtle/50 bg-bg-base/85 px-6 py-3 backdrop-blur-md">
        <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
          Операции — пульс компании
        </h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Обновлено {data.generatedAt.toLocaleString('ru-RU')}
        </p>
      </header>

      {/* §5.1 — Общая навигация по операционному разделу. */}
      <OperationsTabs />

      {/* Action Center B2 — баннер «Требует подтверждения». Скрыт при total=0. */}
      <div className="mb-4">
        <RequiresActionBanner orgId={currentOrgId} />
      </div>

      {/* §5.3/§5.4 — KPI разбиты на смысловые зоны (R1). Карточки — KpiHero
          c threshold-тоном вместо локального Card. Временных рядов в
          overview-API нет — sparkline не выдумываем. */}
      <div className="mt-6 grid grid-cols-1 gap-6 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300 motion-safe:fill-mode-backwards lg:grid-cols-3">
        {/* Зона «Люди» — кто в команде под нагрузкой/в конфликте. */}
        <section className="lg:col-span-1">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-fg-tertiary">
            Люди
          </h2>
          <KpiHero
            label="Конфликты в команде"
            value={data.teamFrictionCount}
            numericValue={data.teamFrictionCount}
            threshold={{ green: 0, yellow: 3, inverted: true }}
          />
          {reworkEnabled ? (
            <p className="mt-1.5 text-xs text-fg-tertiary">
              закрыто: {data.frictionsResolvedCount}
            </p>
          ) : null}
        </section>

        {/* Зона «Исполнение» — блокеры, цели, загрузка. */}
        <section className="lg:col-span-2">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-fg-tertiary">
            Исполнение
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <KpiHero
                label="Активные блокеры"
                value={data.blockersCount}
                numericValue={data.blockersCount}
                threshold={{ green: 0, yellow: 5, inverted: true }}
                href="/dashboard/operations/weekly"
              />
              {reworkEnabled ? (
                <p className="mt-1.5 text-xs text-fg-tertiary">
                  закрыто за 30 дней: {data.blockersResolvedCount}
                </p>
              ) : null}
            </div>
            <KpiHero
              label="Провалившиеся цели"
              value={data.missedGoalsCount}
              numericValue={data.missedGoalsCount}
              threshold={{ green: 0, yellow: 2, inverted: true }}
            />
            {commitments === null ? (
              // Запрос упал — нейтральный KPI без threshold-тона, экран не падает.
              <KpiHero
                label="Открытые обещания"
                value={0}
                numericValue={0}
              />
            ) : (
              <KpiHero
                label="Открытые обещания"
                value={commitments.total}
                numericValue={commitments.total}
                threshold={{ green: 5, yellow: 15, inverted: true }}
                href="/dashboard/operations/weekly"
              />
            )}
          </div>
        </section>
      </div>

      <TeamTemperatureSection
        summary={data.teamTemperature}
        heatmapLoading={temperatureSwr.isLoading}
        heatmapError={
          temperatureSwr.error instanceof Error
            ? temperatureSwr.error.message
            : null
        }
        heatmap={temperatureSwr.data ?? null}
      />

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <MissingCheckInsCard
          loading={missingCheckInsSwr.isLoading}
          error={
            missingCheckInsSwr.error instanceof Error
              ? missingCheckInsSwr.error.message
              : null
          }
          data={missingCheckInsSwr.data ?? null}
        />
        <StaleIssuesCard
          loading={staleIssuesSwr.isLoading}
          error={
            staleIssuesSwr.error instanceof Error
              ? staleIssuesSwr.error.message
              : null
          }
          data={staleIssuesSwr.data ?? null}
        />
      </div>

      {/* ТЗ-3 Ф2 — «Загрузка команд». Заменяет «мёртвый» средний % загрузки,
          который раньше не рендерился вовсе. Только при включённой
          перекомпоновке (kill-switch). */}
      {reworkEnabled ? (
        <div className="mt-6">
          <TeamCapacityWidget />
        </div>
      ) : null}

      <div className="mt-6">
        <ActivityFeedWidget
          feedTypes={['probe_question']}
          scope="company"
          pageSize={10}
          title="Вопросы Коры команде"
        />
      </div>

      {/* Зона «Сигналы» — зрелость данных + карта первопричин (R1). */}
      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">
            Сигналы
          </h2>
          {/* ТЗ-2 Ф2 — «оценка» + знаменатель «(доменов посчитано N)».
              Явного поля count в снапшоте нет → N = distinct-домены по slug
              среди сильных+слабых. */}
          {data.maturity.score !== null ? (
            <span className="rounded-full bg-bg-subtle px-2 py-0.5 text-[10px] font-medium text-fg-secondary">
              оценка
              {maturityDomainCount > 0
                ? ` (доменов посчитано ${maturityDomainCount})`
                : ''}
            </span>
          ) : null}
        </div>
        <div className="space-y-6">
          <MaturityWidget maturity={data.maturity} />
          <CauseCategoryMapWidget
            insightsByCauseCategory={data.insightsByCauseCategory}
          />
          {reworkEnabled ? <InsightsTopWidget /> : null}
        </div>
      </section>

      {commitments ? <OpenCommitmentsWidget data={commitments} /> : null}

      {reworkEnabled ? (
        // ТЗ-2 Ф2 — «Свежие блокеры» заменены на «Хронические блокеры».
        <div className="mt-8">
          <ChronicBlockersWidget />
        </div>
      ) : (
        // Легаси-раскладка (kill-switch OFF): прежний блок «Свежие блокеры».
        <section className="mt-8">
          <h2 className="mb-3 text-lg font-semibold">Свежие блокеры</h2>
          {data.topRecentBlockers.length === 0 ? (
            <p className="text-sm text-fg-secondary">
              Сейчас активных блокеров нет.
            </p>
          ) : (
            <ul className="divide-y rounded border bg-bg-card">
              {data.topRecentBlockers.map((b) => (
                <li key={b.id} className="p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex-1">{b.text}</span>
                    <SeverityBadge severity={b.severity} />
                  </div>
                  <div className="mt-1 text-xs text-fg-secondary">
                    {b.ownerPersonName ?? 'без владельца'} ·{' '}
                    {new Date(b.createdAt).toLocaleString('ru-RU')}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Свежие конфликты</h2>
        {data.topRecentTeamFrictions.length === 0 ? (
          <p className="text-sm text-fg-secondary">
            На текущий момент конфликтов в команде не зафиксировано.
          </p>
        ) : (
          <ul className="divide-y rounded border bg-bg-card">
            {data.topRecentTeamFrictions.map((f) => (
              <li key={f.id} className="p-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-2">
                  <strong>{f.fromPersonName ?? 'неизвестный'}</strong>
                  <span className="text-fg-tertiary">↔</span>
                  <strong>{f.toPersonName ?? 'неизвестный'}</strong>
                  <span className="text-xs text-fg-secondary">
                    ({Math.round(f.confidence * 100)}% уверенности)
                  </span>
                </div>
                <p className="mt-1 text-xs text-fg-secondary">{f.explanation}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      </div>
    </div>
  );
}

/**
 * ТЗ-C Ф3 (R4) — единый блок «Температура команды» с переключателем
 * «Общая / По людям». Один визуальный `<section>` с общим заголовком; внутри —
 * либо `TeamTemperatureOverallBody` (полоса green/yellow/red), либо
 * `TeamTemperatureByPersonBody` (heatmap по людям). Каждый body сохраняет свои
 * empty/loading/error-состояния.
 */
function TeamTemperatureSection(props: {
  summary: OperationsTeamTemperatureSummaryApi;
  heatmapLoading: boolean;
  heatmapError: string | null;
  heatmap: OperationsTeamTemperatureApi | null;
}) {
  const [mode, setMode] = useState<'overall' | 'byPerson'>('overall');
  return (
    <section className="mt-8 rounded border bg-bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-fg-primary">
          Температура команды
        </h2>
        <div className="inline-flex gap-1 rounded-lg bg-bg-subtle p-1">
          <button
            type="button"
            onClick={() => setMode('overall')}
            aria-pressed={mode === 'overall'}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              mode === 'overall'
                ? 'bg-accent/15 text-accent-fg'
                : 'text-fg-secondary hover:bg-bg-subtle'
            }`}
          >
            Общая
          </button>
          <button
            type="button"
            onClick={() => setMode('byPerson')}
            aria-pressed={mode === 'byPerson'}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              mode === 'byPerson'
                ? 'bg-accent/15 text-accent-fg'
                : 'text-fg-secondary hover:bg-bg-subtle'
            }`}
          >
            По людям
          </button>
        </div>
      </div>
      {mode === 'overall' ? (
        <TeamTemperatureOverallBody summary={props.summary} />
      ) : (
        <TeamTemperatureByPersonBody
          loading={props.heatmapLoading}
          error={props.heatmapError}
          temperature={props.heatmap}
        />
      )}
    </section>
  );
}

/**
 * ТЗ-C Ф3 — режим «Общая»: полоса зелёный/жёлтый/красный + легенда.
 * Без собственного `<section>`/заголовка — они общие в `TeamTemperatureSection`.
 * Empty-state при нуле чек-инов сохранён.
 */
function TeamTemperatureOverallBody(props: {
  summary: OperationsTeamTemperatureSummaryApi;
}) {
  const s = props.summary;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const greenW = Math.round(s.greenShare * 100);
  const yellowW = Math.round(s.yellowShare * 100);
  const redW = Math.round(s.redShare * 100);

  const deltaLabel = (() => {
    if (s.redShareDelta == null) return null;
    const delta = Math.round(s.redShareDelta * 100);
    if (delta === 0) return 'без изменений';
    if (delta > 0) return `красных +${delta}% к прошлой неделе`;
    return `красных ${delta}% к прошлой неделе`;
  })();

  if (s.totalCheckIns === 0) {
    return (
      <p className="text-sm text-fg-secondary">
        За последние {s.days} дней нет чек-инов с проанализированным
        настроением. Когда сотрудники начнут отвечать на вечерние чек-ины —
        здесь появится распределение зелёный / жёлтый / красный.
      </p>
    );
  }

  return (
    <>
      <p className="text-sm text-fg-secondary">
        Последние {s.days} дн. · всего чек-инов: {s.totalCheckIns}
        {deltaLabel ? `; ${deltaLabel}.` : '.'}
      </p>
      <div className="mt-3 flex h-6 overflow-hidden rounded border">
        {greenW > 0 ? (
          <div
            className="bg-success"
            style={{ width: `${greenW}%` }}
            title={`зелёных ${pct(s.greenShare)}`}
          />
        ) : null}
        {yellowW > 0 ? (
          <div
            className="bg-warning"
            style={{ width: `${yellowW}%` }}
            title={`жёлтых ${pct(s.yellowShare)}`}
          />
        ) : null}
        {redW > 0 ? (
          <div
            className="bg-danger"
            style={{ width: `${redW}%` }}
            title={`красных ${pct(s.redShare)}`}
          />
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-3 text-xs text-fg-secondary">
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-success" />
            зелёных {pct(s.greenShare)}
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-warning" />
            жёлтых {pct(s.yellowShare)}
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-danger" />
            красных {pct(s.redShare)}
          </span>
        </div>
        <Link
          href="/dashboard/operations/weekly"
          className="text-xs text-info hover:underline"
        >
          Открыть недельную сводку →
        </Link>
      </div>
    </>
  );
}

function OpenCommitmentsWidget(props: { data: OpenCommitmentsListApi }) {
  const { items, total } = props.data;
  // Группируем по автору, чтобы COO видел «кто сколько висит».
  const groups = new Map<string, OpenCommitmentsListApi['items']>();
  for (const c of items) {
    const key = c.authorPersonName ?? 'без автора';
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }
  const groupList = Array.from(groups.entries()).sort(
    (a, b) => b[1].length - a[1].length,
  );
  return (
    <section className="mt-8 rounded border bg-bg-card p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold">
          Открытые обещания за 14 дней
        </h2>
        <span className="text-sm text-fg-secondary">всего: {total}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-fg-secondary">
          Висящих обещаний нет — все закрыты или сроки ещё не наступили.
        </p>
      ) : (
        <ul className="divide-y">
          {groupList.map(([author, list]) => (
            <li key={author} className="py-2">
              <div className="text-sm font-medium">
                {author}
                <span className="ml-2 text-xs text-fg-secondary">
                  ({list.length})
                </span>
              </div>
              <ul className="mt-1 ml-3 list-disc text-xs text-fg-secondary">
                {list.slice(0, 5).map((c) => (
                  <li key={c.id} className="py-0.5">
                    {c.text}
                    {c.dueDate ? (
                      <span className="ml-1 text-fg-tertiary">
                        (срок {new Date(c.dueDate).toLocaleDateString('ru-RU')})
                      </span>
                    ) : null}
                    {c.escalatedAt ? (
                      <span className="ml-1 rounded bg-chip-danger-bg px-1.5 py-0.5 text-[10px] text-chip-danger-fg">
                        давно молчит
                      </span>
                    ) : c.askedAt ? (
                      <span className="ml-1 rounded bg-chip-warning-bg px-1.5 py-0.5 text-[10px] text-chip-warning-fg">
                        спросили
                      </span>
                    ) : null}
                  </li>
                ))}
                {list.length > 5 ? (
                  <li className="py-0.5 text-fg-tertiary">
                    …и ещё {list.length - 5}
                  </li>
                ) : null}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SeverityBadge(props: {
  severity: 'low' | 'medium' | 'high' | 'unknown';
}) {
  const label =
    props.severity === 'high'
      ? 'высокая'
      : props.severity === 'medium'
        ? 'средняя'
        : props.severity === 'low'
          ? 'низкая'
          : 'неизв.';
  const colour =
    props.severity === 'high'
      ? 'bg-chip-danger-bg text-chip-danger-fg'
      : props.severity === 'medium'
        ? 'bg-chip-warning-bg text-chip-warning-fg'
        : props.severity === 'low'
          ? 'bg-chip-info-bg text-chip-info-fg'
          : 'bg-bg-subtle text-fg-secondary';
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${colour}`}>
      {label}
    </span>
  );
}

/**
 * ТЗ-C Ф3 — режим «По людям»: heatmap из `TeamTemperatureHeatmap`.
 * Без собственного `<section>`/заголовка — они общие в `TeamTemperatureSection`.
 * Состояния loading/error/empty сохранены. `byPerson` уже отсортирован на бэке
 * по `red DESC`.
 */
function TeamTemperatureByPersonBody(props: {
  loading: boolean;
  error: string | null;
  temperature: OperationsTeamTemperatureApi | null;
}) {
  if (props.loading) {
    return <p className="text-sm text-fg-secondary">Загрузка…</p>;
  }
  if (props.error) {
    return <p className="text-sm text-chip-danger-fg">{props.error}</p>;
  }
  if (!props.temperature || props.temperature.byPerson.length === 0) {
    return (
      <p className="text-sm text-fg-tertiary">
        Чек-инов с проанализированным настроением пока нет.
      </p>
    );
  }
  return <TeamTemperatureHeatmap byPerson={props.temperature.byPerson} />;
}

/**
 * Pulse Wave 2.3 — карточка «Не отчитались сегодня».
 *
 * Backend сам резолвит дату по умолчанию (сегодня МСК). Empty state — все
 * отчитались или сотрудников нет. Показываем до 30 имён в списке.
 */
function MissingCheckInsCard(props: {
  loading: boolean;
  error: string | null;
  data: OperationsMissingCheckInsApi | null;
}) {
  return (
    <section className="rounded border bg-bg-card p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Не отчитались сегодня</h2>
        {props.data ? (
          <span className="text-xs text-fg-secondary">
            {props.data.missing.length} из {props.data.totalEmployees}
          </span>
        ) : null}
      </div>
      {props.loading ? (
        <p className="text-sm text-fg-secondary">Загрузка…</p>
      ) : props.error ? (
        <p className="text-sm text-chip-danger-fg">{props.error}</p>
      ) : !props.data || props.data.totalEmployees === 0 ? (
        <p className="text-sm text-fg-tertiary">
          В организации пока нет сотрудников.
        </p>
      ) : props.data.missing.length === 0 ? (
        <p className="text-sm text-chip-success-fg">
          Все сотрудники отчитались за {props.data.date}.
        </p>
      ) : (
        <ul className="space-y-1 text-sm">
          {props.data.missing.slice(0, 30).map((m) => (
            <li
              key={m.personId}
              className="rounded px-2 py-1 text-fg-primary hover:bg-bg-overlay/40"
            >
              {m.personName ?? 'Без имени'}
            </li>
          ))}
          {props.data.missing.length > 30 ? (
            <li className="px-2 py-1 text-xs text-fg-tertiary">
              …и ещё {props.data.missing.length - 30}
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}

/**
 * Pulse Wave 2.3 — карточка «Зависли задачи» (stale ИЛИ overdue).
 *
 * `daysOverdue` приоритетнее `daysSinceActivity` — показываем красную плашку
 * «просрочено на N дней». Если задача только зависла без просрочки — серая
 * плашка «без активности N дней».
 */
function StaleIssuesCard(props: {
  loading: boolean;
  error: string | null;
  data: OperationsStaleIssuesApi | null;
}) {
  return (
    <section className="rounded border bg-bg-card p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Зависли задачи</h2>
        {props.data ? (
          <span className="text-xs text-fg-secondary">
            всего: {props.data.items.length}
          </span>
        ) : null}
      </div>
      {props.loading ? (
        <p className="text-sm text-fg-secondary">Загрузка…</p>
      ) : props.error ? (
        <p className="text-sm text-chip-danger-fg">{props.error}</p>
      ) : !props.data || props.data.items.length === 0 ? (
        <p className="text-sm text-chip-success-fg">
          Зависших задач нет — все либо в работе, либо закрыты.
        </p>
      ) : (
        <ul className="divide-y">
          {props.data.items.slice(0, 20).map((it) => (
            <li key={it.issueId} className="py-2 text-sm">
              <div className="flex items-start justify-between gap-2">
                <Link
                  href={`/issues/${it.issueId}`}
                  className="flex-1 text-fg-primary hover:text-accent"
                >
                  <span className="mr-2 text-xs text-fg-tertiary">
                    {it.identifier}
                  </span>
                  {it.title}
                </Link>
                {it.daysOverdue !== null && it.daysOverdue > 0 ? (
                  <span className="shrink-0 rounded bg-chip-danger-bg px-1.5 py-0.5 text-[10px] text-chip-danger-fg">
                    просрочено {it.daysOverdue} дн.
                  </span>
                ) : (
                  <span className="shrink-0 rounded bg-bg-subtle px-1.5 py-0.5 text-[10px] text-fg-secondary">
                    без активности {it.daysSinceActivity} дн.
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
