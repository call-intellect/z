'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowRight,
  HelpCircle,
  Lightbulb,
  Loader2,
  MessageCircle,
  RefreshCcw,
  Send,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/api/api-error';
import { chatApi, type ChatCitationApi } from '@/api/chat.api';
import { dashboardApi } from '@/api/dashboard.api';
import { useAuth } from '@/contexts/auth-context';
import {
  THEME_BRANCH_LABELS,
  type ThemeBranch,
} from '@/domain/theme';
import {
  SIGNAL_COUNTERS_BUCKET_COLORS,
  SIGNAL_COUNTERS_BUCKET_LABELS,
  SIGNAL_COUNTERS_BUCKET_ORDER,
  directorDashboardFromApi,
  entityTypeLabel,
  signalTypeLabel,
  type DirectorDashboardDomain,
  type DirectorDashboardEntityDomain,
  type DirectorDashboardOpenQuestionDomain,
  type DirectorDashboardPeriod,
  type DirectorDashboardSignalCountersDomain,
  type DirectorDashboardSignalDomain,
  type DirectorDashboardThemeDomain,
} from '@/domain/director-dashboard';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Input } from '@/ui/shadcn/input';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { cn } from '@/ui/shadcn/lib/utils';
import { AiTypingDots } from '@/ui/components/ai/AiTypingDots';

/**
 * Дашборд директора (knowledge-core, Фаза 8).
 *
 * Источник правды: `GET /api/v1/dashboard/director?period=week|month`
 * (см. `backend/src/modules/dashboard/`).
 *
 * Доступ: owner / admin / super_admin. Splitting роли на manager-вид и
 * директорский вид делается выше — в `dashboard/page.tsx`.
 *
 * Структура:
 *   - Header с приветствием, переключателем периода и «Обновить».
 *   - Опциональная narrativeSummary (LLM-сводка «Главное за период»).
 *   - 5 виджетов на сетке: новые темы+сигналы, счётчики сигналов,
 *     активные темы, главные сущности, открытые вопросы.
 *   - Inline org-chat внизу (на Фазе 8 шаг 5 будет вынесен в OrgChatPanel).
 *   - Зарезервировано место для виджета «Согласованность стратегии» (Phase 9).
 */
export function DirectorDashboardClient() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<DirectorDashboardPeriod>('week');
  const [data, setData] = useState<DirectorDashboardDomain | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (nextPeriod: DirectorDashboardPeriod) => {
      setLoading(true);
      setError(null);
      try {
        const res = await dashboardApi.getDirectorView(nextPeriod);
        setData(directorDashboardFromApi(res));
      } catch (e) {
        const message =
          e instanceof ApiError ? e.message : 'Не удалось загрузить дашборд';
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(period);
  }, [period, load]);

  const greetingName = useMemo(() => {
    return user?.name?.trim() || user?.email?.split('@')[0] || 'друг';
  }, [user]);

  const periodLabel = period === 'week' ? 'неделю' : 'месяц';

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <header className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
            Привет, {greetingName}
          </h1>
          <p className="mt-1 text-sm text-fg-secondary">
            Срез знаний компании за {periodLabel}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PeriodSwitch value={period} onChange={setPeriod} disabled={loading} />
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load(period)}
            disabled={loading}
            aria-label="Обновить"
          >
            {loading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCcw size={14} />
            )}
            <span className="ml-1.5">Обновить</span>
          </Button>
        </div>
      </header>

      {error && (
        <div className="mb-6 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {data?.narrativeSummary && (
        <div className="mb-6 rounded-xl border border-accent/30 bg-accent/5 p-4">
          <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-accent">
            <Sparkles size={14} />
            AI-сводка за {periodLabel}
          </div>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg-primary">
            {data.narrativeSummary}
          </p>
          <p className="mt-2 text-[11px] text-fg-tertiary">
            AI-сводка, может содержать ошибки.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <WhatLearnedWidget
          loading={loading}
          newThemes={data?.newThemes ?? []}
          newSignals={data?.newSignals ?? []}
          periodLabel={periodLabel}
        />
        <SignalCountersWidget
          loading={loading}
          counters={data?.signalCounters ?? null}
        />
        <ActiveThemesWidget
          loading={loading}
          themes={data?.activeThemes ?? []}
        />
        <HotEntitiesWidget
          loading={loading}
          entities={data?.hotEntities ?? []}
        />
        <OpenQuestionsWidget
          loading={loading}
          questions={data?.openQuestions ?? []}
        />
        {/* TODO Phase 9 strategicAlignment widget here */}
      </div>

      <OrgChatInlinePanel />
    </div>
  );
}

