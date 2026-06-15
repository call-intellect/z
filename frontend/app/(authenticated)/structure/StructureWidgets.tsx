'use client';

/**
 * ТЗ редизайн Ф7а (фронт) — блок аналитических виджетов раздела «Команда».
 *
 * Размещается под табами `/structure`, виден только руководителю
 * (owner / admin / coo) — ровно как доступ к dashboard-эндпоинтам
 * (`team-health`, `people-at-risk`), которые отдают 403 для manager.
 *
 * Состав (источник правды — прототип
 * `plans/analysis/2026-06-13-cabinet-redesign-prototypes/_parts/part-team.html`):
 *   1. «Здоровье команд» — таблица команд с cohort ≥3; если таких нет — Б-6-схлоп
 *      в одну строку-объяснение «считается от 3 человек» + CTA «к отделам».
 *   2. «Кому помочь» — карточки people-at-risk БЕЗ рейтинга/чисел, только повод
 *      для 1:1 (формулировка-действие). Б-6 пусто → «все в норме».
 *   3. «Зрелость компании» — gauge с числом; если companyScore null
 *      («не определено») → плашка «идёт сбор данных», без «30%».
 *   4. «Дисциплина чек-инов» — переиспользуем готовый `CheckinDisciplineWidget`.
 *
 * Виджеты используют «современный» визуальный язык (modern/*): стеклянные
 * карточки, парные токены, без text-white/hex/slate. Поэтому весь блок сидит на
 * собственной тёмной modern-подложке (как страницы дашбордов), чтобы стекло
 * читалось корректно поверх обычной светлой/тёмной темы кабинета.
 */

import { HeartPulse, Layers, Users } from 'lucide-react';
import useSWR from 'swr';

import { dashboardApi } from '@/api/dashboard.api';
import { maturityApi } from '@/api/maturity.api';
import {
  peopleAtRiskFromApi,
  type PeopleAtRiskItemDomain,
} from '@/domain/people-at-risk';
import {
  teamHealthFromApi,
  type HealthToneDomain,
  type TeamHealthRowDomain,
} from '@/domain/team-health';
import { toMaturityOverviewDomain } from '@/domain/maturity';
import { CheckinDisciplineWidget } from '@app/(authenticated)/week/CheckinDisciplineWidget';
import {
  CardTitle,
  CHART,
  GaugeCard,
  GlassCard,
  GRAD,
  MODERN_PAGE_BG,
} from '@/ui/components/dashboard/modern';

/* ── Хелперы ───────────────────────────────────────────────────────────── */

