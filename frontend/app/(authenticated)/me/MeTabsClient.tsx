'use client';

import { useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';

import { MeClient } from './MeClient';
import { ContributionsView } from './contributions/ContributionsView';
import { MyPromisesClient } from './promises/MyPromisesClient';
import { MyPulseClient } from './pulse/MyPulseClient';
import { MySocialContributionClient } from './social-contribution/MySocialContributionClient';

/**
 * Кабинет «Я» с вкладками (ТЗ-E Фаза 1, R9).
 *
 * Сводит пять ранее отдельных страниц `/me/*` в один экран с вкладками.
 * Каждый клиент-вкладка самодостаточен — сам резолвит свой контекст
 * (`useAuth` / `GET /me/profile` / профильный API), поэтому обёртке не нужно
 * прокидывать ни `personId`, ни прочие пропсы. `MyPulseClient` резолвит свой
 * `personId` внутри через `meProfileApi.get(currentOrgId)`.
 *
 * Активная вкладка живёт в query (`?tab=`), чтобы deep-link и редиректы со
 * старых URL (`/me/pulse` → `/me?tab=pulse` и т.п.) открывали нужную вкладку.
 * Смена вкладки — `router.replace`, без записи в историю (как в дашбордах).
 */
const TAB_VALUES = [
  'overview',
  'pulse',
  'contributions',
  'social',
  'promises',
] as const;

type MeTab = (typeof TAB_VALUES)[number];

const DEFAULT_TAB: MeTab = 'overview';

const TABS: ReadonlyArray<{ value: MeTab; label: string }> = [
  { value: 'overview', label: 'Обзор' },
  { value: 'pulse', label: 'Пульс' },
  { value: 'contributions', label: 'Чем я полезен компании' },
  { value: 'social', label: 'Чем я помогаю коллегам' },
  { value: 'promises', label: 'Мои обещания' },
];

function isMeTab(value: string | null): value is MeTab {
  return value !== null && (TAB_VALUES as readonly string[]).includes(value);
}

export function MeTabsClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const rawTab = searchParams.get('tab');
  const activeTab: MeTab = useMemo(
    () => (isMeTab(rawTab) ? rawTab : DEFAULT_TAB),
    [rawTab],
  );

  const handleChange = useCallback(
    (value: string) => {
      router.replace(`/me?tab=${value}`);
    },
    [router],
  );

  return (
    <Tabs value={activeTab} onValueChange={handleChange} className="w-full">
      <div className="mx-auto w-full max-w-4xl px-4 pt-6 md:px-6">
        <TabsList className="flex w-full flex-wrap">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {/* Каждый клиент уже несёт собственный контейнер с паддингами и
          заголовком раздела — оборачивать в дополнительный padding не нужно,
          иначе получится двойной отступ. `mt-0` гасит дефолтный `mt-4`
          TabsContent, чтобы верх контента был ровно под полосой вкладок. */}
      <TabsContent value="overview" className="mt-0">
        <MeClient />
      </TabsContent>
      <TabsContent value="pulse" className="mt-0">
        <MyPulseClient />
      </TabsContent>
      <TabsContent value="contributions" className="mt-0">
        <ContributionsView title="Чем я полезен компании" />
      </TabsContent>
      <TabsContent value="social" className="mt-0">
        <MySocialContributionClient />
      </TabsContent>
      <TabsContent value="promises" className="mt-0">
        <MyPromisesClient />
      </TabsContent>
    </Tabs>
  );
}
