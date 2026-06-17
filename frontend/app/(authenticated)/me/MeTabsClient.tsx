"use client";

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/shadcn/tabs";

import { MeClient } from "./MeClient";
import { ContributionsView } from "./contributions/ContributionsView";
import { MyPromisesClient } from "./promises/MyPromisesClient";
import { MyPulseClient } from "./pulse/MyPulseClient";
import { MySocialContributionClient } from "./social-contribution/MySocialContributionClient";

const TAB_VALUES = [
  "overview",
  "pulse",
  "contributions",
  "social",
  "promises",
] as const;

type MeTab = (typeof TAB_VALUES)[number];

const DEFAULT_TAB: MeTab = "overview";

const TABS: ReadonlyArray<{ value: MeTab; label: string }> = [
  { value: "overview", label: "Обзор" },
  { value: "pulse", label: "Пульс" },
  { value: "contributions", label: "Чем я полезен компании" },
  { value: "social", label: "Чем я помогаю коллегам" },
  { value: "promises", label: "Мои обещания" },
];

function isMeTab(value: string | null): value is MeTab {
  return value !== null && (TAB_VALUES as readonly string[]).includes(value);
}

export function MeTabsClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const rawTab = searchParams.get("tab");
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

      {}
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