/** Понедельник текущей недели (UTC, YYYY-MM-DD) — окно для дисциплины чек-инов. */
function mondayThisWeekUtc(): string {
  const d = new Date();
  const dow = d.getUTCDay(); // 0=вс, 1=пн, …
  const offset = dow === 0 ? -6 : -(dow - 1);
  const monday = new Date(d);
  monday.setUTCDate(monday.getUTCDate() + offset);
  const y = monday.getUTCFullYear();
  const m = String(monday.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(monday.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

const TONE_CHIP: Record<HealthToneDomain, { c: string; bg: string }> = {
  success: { c: CHART.mint, bg: 'oklch(0.85 0.15 165 / 0.14)' },
  warning: { c: CHART.amber, bg: 'oklch(0.84 0.16 80 / 0.14)' },
  danger: { c: CHART.red, bg: 'oklch(0.66 0.22 25 / 0.16)' },
  neutral: { c: CHART.dim, bg: 'var(--surface-inset)' },
};

/* ── Корневой блок ─────────────────────────────────────────────────────── */

export function StructureWidgets({ orgId }: { orgId: string }) {
  const weekStart = mondayThisWeekUtc();

  return (
    <div
      className="mt-8 rounded-3xl p-5 sm:p-6"
      style={{ background: MODERN_PAGE_BG, color: CHART.text }}
    >
      <div className="mb-5">
        <h2 className="text-lg font-semibold tracking-tight">
          Здоровье и пульс команды
        </h2>
        <p className="mt-1 text-sm" style={{ color: CHART.dim }}>
          Подсказки руководителю: где нужна помощь, держим ли ритм и насколько
          зрела компания. Это не оценка людей — повод для короткого разговора.
        </p>
      </div>

      <div className="space-y-6">
        <TeamHealthWidget orgId={orgId} />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <PeopleToHelpWidget orgId={orgId} />
          </div>
          <MaturityWidget orgId={orgId} />
        </div>

        <CheckinDisciplineWidget weekStart={weekStart} />
      </div>
    </div>
  );
}

/* ── 1. Здоровье команд ────────────────────────────────────────────────── */

function TeamHealthWidget({ orgId }: { orgId: string }) {
  const { data, error, isLoading } = useSWR(
    ['structure-team-health', orgId],
    async () => teamHealthFromApi(await dashboardApi.getTeamHealth(orgId)),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  // Команды, по которым здоровье реально считается (cohort ≥3).
  const cohortTeams = (data?.teams ?? []).filter((t) => !t.belowCohort);

  return (
    <GlassCard>
      <CardTitle icon={<Users size={16} />} grad={GRAD.teal}>
        Здоровье команд
      </CardTitle>

      {isLoading ? (
        <p className="mt-4 text-sm" style={{ color: CHART.dim }}>
          Загрузка…
        </p>
      ) : error ? (
        // Б-6 — ошибка (виджет некритичен). Нейтральный текст, без падения.
        <p className="mt-4 text-sm" style={{ color: CHART.dim }}>
          Не удалось загрузить здоровье команд.
        </p>
      ) : cohortTeams.length === 0 ? (
        // Б-6 — схлоп: нет ни одной команды cohort ≥3.
        <div
          className="mt-4 rounded-2xl p-6"
          style={{ background: 'var(--surface-inset)' }}
        >
          <p className="text-sm leading-relaxed" style={{ color: CHART.dim }}>
            Здоровье команды Кора считает, когда в отделе{' '}
            <b style={{ color: CHART.text }}>от 3 человек</b> — иначе сравнивать
            не с чем. Сейчас таких отделов нет: люди разнесены по одиночке.
            Объедините близкие отделы — и здоровье посчитается само.
          </p>
        </div>
      ) : (
        <TeamHealthTable rows={cohortTeams} />
      )}
    </GlassCard>
  );
}

function TeamHealthTable({ rows }: { rows: TeamHealthRowDomain[] }) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr
            className="border-b border-border-subtle text-left text-xs"
            style={{ color: CHART.faint }}
          >
            <th className="py-2 pr-3 font-medium">Команда</th>
            <th className="py-2 pr-3 text-center font-medium">Настроение</th>
            <th className="py-2 pr-3 text-center font-medium">Обещания</th>
            <th className="py-2 text-center font-medium">Конфликты</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.departmentId} className="border-b border-border-subtle/50">
              <td className="py-2.5 pr-3">
                <div className="font-medium" style={{ color: CHART.text }}>
                  {row.departmentName}
                </div>
                <div className="text-[11px]" style={{ color: CHART.faint }}>
                  {row.size} чел.
                </div>
              </td>
              <td className="py-2.5 pr-3 text-center">
                <HealthChip
                  tone={row.sentiment.tone}
                  label={formatSigned(row.sentiment.value)}
                />
              </td>
              <td className="py-2.5 pr-3 text-center">
                <HealthChip
                  tone={row.promises.tone}
                  label={`${row.promises.value}%`}
                />
              </td>
              <td className="py-2.5 text-center">
                <HealthChip
                  tone={row.conflicts.tone}
                  label={String(row.conflicts.value)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HealthChip({ tone, label }: { tone: HealthToneDomain; label: string }) {
  const t = TONE_CHIP[tone];
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium tabular-nums"
      style={{ color: t.c, background: t.bg }}
    >
      {label}
    </span>
  );
}

function formatSigned(v: number): string {
  return v > 0 ? `+${v}` : String(v);
}

/* ── 2. Кому помочь (people-at-risk, без чисел) ────────────────────────── */

function PeopleToHelpWidget({ orgId }: { orgId: string }) {
  const { data, error, isLoading } = useSWR(
    ['structure-people-at-risk', orgId],
    async () => peopleAtRiskFromApi(await dashboardApi.peopleAtRisk(orgId, 6)),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  return (
    <GlassCard>
      <CardTitle icon={<HeartPulse size={16} />} grad={GRAD.pink}>
        Кому помочь
      </CardTitle>
      <p className="mt-1 text-sm" style={{ color: CHART.dim }}>
        Повод для короткого разговора 1:1. Не рейтинг и не оценка — подсказка,
        кому сейчас нужнее внимание.
      </p>

      {isLoading ? (
        <p className="mt-4 text-sm" style={{ color: CHART.dim }}>
          Загрузка…
        </p>
      ) : error ? (
        <p className="mt-4 text-sm" style={{ color: CHART.dim }}>
          Не удалось загрузить.
        </p>
      ) : !data || data.items.length === 0 ? (
        // Б-6 — никто не под риском.
        <div
          className="mt-4 rounded-2xl p-6 text-center"
          style={{ background: 'var(--surface-inset)' }}
        >
          <p className="text-sm font-medium" style={{ color: CHART.mint }}>
            Все в норме
          </p>
          <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed" style={{ color: CHART.faint }}>
            Нет сотрудников, кому сейчас особенно нужна помощь. Заглядывайте сюда
            время от времени.
          </p>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {data.items.map((it) => (
            <PersonHelpCard key={it.personId} item={it} />
          ))}
        </div>
      )}
    </GlassCard>
  );
}

function PersonHelpCard({ item }: { item: PeopleAtRiskItemDomain }) {
  const initials = item.name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <div
      className="flex flex-col rounded-2xl p-4"
      style={{ background: 'var(--surface-inset)', border: '1px solid var(--border-inset)' }}
    >
      <div className="flex items-center gap-3">
        <span
          className="grid h-10 w-10 place-items-center rounded-xl text-sm font-semibold"
          style={{ background: GRAD.teal, color: CHART.text }}
        >
          {initials || '?'}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium" style={{ color: CHART.text }}>
            {item.name}
          </div>
          {item.department ? (
            <div className="truncate text-xs" style={{ color: CHART.faint }}>
              {item.department}
            </div>
          ) : null}
        </div>
      </div>
      <span
        className="mt-3 inline-flex w-fit items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium"
        style={{ color: CHART.amber, background: 'oklch(0.84 0.16 80 / 0.14)' }}
      >
        повод для короткого 1:1
      </span>
      <p className="mt-2 text-[13px] leading-relaxed" style={{ color: CHART.dim }}>
        {item.topReason}
      </p>
    </div>
  );
}

/* ── 3. Зрелость компании ──────────────────────────────────────────────── */

function MaturityWidget({ orgId }: { orgId: string }) {
  const { data, error, isLoading } = useSWR(
    ['structure-maturity', orgId],
    async () => toMaturityOverviewDomain(await maturityApi.overview(orgId)),
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );

  // companyScore null → «не определено» (идёт сбор данных). Иначе процент.
  const percent = data?.companyPercent ?? null;
  const defined = !isLoading && !error && percent !== null;

  if (defined) {
    return (
      <GaugeCard
        title="Зрелость компании"
        icon={<Layers size={16} />}
        grad={GRAD.teal}
        value={percent}
        max={100}
      />
    );
  }

  return (
    <GlassCard>
      <CardTitle icon={<Layers size={16} />} grad={GRAD.teal}>
        Зрелость компании
      </CardTitle>
      {isLoading ? (
        <p className="mt-4 text-sm" style={{ color: CHART.dim }}>
          Загрузка…
        </p>
      ) : (
        <div
          className="mt-4 rounded-2xl p-6 text-center"
          style={{ background: 'var(--surface-inset)' }}
        >
          <p className="text-sm font-medium" style={{ color: CHART.dim }}>
            Пока не определено
          </p>
          <p className="mx-auto mt-1.5 max-w-xs text-xs leading-relaxed" style={{ color: CHART.faint }}>
            Кора ещё собирает данные о том, как компания принимает и доводит
            решения. Оценка появится, когда наберётся история нескольких недель.
          </p>
        </div>
      )}
    </GlassCard>
  );
}
