'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CalendarDays,
  Clock,
  Loader2,
  MessageSquare,
  Send,
  Sparkles,
} from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { chatApi, type ChatCitationApi } from '@/api/chat.api';
import { meetingsApi } from '@/api/meetings.api';
import { tasksApi, type TaskApi } from '@/api/tasks.api';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/contexts/toast-context';
import type { MeetingSummaryApi } from '@/domain/meeting';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Input } from '@/ui/shadcn/input';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { cn } from '@/ui/shadcn/lib/utils';

type DashboardData = {
  loading: boolean;
  meetingsToday: MeetingSummaryApi[];
  meetings30d: MeetingSummaryApi[];
  tasksWeek: TaskApi[];
  tasksOpenTotal: number;
  tasksOpen: TaskApi[];
};

const INITIAL: DashboardData = {
  loading: true,
  meetingsToday: [],
  meetings30d: [],
  tasksWeek: [],
  tasksOpenTotal: 0,
  tasksOpen: [],
};

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('ru', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });
}

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
}

export function DashboardClient() {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const now = new Date();
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
      const weekFromNow = new Date(startOfToday.getTime() + 7 * 24 * 60 * 60 * 1000);

      try {
        const [meetingsRes, tasksOpenRes, tasksWeekRes] = await Promise.all([
          meetingsApi.list({ limit: 50 }),
          tasksApi.list({ status: ['open', 'in_progress'], limit: 5 }),
          tasksApi.list({
            status: ['open', 'in_progress'],
            dueBefore: weekFromNow.toISOString(),
            limit: 5,
          }),
        ]);
        if (cancelled) return;
        const meetingsToday = meetingsRes.items.filter((m) => {
          const ts = m.startedAt ?? m.createdAt;
          if (!ts) return false;
          const d = new Date(ts);
          return d >= startOfToday && d < endOfToday;
        });
        // последние 30 дней — для статистики
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const meetings30d = meetingsRes.items.filter((m) => {
          const ts = m.endedAt ?? m.startedAt ?? m.createdAt;
          if (!ts) return false;
          return new Date(ts) >= thirtyDaysAgo;
        });
        setData({
          loading: false,
          meetingsToday,
          meetings30d,
          tasksWeek: tasksWeekRes.items,
          tasksOpenTotal: tasksOpenRes.total,
          tasksOpen: tasksOpenRes.items,
        });
      } catch {
        if (cancelled) return;
        setData({ ...INITIAL, loading: false });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    const recordedSeconds = data.meetings30d.reduce(
      (acc, m) => acc + (typeof m.durationMs === 'number' ? Math.round(m.durationMs / 1000) : 0),
      0,
    );
    return {
      meetingsCount: data.meetings30d.length,
      minutes: Math.round(recordedSeconds / 60),
    };
  }, [data.meetings30d]);

  const greetingName = user?.name?.trim() || user?.email?.split('@')[0] || 'друг';

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
          Привет, {greetingName}
        </h1>
        <p className="mt-1 text-sm text-fg-secondary">{formatDate(new Date())}</p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <WidgetToday loading={data.loading} meetings={data.meetingsToday} />
        <WidgetWeek loading={data.loading} tasks={data.tasksWeek} />
        <WidgetOpenTasks
          loading={data.loading}
          tasks={data.tasksOpen}
          total={data.tasksOpenTotal}
        />
        <WidgetStats
          loading={data.loading}
          meetingsCount={stats.meetingsCount}
          minutes={stats.minutes}
          tasksCount={data.tasksOpenTotal}
        />
      </div>

      <CrossChat />
    </div>
  );
}

