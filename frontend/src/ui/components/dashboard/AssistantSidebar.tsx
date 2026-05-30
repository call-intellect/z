'use client';

import { useCallback, useEffect, useState } from 'react';
import { X, Sparkles, AlertTriangle, HelpCircle, ChevronRight } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import {
  proactiveApi,
  type ProactiveNotificationApi,
} from '@/api/proactive.api';
import { activityFeedApi } from '@/api/activity-feed.api';
import type { FeedItemApi } from '@/domain/activity-feed';
import { useAuth } from '@/contexts/auth-context';
import { cn } from '@/ui/shadcn/lib/utils';

/**
 * Pulse §9 — Sidebar Помощник.
 *
 * Floating-panel справа (default closed → FAB-кнопка в правом нижнем углу).
 * Открывается по клику; внутри 3 секции:
 *   1. «Срочное» — proactive notifications (`severity ∈ {medium, high}`).
 *   2. «Из ленты компании» — feed `insight` со `severity ∈ {critical, high}`.
 *   3. «Уточнения от Коры» — feed `probe_question` со `status='emitted'`.
 *
 * Polling каждые 60 сек (WS оставим на следующую волну).
 * Источники объединяются на клиенте: бэк отдаёт два независимых эндпоинта
 * (`GET /me/proactive-notifications` и `GET /feed/:type`), мы дергаем оба
 * в параллель и считаем общий счётчик для FAB-бейджа.
 */
const POLL_MS = 60_000;

export function AssistantSidebar() {
  const { currentOrgId } = useAuth();
  const [open, setOpen] = useState(false);
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
          .list({ feedType: 'probe_question', status: 'emitted', limit: 10 })
          .catch(() => ({
            items: [] as FeedItemApi[],
            total: 0,
            page: 1,
            limit: 10,
            totalPages: 1,
          })),
        activityFeedApi
          .list({ feedType: 'insight', status: 'emitted', limit: 10 })
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
          (i) => i.severity === 'critical' || i.severity === 'high',
        ),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить');
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

  const unreadCount = proactives.length + probes.length + otherUrgent.length;

  const handleDismiss = async (id: string) => {
    if (!currentOrgId) return;
    try {
      await proactiveApi.dismiss(currentOrgId, id);
      setProactives((prev) => prev.filter((p) => p.id !== id));
    } catch {
      // silent — повторный poll через 60s подтянет актуальное состояние
    }
  };

  return (
    <>
      {/* FAB-кнопка */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'fixed bottom-6 right-6 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-fg shadow-lg transition-transform hover:scale-105',
          open && 'rotate-90',
        )}
        aria-label="Помощник компании"
      >
        {open ? <X size={20} /> : <Sparkles size={20} />}
        {!open && unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-chip-danger-bg px-1 text-[10px] font-semibold text-chip-danger-fg">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Sidebar panel */}
      <aside
        className={cn(
          'fixed right-0 top-0 z-30 h-full w-[360px] transform border-l border-border-subtle bg-bg-base shadow-2xl transition-transform duration-200',
          open ? 'translate-x-0' : 'translate-x-full',
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

          <div className="flex-1 overflow-y-auto p-4">
            {loading &&
              proactives.length === 0 &&
              probes.length === 0 &&
              otherUrgent.length === 0 && (
                <p className="text-sm text-fg-tertiary">Загружаем…</p>
              )}
            {error && <p className="text-sm text-chip-danger-fg">{error}</p>}
            {!loading && !error && unreadCount === 0 && (
              <div className="rounded-xl bg-bg-overlay/40 p-6 text-center">
                <p className="text-sm text-fg-secondary">Сейчас всё спокойно.</p>
                <p className="mt-2 text-xs text-fg-tertiary">
                  Кора задаст вопросы и подскажет, когда появится что-то важное.
                </p>
              </div>
            )}

            {proactives.length > 0 && (
              <section className="mb-6">
                <h3 className="mb-2 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-chip-warning-fg">
                  <AlertTriangle size={12} />
                  Срочное ({proactives.length})
                </h3>
                <ul className="space-y-2">
                  {proactives.slice(0, 10).map((p) => (
                    <ProactiveItem
                      key={p.id}
                      item={p}
                      onDismiss={() => void handleDismiss(p.id)}
                    />
                  ))}
                </ul>
              </section>
            )}

            {otherUrgent.length > 0 && (
              <section className="mb-6">
                <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
                  Из ленты компании
                </h3>
                <ul className="space-y-2">
                  {otherUrgent.slice(0, 5).map((it) => (
                    <FeedItemRow key={it.id} item={it} />
                  ))}
                </ul>
              </section>
            )}

            {probes.length > 0 && (
              <section>
                <h3 className="mb-2 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-accent">
                  <HelpCircle size={12} />
                  Уточнения от Коры ({probes.length})
                </h3>
                <ul className="space-y-2">
                  {probes.slice(0, 5).map((it) => (
                    <FeedItemRow key={it.id} item={it} compactDate />
                  ))}
                </ul>
                <a
                  href="/me/notifications"
                  className="mt-3 inline-flex items-center text-xs text-accent hover:underline"
                >
                  Все вопросы <ChevronRight size={12} />
                </a>
              </section>
            )}
          </div>
        </div>
      </aside>
    </>
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
    item.severity === 'high'
      ? 'border-l-chip-danger-fg/60 bg-chip-danger-bg/20'
      : item.severity === 'medium'
        ? 'border-l-chip-warning-fg/60 bg-chip-warning-bg/20'
        : 'border-l-fg-tertiary/30';
  const title =
    (item.payload as { title?: string } | null)?.title ??
    humanizeRule(item.ruleType);
  return (
    <li
      className={cn(
        'group flex items-start gap-2 rounded-md border-l-2 bg-bg-card p-2 shadow-card-soft',
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
    decision_no_owner: 'Решение без ответственного',
    insight_no_mitigation: 'Сигнал без плана действий',
    experiment_running_too_long: 'Эксперимент идёт слишком долго',
    process_stale_review: 'Процесс давно не проверяли',
    role_low_completeness: 'Роль описана не полностью',
    department_no_domain: 'Отдел без области ответственности',
    insights_siloed_in_domain: 'Сигналы накапливаются в одной области',
    plan_item_overdue: 'Пункт плана просрочен',
  };
  return map[ruleType] ?? ruleType;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.floor(h / 24);
  return `${d} дн назад`;
}
