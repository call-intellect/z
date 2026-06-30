"use client";

import {
  AlertTriangle,
  Target,
  Thermometer,
  UserX,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import useSWR from "swr";

import { ApiError } from "@/api/api-error";
import {
  operationsDashboardApi,
  type OperationsMissingCheckInsApi,
  type OperationsStaleIssuesApi,
  type OperationsTeamTemperatureApi,
  type OperationsTeamTemperatureSummaryApi,
} from "@/api/operations-dashboard.api";
import {
  fromOperationsOverviewApi,
  type OperationsOverviewDomain,
} from "@/domain/operations-dashboard";
import { useAuth } from "@/contexts/auth-context";
import { ActivityFeedWidget } from "@/ui/components/dashboard/ActivityFeedWidget";
import {
  AreaTrend,
  CardTitle,
  CHART,
  DonutCard,
  GlassCard,
  GRAD,
  kpiTone,
  MODERN_PAGE_BG,
  ModernPageShell,
  ModernTable,
  StatCard,
  StatusPill,
  type ModernTableColumn,
} from "@/ui/components/dashboard/modern";
import { OperationsTabs } from "@/ui/components/dashboard/OperationsTabs";
import { RequiresActionBanner } from "@/ui/components/dashboard/RequiresActionBanner";
import { TeamTemperatureHeatmap } from "@/ui/components/operations/TeamTemperatureHeatmap";
import { InsightsTopWidget } from "../widgets/InsightsTopWidget";
import { CauseCategoryMapWidget } from "./widgets/CauseCategoryMapWidget";
import { ChronicBlockersWidget } from "./widgets/ChronicBlockersWidget";
import { MaturityWidget } from "./widgets/MaturityWidget";
import { TeamCapacityWidget } from "./widgets/TeamCapacityWidget";
import { CustomerRiskRadarWidget } from "./widgets/CustomerRiskRadarWidget";
import { KnowledgeAtRiskWidget } from "./widgets/KnowledgeAtRiskWidget";
import { dashboardApi } from "@/api/dashboard.api";
import { pulsePatternsFromApi } from "@/domain/pulse-patterns";
import { BusFactorWidget } from "@/ui/components/dashboard/BusFactorWidget";
import { RecurringTopicsWidget } from "@/ui/components/dashboard/RecurringTopicsWidget";
import { LowRoiMeetingsWidget } from "@/ui/components/dashboard/LowRoiMeetingsWidget";
import { BottleneckHeatmapWidget } from "@/ui/components/dashboard/BottleneckHeatmapWidget";
import { KnowledgeVelocityKpi } from "@/ui/components/dashboard/KnowledgeVelocityKpi";

export function OperationsDashboardClient({
  embedded = false,
}: {
  embedded?: boolean;
} = {}) {
  const { currentOrgId } = useAuth();

  const overviewSwr = useSWR(
    ["operations-overview"],
    () => operationsDashboardApi.getOverview(),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const data: OperationsOverviewDomain | null = overviewSwr.data
    ? fromOperationsOverviewApi(overviewSwr.data)
    : null;
  const loading = overviewSwr.isLoading;
  const error = (() => {
    const err = overviewSwr.error;
    if (!err) return null;
    if (err instanceof ApiError && err.code === "forbidden") {
      return "Нет доступа к COO-дашборду (нужна роль coo / admin / owner).";
    }
    return err instanceof Error ? err.message : "Не удалось загрузить дашборд";
  })();

  const temperatureSwr = useSWR(
    ["operations-team-temperature", 7],
    async () => operationsDashboardApi.getTeamTemperature(7),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const missingCheckInsSwr = useSWR(
    ["operations-missing-checkins"],
    async () => operationsDashboardApi.getMissingCheckIns(),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  const staleIssuesSwr = useSWR(
    ["operations-stale-issues", 5, 20],
    async () =>
      operationsDashboardApi.getStaleIssues({ staleDays: 5, limit: 20 }),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  const pulseSwr = useSWR(
    currentOrgId ? ["operations-pulse-patterns", currentOrgId, "week"] : null,
    () => dashboardApi.getPulsePatterns(currentOrgId as string, "week"),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  if (loading) {
    return (
      <div className="p-6 text-sm text-fg-secondary">Загрузка дашборда…</div>
    );
  }
  if (error) {
    return (
      <div className="p-6">
        <h1 className="mb-2 text-2xl font-semibold">Аналитика</h1>
        <p className="rounded-lg bg-chip-danger-bg p-4 text-sm text-chip-danger-fg">
          {error}
        </p>
      </div>
    );
  }
  if (!data) {
    return <div className="p-6 text-sm text-fg-secondary">Нет данных</div>;
  }

  const pulse = pulseSwr.data ? pulsePatternsFromApi(pulseSwr.data) : null;
  const pulseLoading = pulseSwr.isLoading;
  const pulseError = pulseSwr.error
    ? pulseSwr.error instanceof Error
      ? pulseSwr.error.message
      : "Не удалось загрузить аналитику"
    : null;
  const teamFrictionsCount = pulse?.bottlenecks?.topPairs?.length ?? 0;
  const lowRoiMeetingsCount = pulse?.lowRoiMeetings?.meetings?.length ?? 0;

  const reworkEnabled = data.reworkEnabled;
  const maturityDomainCount = new Set(
    [...data.maturity.weakestDomains, ...data.maturity.topDomains].map(
      (d) => d.slug,
    ),
  ).size;

  const inflowBlockers = data.weeklyInflow.blockers;
  const inflowFrictions = data.weeklyInflow.frictions;
  const inflowData = inflowBlockers.map((v, i) => ({
    w: `${12 - i}н`,
    blockers: v ?? 0,
    frictions: inflowFrictions[i] ?? 0,
  }));
  const hasInflow =
    inflowBlockers.some((v) => v != null) ||
    inflowFrictions.some((v) => v != null);

  const body = (
    <>
      {}
      <div className="mb-4">
        <RequiresActionBanner orgId={currentOrgId} />
      </div>

      {}
      <div className="mt-6 grid grid-cols-1 gap-4 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300 motion-safe:fill-mode-backwards sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <StatCard
            icon={<Users size={20} />}
            grad={GRAD.pink}
            label="Конфликты в команде"
            value={String(data.teamFrictionCount)}
            tone={kpiTone(data.teamFrictionCount, {
              green: 0,
              yellow: 3,
              inverted: true,
            })}
            spark={data.weeklyInflow.frictions.map((v, i) => ({
              i,
              v: v ?? 0,
            }))}
          />
          {reworkEnabled ? (
            <p className="mt-1.5 text-xs" style={{ color: CHART.faint }}>
              закрыто: {data.frictionsResolvedCount}
            </p>
          ) : null}
        </div>

        <div>
          <StatCard
            icon={<AlertTriangle size={20} />}
            grad={GRAD.amber}
            label="Активные блокеры"
            value={String(data.blockersCount)}
            tone={kpiTone(data.blockersCount, {
              green: 0,
              yellow: 5,
              inverted: true,
            })}
            href="/dashboard/operations/weekly"
            spark={data.weeklyInflow.blockers.map((v, i) => ({ i, v: v ?? 0 }))}
          />
          {reworkEnabled ? (
            <p className="mt-1.5 text-xs" style={{ color: CHART.faint }}>
              закрыто за 30 дней: {data.blockersResolvedCount}
            </p>
          ) : null}
        </div>

        <StatCard
          icon={<Target size={20} />}
          grad={GRAD.violet}
          label="Провалившиеся цели"
          value={String(data.missedGoalsCount)}
          tone={kpiTone(data.missedGoalsCount, {
            green: 0,
            yellow: 2,
            inverted: true,
          })}
        />
      </div>

      {}

      {}
      <AnalyticsSection title="Риски и непрерывность" tone={CHART.red}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <BusFactorWidget
            data={pulse?.busFactor ?? null}
            loading={pulseLoading}
            error={pulseError}
          />
          {}
          <CustomerRiskRadarWidget />
          {}
          <KnowledgeAtRiskWidget />
        </div>
      </AnalyticsSection>

      {}
      <AnalyticsSection title="Аналитика пульса" tone={CHART.cyan}>
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KnowledgeVelocityKpi data={pulse?.knowledgeVelocity ?? null} />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <RecurringTopicsWidget
            data={pulse?.recurringTopics ?? null}
            loading={pulseLoading}
            error={pulseError}
          />
          <LowRoiMeetingsWidget
            meetings={pulse?.lowRoiMeetings.meetings ?? []}
            loading={pulseLoading}
            error={pulseError}
          />
        </div>
      </AnalyticsSection>

      <AnalyticsSection title="Трения" tone={CHART.amber}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <BottleneckHeatmapWidget
            data={pulse?.bottlenecks ?? null}
            loading={pulseLoading}
            error={pulseError}
          />
        </div>
      </AnalyticsSection>

      {}
      {hasInflow ? (
        <div className="mt-6">
          <AreaTrend
            title="Операционная нагрузка"
            titleIcon={<AlertTriangle size={16} />}
            titleGrad={GRAD.amber}
            data={inflowData}
            xKey="w"
            series={[
              { key: "blockers", color: CHART.amber, label: "Блокеры" },
              { key: "frictions", color: CHART.pink, label: "Конфликты" },
            ]}
            height={240}
          />
        </div>
      ) : null}

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

      {}
      {reworkEnabled ? (
        <div className="mt-6">
          <TeamCapacityWidget />
        </div>
      ) : null}

      <div className="mt-6">
        <ActivityFeedWidget
          feedTypes={["probe_question"]}
          scope="company"
          pageSize={10}
          title="Вопросы Коры команде"
        />
      </div>

      {}
      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2
            className="text-xs font-medium uppercase tracking-wide"
            style={{ color: CHART.faint }}
          >
            Сигналы
          </h2>
          {}
          {data.maturity.score !== null ? (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] font-medium"
              style={{ background: "var(--surface-inset)", color: CHART.dim }}
            >
              оценка
              {maturityDomainCount > 0
                ? ` (доменов посчитано ${maturityDomainCount})`
                : ""}
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

      {reworkEnabled ? (
        <div className="mt-8">
          <ChronicBlockersWidget />
        </div>
      ) : (
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
                    {b.ownerPersonName ?? "без владельца"} ·{" "}
                    {new Date(b.createdAt).toLocaleString("ru-RU")}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="mt-8">
        <GlassCard>
          <CardTitle icon={<Users size={16} />} grad={GRAD.pink}>
            Свежие конфликты
          </CardTitle>
          <div className="mt-4">
            {data.topRecentTeamFrictions.length === 0 ? (
              teamFrictionsCount === 0 && lowRoiMeetingsCount === 0 ? (
                <p className="text-sm" style={{ color: CHART.dim }}>
                  Пока спокойно: 0 конфликтов · 0 трений · 0 встреч с низкой
                  отдачей.
                </p>
              ) : (
                <p className="text-sm" style={{ color: CHART.dim }}>
                  На текущий момент конфликтов в команде не зафиксировано.
                </p>
              )
            ) : (
              <ul className="space-y-3">
                {data.topRecentTeamFrictions.map((f) => (
                  <li
                    key={f.id}
                    className="rounded-xl p-3"
                    style={{ background: "var(--surface-inset)" }}
                  >
                    <div className="flex flex-wrap items-baseline gap-2 text-sm">
                      <strong>{f.fromPersonName ?? "неизвестный"}</strong>
                      <span style={{ color: CHART.faint }}>↔</span>
                      <strong>{f.toPersonName ?? "неизвестный"}</strong>
                      <span className="text-xs" style={{ color: CHART.dim }}>
                        ({Math.round(f.confidence * 100)}% уверенности)
                      </span>
                    </div>
                    <p className="mt-1 text-xs" style={{ color: CHART.dim }}>
                      {f.explanation}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </GlassCard>
      </div>
    </>
  );

  if (embedded) {
    return body;
  }

  return (
    <ModernPageShell
      title="Аналитика"
      subtitle={`Обновлено ${data.generatedAt.toLocaleString("ru-RU")}`}
    >
      {}
      <OperationsTabs />
      {body}
    </ModernPageShell>
  );
}

function AnalyticsSection({
  title,
  tone,
  children,
}: {
  title: string;
  tone: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-8">
      <h2
        className="mb-3 text-xs font-medium uppercase tracking-wide"
        style={{ color: tone }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function TeamTemperatureSection(props: {
  summary: OperationsTeamTemperatureSummaryApi;
  heatmapLoading: boolean;
  heatmapError: string | null;
  heatmap: OperationsTeamTemperatureApi | null;
}) {
  const [mode, setMode] = useState<"overall" | "byPerson">("overall");
  return (
    <div className="mt-8">
      <GlassCard>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <CardTitle icon={<Thermometer size={16} />} grad={GRAD.teal}>
            Температура команды
          </CardTitle>
          <div
            className="inline-flex gap-1 rounded-xl p-1"
            style={{ background: "var(--surface-inset)" }}
          >
            <TemperatureModePill
              active={mode === "overall"}
              onClick={() => setMode("overall")}
              label="Общая"
            />
            <TemperatureModePill
              active={mode === "byPerson"}
              onClick={() => setMode("byPerson")}
              label="По людям"
            />
          </div>
        </div>
        {mode === "overall" ? (
          <TeamTemperatureOverallBody summary={props.summary} />
        ) : (
          <TeamTemperatureByPersonBody
            loading={props.heatmapLoading}
            error={props.heatmapError}
            temperature={props.heatmap}
          />
        )}
      </GlassCard>
    </div>
  );
}

function TemperatureModePill(props: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-pressed={props.active}
      className="rounded-lg px-3 py-1 text-xs font-medium transition-colors"
      style={
        props.active
          ? { background: "var(--surface-inset-strong)", color: CHART.text }
          : { color: CHART.dim }
      }
    >
      {props.label}
    </button>
  );
}

function TeamTemperatureOverallBody(props: {
  summary: OperationsTeamTemperatureSummaryApi;
}) {
  const s = props.summary;
  const pct = (v: number) => `${Math.round(v * 100)}%`;

  const deltaLabel = (() => {
    if (s.redShareDelta == null) return null;
    const delta = Math.round(s.redShareDelta * 100);
    if (delta === 0) return "без изменений";
    if (delta > 0) return `красных +${delta}% к прошлой неделе`;
    return `красных ${delta}% к прошлой неделе`;
  })();

  if (s.totalCheckIns === 0) {
    return (
      <p className="text-sm" style={{ color: CHART.dim }}>
        За последние {s.days} дней нет чек-инов с проанализированным
        настроением. Когда сотрудники начнут отвечать на вечерние чек-ины —
        здесь появится распределение зелёный / жёлтый / красный.
      </p>
    );
  }

  const donutData = [
    {
      name: `зелёных ${pct(s.greenShare)}`,
      value: Math.round(s.greenShare * 100),
      c: CHART.mint,
    },
    {
      name: `жёлтых ${pct(s.yellowShare)}`,
      value: Math.round(s.yellowShare * 100),
      c: CHART.amber,
    },
    {
      name: `красных ${pct(s.redShare)}`,
      value: Math.round(s.redShare * 100),
      c: CHART.red,
    },
  ].filter((d) => d.value > 0);

  return (
    <div className="mt-3 space-y-3">
      <p className="text-sm" style={{ color: CHART.dim }}>
        Последние {s.days} дн. · всего чек-инов: {s.totalCheckIns}
        {deltaLabel ? `; ${deltaLabel}.` : "."}
      </p>
      <DonutCard
        title="Распределение настроений"
        icon={<Thermometer size={16} />}
        grad={GRAD.teal}
        data={donutData}
        centerValue={String(s.totalCheckIns)}
        centerLabel="чек-инов"
      />
      <div className="flex justify-end">
        <Link
          href="/dashboard/operations/weekly"
          className="text-xs hover:underline"
          style={{ color: CHART.cyan }}
        >
          Открыть недельную сводку →
        </Link>
      </div>
    </div>
  );
}

function SeverityBadge(props: {
  severity: "low" | "medium" | "high" | "unknown";
}) {
  const label =
    props.severity === "high"
      ? "высокая"
      : props.severity === "medium"
        ? "средняя"
        : props.severity === "low"
          ? "низкая"
          : "неизв.";
  const colour =
    props.severity === "high"
      ? "bg-chip-danger-bg text-chip-danger-fg"
      : props.severity === "medium"
        ? "bg-chip-warning-bg text-chip-warning-fg"
        : props.severity === "low"
          ? "bg-chip-info-bg text-chip-info-fg"
          : "bg-bg-subtle text-fg-secondary";
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${colour}`}>
      {label}
    </span>
  );
}

function TeamTemperatureByPersonBody(props: {
  loading: boolean;
  error: string | null;
  temperature: OperationsTeamTemperatureApi | null;
}) {
  if (props.loading) {
    return (
      <p className="text-sm" style={{ color: CHART.dim }}>
        Загрузка…
      </p>
    );
  }
  if (props.error) {
    return (
      <p className="text-sm" style={{ color: CHART.red }}>
        {props.error}
      </p>
    );
  }
  if (!props.temperature || props.temperature.byPerson.length === 0) {
    return (
      <p className="text-sm" style={{ color: CHART.dim }}>
        Чек-инов с проанализированным настроением пока нет.
      </p>
    );
  }
  return (
    <div className="mt-3">
      <TeamTemperatureHeatmap byPerson={props.temperature.byPerson} />
    </div>
  );
}

function MissingCheckInsCard(props: {
  loading: boolean;
  error: string | null;
  data: OperationsMissingCheckInsApi | null;
}) {
  return (
    <GlassCard>
      <div className="flex items-center justify-between gap-2">
        <CardTitle icon={<UserX size={16} />} grad={GRAD.amber}>
          Не отчитались сегодня
        </CardTitle>
        {props.data ? (
          <span className="text-xs" style={{ color: CHART.dim }}>
            {props.data.missing.length} из {props.data.totalEmployees}
          </span>
        ) : null}
      </div>
      <div className="mt-4">
        {props.loading ? (
          <p className="text-sm" style={{ color: CHART.dim }}>
            Загрузка…
          </p>
        ) : props.error ? (
          <p className="text-sm" style={{ color: CHART.red }}>
            {props.error}
          </p>
        ) : !props.data || props.data.totalEmployees === 0 ? (
          <p className="text-sm" style={{ color: CHART.dim }}>
            В организации пока нет сотрудников.
          </p>
        ) : props.data.missing.length === 0 ? (
          <p className="text-sm" style={{ color: CHART.mint }}>
            Все сотрудники отчитались за {props.data.date}.
          </p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {props.data.missing.slice(0, 30).map((m) => (
              <li
                key={m.personId}
                className="rounded-lg px-3 py-1.5"
                style={{ background: "var(--surface-inset)" }}
              >
                {m.personName ?? "Без имени"}
              </li>
            ))}
            {props.data.missing.length > 30 ? (
              <li className="px-3 py-1 text-xs" style={{ color: CHART.faint }}>
                …и ещё {props.data.missing.length - 30}
              </li>
            ) : null}
          </ul>
        )}
      </div>
    </GlassCard>
  );
}

function StaleIssuesCard(props: {
  loading: boolean;
  error: string | null;
  data: OperationsStaleIssuesApi | null;
}) {
  type StaleRow = OperationsStaleIssuesApi["items"][number];
  const overdue = (it: StaleRow) =>
    it.daysOverdue !== null && it.daysOverdue > 0;
  const columns: ModernTableColumn<StaleRow>[] = [
    {
      header: "Задача",
      cell: (it) => (
        <Link
          href={`/issues/${it.issueId}`}
          className="hover:underline"
          style={{ color: CHART.text }}
        >
          <span className="mr-2 text-xs" style={{ color: CHART.faint }}>
            {it.identifier}
          </span>
          {it.title}
        </Link>
      ),
    },
    {
      header: "Статус",
      cell: (it) => <StatusPill status={overdue(it) ? "risk" : "warning"} />,
    },
    {
      header: "Просрочка",
      align: "right",
      cell: (it) => (
        <span className="text-xs" style={{ color: CHART.dim }}>
          {overdue(it)
            ? `просрочено ${it.daysOverdue} дн.`
            : `без активности ${it.daysSinceActivity} дн.`}
        </span>
      ),
    },
  ];

  if (props.loading) {
    return (
      <GlassCard>
        <CardTitle icon={<AlertTriangle size={16} />} grad={GRAD.violet}>
          Зависли задачи
        </CardTitle>
        <p className="mt-4 text-sm" style={{ color: CHART.dim }}>
          Загрузка…
        </p>
      </GlassCard>
    );
  }
  if (props.error) {
    return (
      <GlassCard>
        <CardTitle icon={<AlertTriangle size={16} />} grad={GRAD.violet}>
          Зависли задачи
        </CardTitle>
        <p className="mt-4 text-sm" style={{ color: CHART.red }}>
          {props.error}
        </p>
      </GlassCard>
    );
  }
  if (!props.data || props.data.items.length === 0) {
    return (
      <GlassCard>
        <CardTitle icon={<AlertTriangle size={16} />} grad={GRAD.violet}>
          Зависли задачи
        </CardTitle>
        <p className="mt-4 text-sm" style={{ color: CHART.mint }}>
          Зависших задач нет — все либо в работе, либо закрыты.
        </p>
      </GlassCard>
    );
  }
  return (
    <ModernTable
      title="Зависли задачи"
      titleIcon={<AlertTriangle size={16} />}
      titleGrad={GRAD.violet}
      columns={columns}
      rows={props.data.items.slice(0, 20)}
      getKey={(it) => it.issueId}
    />
  );
}