function WidgetToday({
  loading,
  meetings,
}: {
  loading: boolean;
  meetings: MeetingSummaryApi[];
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarDays size={16} className="text-accent" /> Сегодня
        </CardTitle>
        <Badge variant="secondary">{meetings.length}</Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading && <Skeleton className="h-16 w-full" />}
        {!loading && meetings.length === 0 && (
          <p className="text-sm text-fg-tertiary">Сегодня встреч нет.</p>
        )}
        {!loading &&
          meetings.slice(0, 5).map((m) => (
            <Link
              key={m.id}
              href={`/meetings/${encodeURIComponent(m.id)}/result`}
              className="flex items-center gap-2 rounded-md p-2 text-sm hover:bg-bg-overlay"
            >
              <span className="truncate flex-1 text-fg-primary">{m.title}</span>
              <span className="text-xs text-fg-tertiary">
                {formatTime(m.startedAt ?? m.createdAt)}
              </span>
            </Link>
          ))}
        <Button asChild variant="ghost" size="sm" className="w-full justify-between">
          <Link href="/meetings">
            Открыть журнал
            <ArrowRight size={14} />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function WidgetWeek({
  loading,
  tasks,
}: {
  loading: boolean;
  tasks: TaskApi[];
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock size={16} className="text-accent" /> На неделе
        </CardTitle>
        <Badge variant="secondary">{tasks.length}</Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading && <Skeleton className="h-16 w-full" />}
        {!loading && tasks.length === 0 && (
          <p className="text-sm text-fg-tertiary">Задач со сроком на этой неделе нет.</p>
        )}
        {!loading &&
          tasks.slice(0, 3).map((t) => (
            <div key={t.id} className="rounded-md p-2 text-sm hover:bg-bg-overlay">
              <div className="truncate text-fg-primary">{t.title}</div>
              <div className="text-xs text-fg-tertiary">
                {t.dueDate
                  ? `до ${new Date(t.dueDate).toLocaleDateString('ru', {
                      day: '2-digit',
                      month: '2-digit',
                    })}`
                  : 'без срока'}
              </div>
            </div>
          ))}
      </CardContent>
    </Card>
  );
}

function WidgetOpenTasks({
  loading,
  tasks,
  total,
}: {
  loading: boolean;
  tasks: TaskApi[];
  total: number;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquare size={16} className="text-accent" /> Открытые задачи
        </CardTitle>
        <Badge variant="default">{total}</Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading && <Skeleton className="h-16 w-full" />}
        {!loading && tasks.length === 0 && (
          <p className="text-sm text-fg-tertiary">Открытых задач нет.</p>
        )}
        {!loading &&
          tasks.slice(0, 3).map((t) => (
            <Link
              key={t.id}
              href={`/meetings/${encodeURIComponent(t.meetingId)}/result`}
              className="block truncate rounded-md p-2 text-sm text-fg-primary hover:bg-bg-overlay"
            >
              {t.title}
            </Link>
          ))}
        <Button asChild variant="ghost" size="sm" className="w-full justify-between">
          <Link href="/tasks">
            Все задачи
            <ArrowRight size={14} />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function WidgetStats({
  loading,
  meetingsCount,
  minutes,
  tasksCount,
}: {
  loading: boolean;
  meetingsCount: number;
  minutes: number;
  tasksCount: number;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles size={16} className="text-accent" /> За 30 дней
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-16 w-full" />
        ) : (
          <div className="grid grid-cols-3 gap-3 text-center">
            <Stat label="встреч" value={meetingsCount} />
            <Stat label="минут" value={minutes} />
            <Stat label="откр. задач" value={tasksCount} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-bg-overlay/50 p-3">
      <div className="text-2xl font-semibold text-fg-primary">{value}</div>
      <div className="text-xs text-fg-tertiary">{label}</div>
    </div>
  );
}

type CrossChatAnswer = { message: string; citations: ChatCitationApi[] } | null;

function CrossChat() {
  const { addToast } = useToast();
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [answer, setAnswer] = useState<CrossChatAnswer>(null);

  const handleSubmit = useCallback(async () => {
    if (!message.trim()) return;
    setSubmitting(true);
    setAnswer(null);
    try {
      const res = await chatApi.sendGlobal({ message: message.trim() });
      setAnswer({ message: res.message, citations: res.citations });
      setMessage('');
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiError ? e.message : 'Чат недоступен',
      });
    } finally {
      setSubmitting(false);
    }
  }, [addToast, message]);

  return (
    <div className="mt-8 rounded-lg border border-border-subtle bg-bg-card p-4">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg-primary">
        <Sparkles size={14} className="text-accent" />
        Спросить по всем встречам
      </h2>
      <p className="mb-3 text-xs text-fg-tertiary">
        Cross-meeting AI-чат: ищет ответ в архиве ваших встреч с цитированием источников.
      </p>
      <div className="flex gap-2">
        <Input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Например: что обсуждали с Acme на прошлой неделе?"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void handleSubmit();
            }
          }}
          disabled={submitting}
        />
        <Button
          onClick={() => void handleSubmit()}
          disabled={submitting || !message.trim()}
        >
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          Спросить
        </Button>
      </div>

      {answer && (
        <div
          className={cn(
            'mt-4 rounded-md border border-border-subtle bg-bg-overlay/50 p-3 text-sm text-fg-primary',
          )}
        >
          <div className="whitespace-pre-wrap">{answer.message}</div>
          {answer.citations.length > 0 && (
            <div className="mt-2 text-xs text-fg-tertiary">
              Источников: {answer.citations.length}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
