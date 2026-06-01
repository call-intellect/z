'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  ArrowRight,
  HelpCircle,
  Lightbulb,
  ListTodo,
  type LucideIcon,
  MessageSquare,
  Sparkles,
  GitBranch,
  AlertOctagon,
  BookOpenCheck,
  Award,
} from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { activityFeedApi } from '@/api/activity-feed.api';
import {
  feedItemFromApi,
  type FeedItemDomain,
  type FeedType,
} from '@/domain/activity-feed';
import type { ChartTone } from '@/ui/components/dashboard/charts';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { cn } from '@/ui/shadcn/lib/utils';

/**
 * Универсальный feed-виджет (Pulse ТЗ §1.8).
 *
 * v1 (MVP): загружает один feedType (`feedTypes[0]`) одним REST-запросом
 * (`GET /api/v1/feed/:type`). Группирует на клиенте по статусу:
 *   - Активные: emitted / delivered / seen
 *   - Отвечены: responded / actioned
 *   - Истекли/скрыты: dismissed / expired
 *
 * `liveUpdate=true` — polling раз в 60 секунд (WS оставлен на Wave 2/3,
 * см. ТЗ §1.8 «WS подписка при liveUpdate=true (можно МVP: polling»).
 *
 * Используется и в дашборде директора, и (далее) в виджетах спринтов /
 * пользователя — отсюда `scope` + `scopeId` + `feedTypes` пропсы.
 */
export type ActivityFeedWidgetProps = {
  /** Какие типы загружать. v1 берёт `feedTypes[0]`. */
  feedTypes: FeedType[];
  scope?: 'company' | 'team' | 'user';
  scopeId?: string;
  pageSize?: number;
  /** Опрашивать каждые 60s (MVP вместо WS). */
  liveUpdate?: boolean;
  emptyHint?: string;
  /** Куда вести «Все». Default: `/me/notifications`. */
  drillDownHref?: string;
  /** Заголовок виджета. */
  title?: string;
  /** Иконка заголовка. */
  icon?: 'help-circle' | 'message-square';
  className?: string;
};

const POLL_INTERVAL_MS = 60_000;

