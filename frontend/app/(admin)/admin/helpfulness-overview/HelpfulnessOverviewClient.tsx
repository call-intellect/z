"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";
import {
  AlertTriangle,
  Check,
  Eye,
  EyeOff,
  Heart,
  Loader2,
  ShieldAlert,
  Users,
} from "lucide-react";

import { ApiError } from "@/api/api-error";
import { helpfulnessApi } from "@/api/helpfulness.api";
import { useAuth } from "@/contexts/auth-context";
import { toast } from "sonner";
import {
  mapListSpotlights,
  mapTeamMap,
  mapUnanswered,
  SPOTLIGHT_STATUS_LABEL,
  type HelpfulnessSpotlight,
  type TeamHelperRow,
  type UnansweredQuestionRow,
} from "@/domain/helpfulness";
import { Badge } from "@/ui/shadcn/badge";
import { Button } from "@/ui/shadcn/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/shadcn/card";
import { Skeleton } from "@/ui/shadcn/skeleton";

const TEAM_MAP_KEY = ["admin/helpfulness/team-map"];
const PENDING_SPOTLIGHTS_KEY = ["admin/helpfulness/pending-spotlights"];
const UNANSWERED_KEY = ["admin/helpfulness/unanswered"];

export function HelpfulnessOverviewClient() {
  const { currentOrgRole, currentOrgId, isLoading: authLoading } = useAuth();
  const canSee = currentOrgRole === "owner" || currentOrgRole === "admin";

  if (authLoading) return null;

  if (!currentOrgId) {
    return (
      <section className="p-6">
        <p className="text-fg-tertiary">
          Этот раздел доступен только в рамках организации.
        </p>
      </section>
    );
  }

  if (!canSee) {
    return (
      <section className="container mx-auto max-w-3xl p-6">
        <Card>
          <CardContent className="space-y-2 p-6 text-sm">
            <p className="font-medium text-fg-primary">Недостаточно прав</p>
            <p className="text-fg-tertiary">
              Эта страница доступна только администратору организации и
              руководителю команды.
            </p>
          </CardContent>
        </Card>
      </section>
    );
  }

  return (
    <section className="container mx-auto max-w-6xl space-y-6 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-fg-primary">
          Помощь в команде
        </h1>
        <p className="text-sm text-fg-tertiary">
          Служебная панель: карта помощников, спотлайты на одобрение и приватные
          сигналы. Никаких рейтингов «худших» здесь не показывается — мы видим
          только позитивные паттерны и точки внимания для разговора с командой.
        </p>
      </header>

      <PendingSpotlightsSection />

      <TeamMapSection />

      <UnansweredSection />
    </section>
  );
}

