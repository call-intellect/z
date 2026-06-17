"use client";

import { useEffect, useRef } from "react";
import useSWR from "swr";
import {
  AlertTriangle,
  CheckCircle2,
  Inbox,
  Lightbulb,
  Sparkles,
  UserCheck,
} from "lucide-react";

import { meDailyBriefApi } from "@/api/me/daily-brief.api";
import { useAuth } from "@/contexts/auth-context";
import {
  mapDailyBrief,
  type BriefItemDomain,
  type DailyBriefDomain,
} from "@/domain/me/daily-brief";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/shadcn/card";
import { Skeleton } from "@/ui/shadcn/skeleton";
import { EnableMorningRemindersButton } from "@/ui/pwa/EnableMorningRemindersButton";

function formatDueDate(d: Date | null): string {
  if (!d) return "без срока";
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

function BriefItemRow({ item }: { item: BriefItemDomain }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <span className="min-w-0 flex-1 text-sm text-fg-primary">
        {item.title}
      </span>
      <span className="shrink-0 text-xs text-fg-tertiary">
        {item.counterpartyName ? `${item.counterpartyName} · ` : ""}
        {formatDueDate(item.dueDate)}
      </span>
    </li>
  );
}

function DailyBriefView({ brief }: { brief: DailyBriefDomain }) {
  const {
    promiseKeeping,
    onDeckToday,
    atRiskItems,
    knowsWho,
    insightCoOccurrence,
    hint,
  } = brief;

  return (
    <div className="space-y-4">
      {}
      {promiseKeeping.total > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <UserCheck size={18} className="text-accent" aria-hidden />
              Держишь слово {promiseKeeping.kept} из {promiseKeeping.total}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-sm text-fg-secondary">
            {promiseKeeping.atRisk > 0
              ? `${promiseKeeping.atRisk} под угрозой — стоит перенести срок или закрыть.`
              : "Все обещания на сегодня в графике."}
          </CardContent>
        </Card>
      ) : null}

      {}
      {atRiskItems.length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle size={18} className="text-warning" aria-hidden />
              Под угрозой — перенести или закрыть
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="divide-y divide-border-subtle">
              {atRiskItems.map((item, i) => (
                <BriefItemRow key={`risk-${i}`} item={item} />
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckCircle2 size={18} className="text-accent" aria-hidden />
            Под рукой сегодня
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {onDeckToday.length > 0 ? (
            <ul className="divide-y divide-border-subtle">
              {onDeckToday.map((item, i) => (
                <BriefItemRow key={`deck-${i}`} item={item} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg-tertiary">
              На сегодня ничего срочного — хороший день, чтобы продвинуть
              важное.
            </p>
          )}
        </CardContent>
      </Card>

      {}
      {insightCoOccurrence ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles size={18} className="text-accent" aria-hidden />
              Ты не один
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-sm text-fg-secondary">
            {insightCoOccurrence.statement}
            {insightCoOccurrence.colleaguesCount > 0
              ? ` — об этом думают ещё ${insightCoOccurrence.colleaguesCount} коллег.`
              : ""}
          </CardContent>
        </Card>
      ) : null}

      {}
      {knowsWho ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <UserCheck size={18} className="text-accent" aria-hidden />
              Кто поможет
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-sm text-fg-secondary">
            По задаче «{knowsWho.blockerText}» больше всех знает{" "}
            <span className="font-medium text-fg-primary">
              {knowsWho.expertName}
            </span>
            .
          </CardContent>
        </Card>
      ) : null}

      {}
      {hint.trim().length > 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Lightbulb size={18} className="text-accent" aria-hidden />
              Подсказка дня
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-sm text-fg-secondary">
            {hint}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function ColdStartEmptyState() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <Inbox size={32} className="text-fg-tertiary" aria-hidden />
        <p className="text-base font-medium text-fg-primary">
          Твой день пока наполняется
        </p>
        <p className="max-w-sm text-sm text-fg-secondary">
          Кора собирает задачи, обещания и подсказки из встреч и чатов компании.
          Как только наберётся материал — здесь появится короткая сводка на
          утро.
        </p>
      </CardContent>
    </Card>
  );
}

export function MyDailyBriefClient() {
  const { currentOrgId, isLoading: authLoading } = useAuth();

  const swrKey = currentOrgId
    ? (["me-daily-brief", currentOrgId] as const)
    : null;
  const { data, error, isLoading } = useSWR(swrKey, async () => {
    const api = await meDailyBriefApi.get();
    return mapDailyBrief(api);
  });

  const openedSentForId = useRef<string | null>(null);
  useEffect(() => {
    const id = data?.id ?? null;
    if (!id) return;
    if (openedSentForId.current === id) return;
    openedSentForId.current = id;
    void meDailyBriefApi.markOpened(id).catch(() => {
      openedSentForId.current = null;
    });
  }, [data?.id]);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 px-4 py-6 md:py-8">
      <header className="space-y-3">
        <div>
          <h1 className="text-xl font-semibold text-fg-primary">Твой день</h1>
          <p className="text-sm text-fg-tertiary">
            Короткая сводка на утро: что под рукой и что важно не упустить.
          </p>
        </div>
        <EnableMorningRemindersButton />
      </header>

      {authLoading || isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : error ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-fg-secondary">
            Не удалось загрузить твой день. Обнови страницу — обычно помогает.
          </CardContent>
        </Card>
      ) : !data || data.isEmpty ? (
        <ColdStartEmptyState />
      ) : (
        <DailyBriefView brief={data} />
      )}
    </div>
  );
}