export function ActivityFeedWidget({
  feedTypes,
  scope = 'company',
  scopeId,
  pageSize = 10,
  liveUpdate = false,
  emptyHint = 'Пока вопросов нет.',
  drillDownHref = '/me/notifications',
  title = 'Вопросы AI команде',
  icon = 'help-circle',
  className,
}: ActivityFeedWidgetProps) {
  const feedType: FeedType = feedTypes[0] ?? 'probe_question';
  const [items, setItems] = useState<FeedItemDomain[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await activityFeedApi.list({
          feedType,
          limit: pageSize,
          scopedToMe: scope === 'user',
          ...(scope === 'team' && scopeId ? { teamId: scopeId } : {}),
        });
        if (!alive) return;
        setItems(res.items.map(feedItemFromApi));
        setTotal(res.total);
        setError(null);
      } catch (e) {
        if (alive) {
          setError(e instanceof ApiError ? e.message : 'Не удалось загрузить');
        }
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    if (liveUpdate) {
      const id = setInterval(() => {
        void load();
      }, POLL_INTERVAL_MS);
      return () => {
        alive = false;
        clearInterval(id);
      };
    }
    return () => {
      alive = false;
    };
  }, [feedType, pageSize, scope, scopeId, liveUpdate]);

  const buckets = groupByStatus(items);
  const Icon = icon === 'message-square' ? MessageSquare : HelpCircle;

  return (
    <Card className={className}>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon size={16} className="text-accent" />
          {title}
        </CardTitle>
        {!loading && !error && (
          <Link
            href={drillDownHref}
            className="flex items-center gap-1 text-xs text-fg-secondary hover:text-accent"
          >
            Все <ArrowRight size={12} />
          </Link>
        )}
      </CardHeader>
      <CardContent>
        {loading && <SkeletonRows />}
        {error && <p className="text-sm text-chip-danger-fg">{error}</p>}
        {!loading && !error && items.length === 0 && (
          <p className="text-sm text-fg-tertiary">{emptyHint}</p>
        )}
        {!loading && !error && items.length > 0 && (
          <div className="space-y-3">
            <div className="text-[11px] uppercase tracking-wide text-fg-tertiary">
              {buckets.active.length} активных ·{' '}
              {buckets.responded.length} отвечены · всего {total}
            </div>
            <Bucket
              title="Активные"
              items={buckets.active}
              drillDownHref={drillDownHref}
              tone="active"
            />
            <Bucket
              title="Отвечены"
              items={buckets.responded}
              drillDownHref={drillDownHref}
              tone="responded"
            />
            <Bucket
              title="Истекли / скрыты"
              items={buckets.expired}
              drillDownHref={drillDownHref}
              tone="expired"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type BucketTone = 'active' | 'responded' | 'expired';

const BUCKET_STYLE: Record<BucketTone, string> = {
  active: 'border-l-accent/60',
  responded: 'border-l-chip-success-fg/40',
  expired: 'border-l-fg-tertiary/30',
};

/**
 * Карта event-type → иконка lucide + цветной тон. Тон — для парного
 * фона `bg-chip-{tone}-bg/15 text-chip-{tone}-fg`.
 */
const FEED_TYPE_VISUAL: Record<FeedType, { Icon: LucideIcon; tone: ChartTone }> = {
  probe_question: { Icon: HelpCircle, tone: 'accent' },
  insight: { Icon: Lightbulb, tone: 'warning' },
  decision: { Icon: GitBranch, tone: 'success' },
  task: { Icon: ListTodo, tone: 'accent' },
  idea: { Icon: Sparkles, tone: 'warning' },
  conflict: { Icon: AlertOctagon, tone: 'danger' },
  knowledge_change: { Icon: BookOpenCheck, tone: 'accent' },
  recognition: { Icon: Award, tone: 'success' },
};

const FEED_ICON_BG: Record<ChartTone, string> = {
  success: 'bg-chip-success-bg/15 text-chip-success-fg',
  warning: 'bg-chip-warning-bg/15 text-chip-warning-fg',
  danger: 'bg-chip-danger-bg/15 text-chip-danger-fg',
  accent: 'bg-accent-muted text-accent',
  neutral: 'bg-bg-overlay text-fg-tertiary',
};

/**
 * Относительное время «5 мин назад» через `date-fns` с локалью ru.
 * `date-fns` уже в `frontend/package.json` — никаких новых зависимостей.
 */
function formatRelativeTime(date: Date): string {
  return formatDistanceToNow(date, { addSuffix: true, locale: ru });
}

function Bucket({
  title,
  items,
  drillDownHref,
  tone,
}: {
  title: string;
  items: FeedItemDomain[];
  drillDownHref: string;
  tone: BucketTone;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-fg-tertiary">
        {title}
      </div>
      <ul className="space-y-1">
        {items.slice(0, 5).map((it) => {
          const visual = FEED_TYPE_VISUAL[it.feedType];
          const Icon = visual?.Icon ?? HelpCircle;
          const iconBg = FEED_ICON_BG[visual?.tone ?? 'neutral'];
          return (
            <li
              key={it.id}
              className={cn(
                'rounded-md border-l-2 bg-bg-overlay/40 px-2 py-1.5',
                BUCKET_STYLE[tone],
              )}
            >
              <Link
                href={drillDownHref}
                className="flex items-start gap-2 text-sm text-fg-primary hover:text-accent"
              >
                <span
                  className={cn(
                    'mt-0.5 inline-flex shrink-0 items-center justify-center rounded-full p-1.5',
                    iconBg,
                  )}
                  aria-hidden="true"
                >
                  <Icon size={12} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {it.title}
                    {it.summary && (
                      <span className="ml-2 text-xs text-fg-tertiary">
                        {truncate(it.summary, 80)}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-fg-tertiary">
                    {formatRelativeTime(it.emittedAtDate)}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function groupByStatus(items: FeedItemDomain[]): {
  active: FeedItemDomain[];
  responded: FeedItemDomain[];
  expired: FeedItemDomain[];
} {
  const active: FeedItemDomain[] = [];
  const responded: FeedItemDomain[] = [];
  const expired: FeedItemDomain[] = [];
  for (const i of items) {
    if (i.status === 'responded' || i.status === 'actioned') {
      responded.push(i);
    } else if (i.status === 'dismissed' || i.status === 'expired') {
      expired.push(i);
    } else {
      active.push(i);
    }
  }
  return { active, responded, expired };
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function SkeletonRows() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-3/4" />
    </div>
  );
}
