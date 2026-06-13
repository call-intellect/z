'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Activity, AlertTriangle, CheckCircle2, Users } from 'lucide-react';

import { CHART, glass, ModernPageShell } from '@/ui/components/dashboard/modern';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import { OperationsDashboardClient } from '../dashboard/operations/OperationsDashboardClient';
import { WeeklyDigestClient } from '../dashboard/operations/weekly/WeeklyDigestClient';
import { WeeklyPerPersonWidget } from '../dashboard/operations/weekly/WeeklyPerPersonWidget';
import { PortfolioDashboardClient } from '../dashboard/portfolio/PortfolioDashboardClient';
import { CheckinDisciplineWidget } from './CheckinDisciplineWidget';

/**
 * НЕДЕЛЯ — десктоп-экран `/week` (ТЗ редизайн кабинета Ф2).
 *
 * Понедельничный ритм: слияние трёх ранее отдельных дашбордов в один экран с
 * вкладками. Порядок по смыслу — «Кто держит слово» ключевая, но «Сводка»
 * остаётся первой (вход с вердикта). Состав:
 *   - «Сводка»          — вердикт недели + недельный дайджест (`WeeklyDigestClient`)
 *                          + вектор/портфель целей (`PortfolioDashboardClient`).
 *   - «Пульс сейчас»    — операционный пульс (`OperationsDashboardClient`).
 *   - «Кто держит слово» — план-факт по людям (`WeeklyPerPersonWidget`) +
 *                          дисциплина чек-инов (`CheckinDisciplineWidget`).
 *
 * Все вкладки делят одну `weekStart` (понедельник), которую держит этот экран и
 * синхронизирует с query `?weekStart=`. `?tab=` хранит активную вкладку для
 * deep-link; `tab=vector` (редирект со старого `/dashboard/portfolio`) ведёт на
 * вкладку «Сводка», где живёт вектор целей.
 *
 * Вложенность: общий `ModernPageShell` даёт фон + заголовок «Неделя». Дочерние
 * клиенты рендерятся в `embedded`-режиме (без собственного shell/заголовка/
 * операционных таб) — двойного фона и тройного заголовка не возникает.
 */

const TAB_VALUES = ['summary', 'pulse', 'people'] as const;
type WeekTab = (typeof TAB_VALUES)[number];
const DEFAULT_TAB: WeekTab = 'summary';

const TABS: ReadonlyArray<{ value: WeekTab; label: string; icon: typeof Users }> = [
  { value: 'summary', label: 'Сводка', icon: Activity },
  { value: 'pulse', label: 'Пульс сейчас', icon: AlertTriangle },
  { value: 'people', label: 'Кто держит слово', icon: Users },
];

/** `tab=vector` (редирект с портфеля) ведёт на «Сводку» с вектором целей. */
function normalizeTab(raw: string | null): WeekTab {
  if (raw === 'vector') return 'summary';
  if (raw !== null && (TAB_VALUES as readonly string[]).includes(raw)) {
    return raw as WeekTab;
  }
  return DEFAULT_TAB;
}

/** Понедельник прошедшей недели (UTC) — дефолт, как в `WeeklyDigestClient`. */
function defaultLastMondayUtc(): string {
  const d = new Date();
  const dow = d.getUTCDay(); // 0=вс, 1=пн, …
  const offset = dow === 0 ? -13 : -(dow - 1) - 7;
  const monday = new Date(d);
  monday.setUTCDate(monday.getUTCDate() + offset);
  const y = monday.getUTCFullYear();
  const m = String(monday.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(monday.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function WeekDesktopClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const activeTab = useMemo(
    () => normalizeTab(searchParams.get('tab')),
    [searchParams],
  );

  const [weekStart, setWeekStart] = useState(
    () => searchParams.get('weekStart') ?? defaultLastMondayUtc(),
  );

  // Смена недели — синхронизируем query (без записи в историю), сохраняя tab.
  const handleWeekChange = useCallback(
    (nextWeek: string) => {
      setWeekStart(nextWeek);
      const params = new URLSearchParams(searchParams.toString());
      params.set('weekStart', nextWeek);
      router.replace(`/week?${params.toString()}`);
    },
    [router, searchParams],
  );

  // Смена вкладки — пишем `tab` в query, сохраняя `weekStart`.
  const handleTabChange = useCallback(
    (value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', value);
      router.replace(`/week?${params.toString()}`);
    },
    [router, searchParams],
  );

  return (
    <ModernPageShell
      title="Неделя"
      subtitle="Понедельничный разбор: сводка, операционный пульс и кто держит слово."
    >
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="flex w-full flex-wrap">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <TabsTrigger key={tab.value} value={tab.value}>
                <Icon size={14} strokeWidth={1.75} className="shrink-0" />
                {tab.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        {/* ── Сводка ──────────────────────────────────────────────────── */}
        <TabsContent value="summary">
          <div className="space-y-6">
            <WeekVerdictBar weekStart={weekStart} />
            <WeeklyDigestClient
              embedded
              weekStart={weekStart}
              onWeekChange={handleWeekChange}
            />
            <PortfolioDashboardClient embedded />
          </div>
        </TabsContent>

        {/* ── Пульс сейчас ────────────────────────────────────────────── */}
        <TabsContent value="pulse">
          <OperationsDashboardClient embedded />
        </TabsContent>

        {/* ── Кто держит слово ────────────────────────────────────────── */}
        <TabsContent value="people">
          <div className="space-y-6">
            <WeeklyPerPersonWidget weekStart={weekStart} />
            <CheckinDisciplineWidget weekStart={weekStart} />
          </div>
        </TabsContent>
      </Tabs>
    </ModernPageShell>
  );
}

/**
 * Строка-вердикт недели (в духе VerdictBar экрана «Сегодня»). Без отдельного
 * запроса: спокойный нейтральный вердикт-навигатор. Числа/риски раскрываются
 * ниже в дайджесте, поэтому здесь — мягкий «вход в разбор», без тревоги.
 */
function WeekVerdictBar({ weekStart }: { weekStart: string }) {
  return (
    <div
      className="flex items-center gap-3 rounded-2xl p-4"
      style={glass({ borderRadius: 16 })}
      role="status"
    >
      <span
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full"
        style={{ background: 'oklch(0.85 0.15 165 / 0.14)', color: CHART.mint }}
        aria-hidden
      >
        <CheckCircle2 size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold" style={{ color: CHART.text }}>
          Понедельничный разбор недели
        </div>
        <div className="mt-0.5 truncate text-xs" style={{ color: CHART.faint }}>
          Неделя с {formatRu(weekStart)} · температура, обещания и движение целей
          — ниже.
        </div>
      </div>
    </div>
  );
}

/** YYYY-MM-DD → DD.MM.YYYY. */
function formatRu(dateLocal: string): string {
  const [y, m, d] = dateLocal.split('-');
  return `${d}.${m}.${y}`;
}