function PendingSpotlightsSection() {
  const [actingId, setActingId] = useState<string | null>(null);

  const { data, error, isLoading } = useSWR(
    PENDING_SPOTLIGHTS_KEY,
    async () => {
      const res = await helpfulnessApi.getFeedSpotlights({
        status: "pending",
        page: 1,
        limit: 50,
      });
      return mapListSpotlights(res);
    },
    { shouldRetryOnError: false },
  );

  async function handleApprove(s: HelpfulnessSpotlight) {
    setActingId(s.id);
    try {
      await helpfulnessApi.approveSpotlight(s.id);
      toast.success("Спотлайт одобрен и опубликован.");
      await mutate(PENDING_SPOTLIGHTS_KEY);
    } catch (e) {
      toast.error(
        e instanceof ApiError
          ? e.message
          : "Не удалось одобрить — попробуйте ещё раз.",
      );
    } finally {
      setActingId(null);
    }
  }

  async function handleHide(s: HelpfulnessSpotlight) {
    setActingId(s.id);
    try {
      await helpfulnessApi.hideSpotlight(s.id);
      toast.success("Спотлайт скрыт.");
      await mutate(PENDING_SPOTLIGHTS_KEY);
    } catch (e) {
      toast.error(
        e instanceof ApiError
          ? e.message
          : "Не удалось скрыть — попробуйте ещё раз.",
      );
    } finally {
      setActingId(null);
    }
  }

  const items: HelpfulnessSpotlight[] = data?.items ?? [];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Heart size={16} className="text-accent" />
          Спотлайты на одобрение
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-fg-tertiary">
          Авто-публикации нет — каждый спотлайт должен быть одобрен вручную
          руководителем или администратором. Это страховка от ложных
          благодарностей и манипуляций.
        </p>

        {isLoading && (
          <>
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </>
        )}

        {!isLoading && error && (
          <p className="text-sm text-danger">
            Не удалось загрузить ожидающие спотлайты.
          </p>
        )}

        {!isLoading && !error && items.length === 0 && (
          <p className="text-sm text-fg-tertiary">
            Сейчас нет спотлайтов, ждущих одобрения.
          </p>
        )}

        {items.length > 0 && (
          <ul className="space-y-3">
            {items.map((s) => (
              <li
                key={s.id}
                className="rounded-md border border-border-subtle bg-bg-elevated p-3"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-fg-tertiary">
                  <Badge variant="outline">
                    {SPOTLIGHT_STATUS_LABEL[s.status]}
                  </Badge>
                  <span className="font-medium text-fg-secondary">
                    {s.helperName ?? "Коллега"}
                  </span>
                  {s.topicHint && <span>· {s.topicHint}</span>}
                  <span>· {s.helpCount} помощей</span>
                  <span>
                    · {s.period.from.toLocaleDateString("ru-RU")} —{" "}
                    {s.period.to.toLocaleDateString("ru-RU")}
                  </span>
                </div>
                <p className="mb-3 text-sm text-fg-primary">{s.message}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleApprove(s)}
                    disabled={actingId === s.id}
                  >
                    {actingId === s.id ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Одобрить и опубликовать
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void handleHide(s)}
                    disabled={actingId === s.id}
                  >
                    <EyeOff className="mr-1.5 h-3.5 w-3.5" />
                    Скрыть
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function TeamMapSection() {
  const { data, error, isLoading } = useSWR(
    TEAM_MAP_KEY,
    async () => {
      const rows = await helpfulnessApi.getAdminTeamMap();
      return mapTeamMap(rows);
    },
    { shouldRetryOnError: false },
  );

  const rows: TeamHelperRow[] = (data ?? [])
    .slice()
    .sort((a, b) => b.lastWeekHelpCount - a.lastWeekHelpCount);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users size={16} className="text-accent" />
          Карта помощников команды
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-fg-tertiary">
          Кто и как помогает в команде — счётчики по 5 публичным типам
          активности. Это инструмент признания и поиска «социального клея», а не
          KPI и не основание для оценки сотрудника.
        </p>

        {isLoading && <Skeleton className="h-40 w-full" />}
        {!isLoading && error && (
          <p className="text-sm text-danger">
            Не удалось загрузить карту команды.
          </p>
        )}

        {!isLoading && !error && rows.length === 0 && (
          <p className="text-sm text-fg-tertiary">
            Пока нет данных по команде — нужно несколько недель наблюдений.
          </p>
        )}

        {!isLoading && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-fg-tertiary">
                <tr className="border-b border-border-subtle">
                  <th className="py-2 pr-3">Сотрудник</th>
                  <th className="py-2 pr-3 text-right">Неделя</th>
                  <th className="py-2 pr-3 text-right">Ответы</th>
                  <th className="py-2 pr-3 text-right">Менторство</th>
                  <th className="py-2 pr-3 text-right">Подсказки</th>
                  <th className="py-2 pr-3 text-right">Поддержка</th>
                  <th className="py-2 pr-3">Темы</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.userId}
                    className="border-b border-border-subtle/50"
                  >
                    <td className="py-2 pr-3 font-medium text-fg-primary">
                      {row.name ?? "Без имени"}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {row.lastWeekHelpCount}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-fg-secondary">
                      {row.helpProvidedCount}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-fg-secondary">
                      {row.mentoringCount}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-fg-secondary">
                      {row.proactiveHintCount}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-fg-secondary">
                      {row.emotionalSupportCount}
                    </td>
                    <td className="py-2 pr-3 text-xs text-fg-tertiary">
                      {row.topTopics.slice(0, 3).join(" · ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function UnansweredSection() {
  const { data, error, isLoading } = useSWR(
    UNANSWERED_KEY,
    async () => {
      const rows = await helpfulnessApi.getAdminUnanswered();
      return mapUnanswered(rows);
    },
    { shouldRetryOnError: false },
  );

  const rows: UnansweredQuestionRow[] = data ?? [];

  return (
    <Card className="border-chip-warning-bg bg-chip-warning-bg">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base text-chip-warning-fg">
          <ShieldAlert size={16} />
          Приватные сигналы: вопросы без ответа
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex items-start gap-2 rounded-md border border-chip-warning-bg bg-chip-warning-bg p-3 text-xs text-chip-warning-fg">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            Эти данные видны только администратору и руководителю команды. Они
            никогда не публикуются в ленте, не отображаются на странице
            сотрудника и не используются как основание для оценки. Цель — помочь
            руководителю заметить ситуацию и поговорить с командой.
          </span>
        </div>

        {isLoading && (
          <>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </>
        )}

        {!isLoading && error && (
          <p className="text-danger">Не удалось загрузить список.</p>
        )}

        {!isLoading && !error && rows.length === 0 && (
          <p className="text-fg-tertiary">
            Сейчас нет открытых вопросов без ответа — всё в порядке.
          </p>
        )}

        {!isLoading && rows.length > 0 && (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li
                key={row.id}
                className="rounded-md border border-border-subtle bg-bg-elevated p-3"
              >
                <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-fg-tertiary">
                  <span className="font-medium text-fg-secondary">
                    {row.recipientName ?? "Сотрудник"}
                  </span>
                  <span>не получил(а) ответ от</span>
                  <span className="font-medium text-fg-secondary">
                    {row.helperName ?? "коллеги"}
                  </span>
                  {row.topicHint && (
                    <span className="truncate">· {row.topicHint}</span>
                  )}
                  <span>
                    · {row.lastObservedAt.toLocaleDateString("ru-RU")}
                  </span>
                </div>
                {row.evidenceQuote && (
                  <blockquote className="border-l-2 border-border-subtle pl-2 text-xs italic text-fg-tertiary">
                    «{row.evidenceQuote}»
                  </blockquote>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

void Eye;
