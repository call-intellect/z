"use client";

import { useCallback, useEffect, useState } from "react";
import {
  X,
  Sparkles,
  AlertTriangle,
  HelpCircle,
  ChevronRight,
  MessageCircle,
} from "lucide-react";

import { ApiError, humanizeApiError } from "@/api/api-error";
import {
  proactiveApi,
  type ProactiveNotificationApi,
} from "@/api/proactive.api";
import { activityFeedApi } from "@/api/activity-feed.api";
import type { FeedItemApi } from "@/domain/activity-feed";
import { useAuth } from "@/contexts/auth-context";
import { cn } from "@/ui/shadcn/lib/utils";
import { OrgChatPanel } from "@/ui/components/chat/OrgChatPanel";

type SidebarTab = "urgent" | "feed" | "probes" | "ask";

const POLL_MS = 60_000;

export function AssistantSidebar() {
  const { currentOrgId } = useAuth();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<SidebarTab>("urgent");
  const [proactives, setProactives] = useState<ProactiveNotificationApi[]>([]);
  const [probes, setProbes] = useState<FeedItemApi[]>([]);
  const [otherUrgent, setOtherUrgent] = useState<FeedItemApi[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentOrgId) {
      setProactives([]);
      setProbes([]);
      setOtherUrgent([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [proactiveRes, probeRes, urgentRes] = await Promise.all([
        proactiveApi
          .list(currentOrgId)
          .catch(() => ({ items: [] as ProactiveNotificationApi[] })),
        activityFeedApi
          .list({ feedType: "probe_question", status: "emitted", limit: 10 })
          .catch(() => ({
            items: [] as FeedItemApi[],
            total: 0,
            page: 1,
            limit: 10,
            totalPages: 1,
          })),
        activityFeedApi
          .list({ feedType: "insight", status: "emitted", limit: 10 })
          .catch(() => ({
            items: [] as FeedItemApi[],
            total: 0,
            page: 1,
            limit: 10,
            totalPages: 1,
          })),
      ]);
      setProactives(proactiveRes.items.filter((p) => !p.dismissedAt));
      setProbes(probeRes.items);
      setOtherUrgent(
        urgentRes.items.filter(
          (i) => i.severity === "critical" || i.severity === "high",
        ),
      );
    } catch (e) {
      setError(humanizeApiError(e, "Не удалось загрузить"));
    } finally {
      setLoading(false);
    }
  }, [currentOrgId]);

  useEffect(() => {
    void load();
    const id = setInterval(() => {
      void load();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    function handleOpenAsk() {
      setOpen(true);
      setActiveTab("ask");
    }
    if (typeof window !== "undefined") {
      window.addEventListener("assistant-sidebar:open-ask", handleOpenAsk);
      return () => {
        window.removeEventListener("assistant-sidebar:open-ask", handleOpenAsk);
      };
    }
    return undefined;
  }, []);

  const unreadCount = proactives.length + probes.length + otherUrgent.length;

  const handleDismiss = async (id: string) => {
    if (!currentOrgId) return;
    try {
      await proactiveApi.dismiss(currentOrgId, id);
      setProactives((prev) => prev.filter((p) => p.id !== id));
    } catch {}
  };

  return (
    <>
      {}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        data-tour-target="welcome.concierge"
        className={cn(
          "fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-fg shadow-lg transition-transform hover:scale-105",
          open && "rotate-90",
        )}
        aria-label="Помощник компании"
      >
        {open ? <X size={20} /> : <Sparkles size={20} />}
        {!open && unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-chip-danger-bg px-1 text-[10px] font-semibold text-chip-danger-fg">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {}
      <aside
        className={cn(
          "fixed right-0 top-0 z-30 h-full w-[360px] transform border-l border-border-subtle bg-bg-base shadow-2xl transition-transform duration-200",
          open ? "translate-x-0" : "translate-x-full",
        )}
        aria-hidden={!open}
      >
        <div className="flex h-full flex-col">
          <header className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-accent" />
              <h2 className="text-sm font-semibold text-fg-primary">
                Помощник компании
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-fg-tertiary hover:text-fg-primary"
              aria-label="Закрыть"
            >
              <X size={16} />
            </button>
          </header>

          <nav
            aria-label="Разделы помощника"
            className="-mx-2 flex gap-1 overflow-x-auto border-b border-border-subtle px-2 pb-2 pt-2 scrollbar-none"
          >
            {(["urgent", "feed", "probes", "ask"] as const).map((tab) => {
              const label =
                tab === "urgent"
                  ? "Срочное"
                  : tab === "feed"
                    ? "Сигналы"
                    : tab === "probes"
                      ? "Вопросы"
                      : "Спросить";
              const Icon =
                tab === "urgent"
                  ? AlertTriangle
                  : tab === "feed"
                    ? Sparkles
                    : tab === "probes"
                      ? HelpCircle
                      : MessageCircle;
              const count =
                tab === "urgent"
                  ? proactives.length
                  : tab === "feed"
                    ? otherUrgent.length
                    : tab === "probes"
                      ? probes.length
                      : 0;
              const isActive = activeTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    isActive
                      ? "bg-accent/15 text-accent-fg"
                      : "bg-bg-overlay/60 text-fg-secondary hover:bg-bg-overlay hover:text-fg-primary",
                  )}
                  aria-current={isActive ? "page" : undefined}
                >
                  <Icon size={12} strokeWidth={1.75} className="shrink-0" />
                  <span>{label}</span>
                  {count > 0 ? (
                    <span className="ml-0.5 rounded-full bg-bg-base/60 px-1.5 text-[10px] text-fg-tertiary">
                      {count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>

          <div className="flex-1 overflow-y-auto p-4">
            {activeTab === "urgent" && (
              <UrgentSection
                proactives={proactives}
                loading={loading}
                error={error}
                onDismiss={(id) => void handleDismiss(id)}
              />
            )}
            {activeTab === "feed" && (
              <FeedSection
                items={otherUrgent}
                loading={loading}
                error={error}
              />
            )}
            {activeTab === "probes" && (
              <ProbesSection items={probes} loading={loading} error={error} />
            )}
            {activeTab === "ask" && <AskSection />}
          </div>
        </div>
      </aside>
    </>
  );
}

function UrgentSection({
  proactives,
  loading,
  error,
  onDismiss,
}: {
  proactives: ProactiveNotificationApi[];
  loading: boolean;
  error: string | null;
  onDismiss: (id: string) => void;
}) {
  if (loading && proactives.length === 0) {
    return <p className="text-sm text-fg-tertiary">Загружаем…</p>;
  }
  if (error) return <p className="text-sm text-chip-danger-fg">{error}</p>;
  if (proactives.length === 0) {
    return (
      <div className="rounded-xl bg-bg-overlay/40 p-6 text-center">
        <p className="text-sm text-fg-secondary">Срочного сейчас нет.</p>
        <p className="mt-2 text-xs text-fg-tertiary">
          Кора подскажет, когда что-то требует вашего внимания.
        </p>
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {proactives.slice(0, 10).map((p) => (
        <ProactiveItem key={p.id} item={p} onDismiss={() => onDismiss(p.id)} />
      ))}
    </ul>
  );
}

function FeedSection({
  items,
  loading,
  error,
}: {
  items: FeedItemApi[];
  loading: boolean;
  error: string | null;
}) {
  if (loading && items.length === 0)
    return <p className="text-sm text-fg-tertiary">Загружаем…</p>;
  if (error) return <p className="text-sm text-chip-danger-fg">{error}</p>;
  if (items.length === 0) {
    return (
      <div className="rounded-xl bg-bg-overlay/40 p-6 text-center">
        <p className="text-sm text-fg-secondary">Свежих сигналов нет.</p>
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {items.slice(0, 10).map((it) => (
        <FeedItemRow key={it.id} item={it} />
      ))}
    </ul>
  );
}

function ProbesSection({
  items,
  loading,
  error,
}: {
  items: FeedItemApi[];
  loading: boolean;
  error: string | null;
}) {
  if (loading && items.length === 0)
    return <p className="text-sm text-fg-tertiary">Загружаем…</p>;
  if (error) return <p className="text-sm text-chip-danger-fg">{error}</p>;
  if (items.length === 0) {
    return (
      <div className="rounded-xl bg-bg-overlay/40 p-6 text-center">
        <p className="text-sm text-fg-secondary">Уточнений от Коры пока нет.</p>
        <p className="mt-2 text-xs text-fg-tertiary">
          Когда появятся уточняющие вопросы — они будут здесь.
        </p>
      </div>
    );
  }
  return (
    <>
      <ul className="space-y-2">
        {items.slice(0, 10).map((it) => (
          <FeedItemRow key={it.id} item={it} compactDate />
        ))}
      </ul>
      <a
        href="/me/notifications"
        className="mt-3 inline-flex items-center text-xs text-accent hover:underline"
      >
        Все вопросы <ChevronRight size={12} />
      </a>
    </>
  );
}

function AskSection() {
  return (
    <div className="flex h-full flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold text-fg-primary">
          Спросите про вашу компанию
        </h3>
        <p className="mt-1 text-xs text-fg-tertiary">
          AI ищет ответ в архиве встреч и знаний — с цитатами.
        </p>
      </div>
      <div className="flex min-h-[420px] flex-1">
        <OrgChatPanel
          withHistory={false}
          height="100%"
          placeholder="Например: какие основные риски за неделю?"
          className="flex-1"
          intro={
            <div className="px-3 py-6 text-center text-xs text-fg-tertiary">
              Например: «Какие основные риски за неделю?» или «О чём
              договорились с ключевыми клиентами?»
            </div>
          }
        />
      </div>
    </div>
  );
}

function ProactiveItem({
  item,
  onDismiss,
}: {
  item: ProactiveNotificationApi;
  onDismiss: () => void;
}) {
  const severityClass =
    item.severity === "high"
      ? "border-l-chip-danger-fg/60 bg-chip-danger-bg/20"
      : item.severity === "medium"
        ? "border-l-chip-warning-fg/60 bg-chip-warning-bg/20"
        : "border-l-fg-tertiary/30";
  const title =
    (item.payload as { title?: string } | null)?.title ??
    humanizeRule(item.ruleType);
  return (
    <li
      className={cn(
        "group flex items-start gap-2 rounded-md border-l-2 bg-bg-card p-2 shadow-card-soft",
        severityClass,
      )}
    >
      <div className="flex-1 text-xs">
        <div className="font-medium text-fg-primary">{title}</div>
        <div className="mt-0.5 text-[10px] text-fg-tertiary">
          {relativeTime(item.emittedAt)}
        </div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="text-fg-tertiary opacity-40 hover:text-fg-primary hover:opacity-100"
        aria-label="Скрыть"
      >
        <X size={12} />
      </button>
    </li>
  );
}

function FeedItemRow({
  item,
  compactDate,
}: {
  item: FeedItemApi;
  compactDate?: boolean;
}) {
  return (
    <li className="rounded-md bg-bg-card p-2 text-xs shadow-card-soft">
      <div className="font-medium text-fg-primary">{item.title}</div>
      {item.summary && (
        <div className="mt-0.5 line-clamp-2 text-[11px] text-fg-secondary">
          {item.summary}
        </div>
      )}
      {!compactDate && (
        <div className="mt-1 text-[10px] text-fg-tertiary">
          {relativeTime(item.emittedAt)}
        </div>
      )}
    </li>
  );
}

function humanizeRule(ruleType: string): string {
  const map: Record<string, string> = {
    decision_no_owner: "Решение без ответственного",
    insight_no_mitigation: "Сигнал без плана действий",
    experiment_running_too_long: "Эксперимент идёт слишком долго",
    process_stale_review: "Процесс давно не проверяли",
    role_low_completeness: "Роль описана не полностью",
    department_no_domain: "Отдел без области ответственности",
    insights_siloed_in_domain: "Сигналы накапливаются в одной области",
    plan_item_overdue: "Пункт плана просрочен",
  };
  return map[ruleType] ?? ruleType;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин назад`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.floor(h / 24);
  return `${d} дн назад`;
}