// ─── Period switch ──────────────────────────────────────────────────────────

function PeriodSwitch({
  value,
  onChange,
  disabled,
}: {
  value: DirectorDashboardPeriod;
  onChange: (p: DirectorDashboardPeriod) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex items-center rounded-md border border-border-subtle bg-bg-card p-0.5 text-sm">
      {(['week', 'month'] as const).map((p) => (
        <button
          key={p}
          type="button"
          disabled={disabled}
          onClick={() => onChange(p)}
          className={cn(
            'rounded-sm px-3 py-1 transition-colors',
            value === p
              ? 'bg-accent text-accent-fg'
              : 'text-fg-secondary hover:text-fg-primary',
            disabled && 'opacity-50',
          )}
        >
          {p === 'week' ? 'Неделя' : 'Месяц'}
        </button>
      ))}
    </div>
  );
}

// ─── Widget: «Что узнали за период» ─────────────────────────────────────────

function WhatLearnedWidget({
  loading,
  newThemes,
  newSignals,
  periodLabel,
}: {
  loading: boolean;
  newThemes: DirectorDashboardThemeDomain[];
  newSignals: DirectorDashboardSignalDomain[];
  periodLabel: string;
}) {
  return (
    <Card className="lg:col-span-2">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Lightbulb size={16} className="text-accent" />
          Что узнали за {periodLabel}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-tertiary">
              Новые темы
            </h3>
            {loading && <SkeletonList />}
            {!loading && newThemes.length === 0 && (
              <EmptyHint text="Пока недостаточно данных. Появятся, как только AI-кластеризатор обработает новые блоки." />
            )}
            {!loading &&
              newThemes.length > 0 &&
              newThemes.slice(0, 10).map((t) => (
                <Link
                  key={t.id}
                  href={`/themes/${encodeURIComponent(t.id)}`}
                  className="block rounded-md p-2 text-sm hover:bg-bg-overlay"
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-fg-primary">
                      {t.name}
                    </span>
                    {t.dynamic === 'growing' && (
                      <span aria-label="растёт" title="Растёт">
                        📈
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-fg-tertiary">
                    {t.branch && (
                      <span>{THEME_BRANCH_LABELS[t.branch as ThemeBranch]}</span>
                    )}
                    <span>· {t.blocksCount} блоков</span>
                  </div>
                </Link>
              ))}
          </div>
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-fg-tertiary">
              Новые сигналы
            </h3>
            {loading && <SkeletonList />}
            {!loading && newSignals.length === 0 && (
              <EmptyHint text="Сигналов высокой важности за период не зафиксировано." />
            )}
            {!loading &&
              newSignals.length > 0 &&
              newSignals.slice(0, 10).map((s) => {
                const linkable = s.evidenceMeetingId !== null;
                const inner = (
                  <div className="rounded-md p-2 text-sm hover:bg-bg-overlay">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-[10px]">
                        {signalTypeLabel(s.signalType)}
                      </Badge>
                      <span className="truncate text-fg-primary">{s.name}</span>
                    </div>
                    {s.criticalQuestion && (
                      <p className="mt-1 line-clamp-2 text-xs text-fg-tertiary">
                        {s.criticalQuestion}
                      </p>
                    )}
                  </div>
                );
                if (!linkable) {
                  return (
                    <div key={s.id} className="opacity-90">
                      {inner}
                    </div>
                  );
                }
                return (
                  <Link
                    key={s.id}
                    href={`/meetings/${encodeURIComponent(
                      s.evidenceMeetingId!,
                    )}/result?block=${encodeURIComponent(s.id)}`}
                    className="block"
                  >
                    {inner}
                  </Link>
                );
              })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Widget: «Сигналы клиентов» ─────────────────────────────────────────────

function SignalCountersWidget({
  loading,
  counters,
}: {
  loading: boolean;
  counters: DirectorDashboardSignalCountersDomain | null;
}) {
  const max = useMemo(() => {
    if (!counters) return 0;
    return SIGNAL_COUNTERS_BUCKET_ORDER.reduce(
      (acc, key) => Math.max(acc, counters[key] ?? 0),
      0,
    );
  }, [counters]);

  const total = useMemo(() => {
    if (!counters) return 0;
    return SIGNAL_COUNTERS_BUCKET_ORDER.reduce(
      (acc, key) => acc + (counters[key] ?? 0),
      0,
    );
  }, [counters]);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp size={16} className="text-accent" />
          Сигналы клиентов
        </CardTitle>
        {!loading && counters && (
          <Badge variant="secondary">{total}</Badge>
        )}
      </CardHeader>
      <CardContent>
        {loading && <SkeletonList />}
        {!loading && counters && total === 0 && (
          <EmptyHint text="Сигналов от клиентов за период не зафиксировано." />
        )}
        {!loading && counters && total > 0 && (
          <ul className="space-y-2">
            {SIGNAL_COUNTERS_BUCKET_ORDER.map((key) => {
              const v = counters[key] ?? 0;
              const pct = max > 0 ? Math.max(2, Math.round((v / max) * 100)) : 0;
              return (
                <li key={key} className="flex items-center gap-3 text-sm">
                  <div className="w-32 shrink-0 truncate text-fg-secondary">
                    {SIGNAL_COUNTERS_BUCKET_LABELS[key]}
                  </div>
                  <div className="relative flex-1 overflow-hidden rounded-full bg-bg-overlay/60">
                    <div
                      className={cn(
                        'h-2 rounded-full',
                        SIGNAL_COUNTERS_BUCKET_COLORS[key],
                      )}
                      style={{ width: v > 0 ? `${pct}%` : '0%' }}
                    />
                  </div>
                  <div className="w-8 shrink-0 text-right text-xs tabular-nums text-fg-secondary">
                    {v}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {!loading && counters && total > 0 && (
          <p
            className="mt-3 text-xs text-fg-tertiary"
            title="Открытие подборки по типу сигнала появится в следующих версиях"
          >
            Подборка по типу сигнала — vNext.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Widget: «Активные темы» ────────────────────────────────────────────────

function ActiveThemesWidget({
  loading,
  themes,
}: {
  loading: boolean;
  themes: DirectorDashboardThemeDomain[];
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp size={16} className="text-accent" />
          Активные темы
        </CardTitle>
        {!loading && <Badge variant="secondary">{themes.length}</Badge>}
      </CardHeader>
      <CardContent className="space-y-1">
        {loading && <SkeletonList />}
        {!loading && themes.length === 0 && (
          <EmptyHint text="Растущих тем сейчас нет." />
        )}
        {!loading &&
          themes.slice(0, 10).map((t) => (
            <Link
              key={t.id}
              href={`/themes/${encodeURIComponent(t.id)}`}
              className="block rounded-md p-2 text-sm hover:bg-bg-overlay"
            >
              <div className="flex items-center gap-2">
                <span className="truncate font-medium text-fg-primary">
                  {t.name}
                </span>
                {t.dynamic === 'growing' && (
                  <span aria-label="растёт" title="Растёт">
                    📈
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-fg-tertiary">
                {t.branch && (
                  <span>{THEME_BRANCH_LABELS[t.branch as ThemeBranch]}</span>
                )}
                <span>· {t.blocksCount} блоков</span>
              </div>
            </Link>
          ))}
        {!loading && themes.length > 0 && (
          <Button asChild variant="ghost" size="sm" className="w-full justify-between">
            <Link href="/themes">
              Все темы
              <ArrowRight size={14} />
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Widget: «Главные сущности» ─────────────────────────────────────────────

function HotEntitiesWidget({
  loading,
  entities,
}: {
  loading: boolean;
  entities: DirectorDashboardEntityDomain[];
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Users size={16} className="text-accent" />
          Главные сущности
        </CardTitle>
        {!loading && <Badge variant="secondary">{entities.length}</Badge>}
      </CardHeader>
      <CardContent className="space-y-1">
        {loading && <SkeletonList />}
        {!loading && entities.length === 0 && (
          <EmptyHint text="Сущностей с заметным ростом упоминаний за период нет." />
        )}
        {!loading &&
          entities.slice(0, 10).map((e) => (
            <div
              key={e.id}
              className="flex items-center justify-between gap-2 rounded-md p-2 text-sm"
              title="Страница сущности — vNext"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium text-fg-primary">
                  {e.canonicalName}
                </span>
                <Badge variant="outline" className="text-[10px]">
                  {entityTypeLabel(e.type)}
                </Badge>
              </div>
              <span className="shrink-0 text-xs text-fg-tertiary">
                {e.recentMentions} упом.
              </span>
            </div>
          ))}
      </CardContent>
    </Card>
  );
}

// ─── Widget: «Открытые вопросы» ─────────────────────────────────────────────

function OpenQuestionsWidget({
  loading,
  questions,
}: {
  loading: boolean;
  questions: DirectorDashboardOpenQuestionDomain[];
}) {
  return (
    <Card className="lg:col-span-2">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <HelpCircle size={16} className="text-accent" />
          Открытые вопросы
        </CardTitle>
        {!loading && <Badge variant="secondary">{questions.length}</Badge>}
      </CardHeader>
      <CardContent className="space-y-2">
        {loading && <SkeletonList />}
        {!loading && questions.length === 0 && (
          <EmptyHint text="Открытых вопросов (knowledge_gap) пока нет." />
        )}
        {!loading &&
          questions.slice(0, 10).map((q) => (
            <div
              key={q.id}
              className="rounded-md border border-border-subtle/60 p-3 text-sm"
            >
              <p className="font-medium text-fg-primary">
                {q.criticalQuestion || q.name}
              </p>
              <p className="mt-1 text-xs text-fg-tertiary">
                Зафиксировано{' '}
                {q.createdAt.toLocaleDateString('ru', {
                  day: '2-digit',
                  month: 'short',
                })}
              </p>
            </div>
          ))}
      </CardContent>
    </Card>
  );
}

// ─── Skeleton helpers ───────────────────────────────────────────────────────

function SkeletonList() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-3/4" />
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="text-sm text-fg-tertiary">{text}</p>;
}

// ─── Inline OrgChat panel (Шаг 5 заменит на <OrgChatPanel withHistory={false}/>). ─

type InlineMsg =
  | { id: string; role: 'user'; content: string }
  | {
      id: string;
      role: 'assistant';
      content: string;
      citations: ChatCitationApi[];
    };

function OrgChatInlinePanel() {
  const [messages, setMessages] = useState<InlineMsg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    const localId = `local-${Date.now()}`;
    setMessages((prev) => [...prev, { id: localId, role: 'user', content: text }]);
    setInput('');
    try {
      let answer: { message: string; citations: ChatCitationApi[] };
      try {
        const res = await chatApi.askV2({ scope: 'org', query: text });
        answer = { message: res.message, citations: res.citations };
      } catch (e) {
        if (e instanceof ApiError && e.code === 'chat_v2_disabled') {
          const res = await chatApi.sendGlobal({ message: text });
          answer = { message: res.message, citations: res.citations };
        } else {
          throw e;
        }
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `ai-${Date.now()}`,
          role: 'assistant',
          content: answer.message,
          citations: answer.citations,
        },
      ]);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Чат недоступен';
      toast.error(msg);
    } finally {
      setSending(false);
    }
  }, [input, sending]);

  return (
    <section className="mt-8 rounded-xl border border-border-subtle bg-bg-elevated">
      <header className="flex items-center gap-2 border-b border-border-subtle p-3">
        <MessageCircle size={16} className="text-accent" />
        <div>
          <h2 className="text-sm font-semibold text-fg-primary">
            Спросите про вашу компанию
          </h2>
          <p className="text-xs text-fg-tertiary">
            AI ищет ответ в архиве встреч и знаний организации, отвечает с цитатами.
          </p>
        </div>
      </header>
      <div className="flex max-h-[400px] flex-col">
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <div className="text-center text-xs text-fg-tertiary">
              Например: «Какие основные риски за неделю?» или «О чём договорились с
              ключевыми клиентами?»
            </div>
          ) : (
            messages.map((m) => <ChatBubble key={m.id} message={m} />)
          )}
          {sending && (
            <div className="flex justify-start">
              <div className="rounded-2xl bg-bg-overlay px-3 py-2">
                <AiTypingDots />
              </div>
            </div>
          )}
        </div>
        <div className="border-t border-border-subtle p-3">
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder="Задайте вопрос…"
              disabled={sending}
            />
            <Button onClick={() => void send()} disabled={sending || !input.trim()}>
              {sending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Send size={14} />
              )}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function ChatBubble({ message }: { message: InlineMsg }) {
  const isUser = message.role === 'user';
  return (
    <div className={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] rounded-2xl px-3 py-2 text-sm',
          isUser ? 'bg-accent text-accent-fg' : 'bg-bg-overlay text-fg-primary',
        )}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>
        {message.role === 'assistant' && message.citations.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {message.citations.map((c, i) => (
              <Link
                key={`${c.meetingId}-${c.startMs}-${i}`}
                href={`/meetings/${encodeURIComponent(c.meetingId)}/result`}
                className="inline-flex max-w-full items-center rounded-full border border-border-subtle bg-bg-elevated px-2 py-0.5 text-xs text-fg-secondary hover:border-accent/60 hover:text-accent"
                title={c.snippet}
              >
                <span className="truncate">{c.meetingTitle ?? 'Встреча'}</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
