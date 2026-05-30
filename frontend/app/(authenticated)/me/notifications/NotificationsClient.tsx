'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { Loader2, Send, X, MessageSquarePlus, MessageSquare, Sparkles } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import {
  createFreeNote,
  dismissNotification,
  getMyNotification,
  listMyNotifications,
  markNotificationRead,
  respondToNotification,
} from '@/api/conversational.api';
import {
  dismissProactiveNotification,
  listMyProactiveNotifications,
} from '@/api/proactive.api';
import {
  mapNotification,
  mapNotificationDetail,
  type Notification,
} from '@/domain/conversational';
import {
  mapProactiveNotification,
  type ProactiveNotification,
} from '@/domain/proactive';
import { useAuth } from '@/contexts/auth-context';
import { toast } from 'sonner';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { Textarea } from '@/ui/shadcn/textarea';
import { ProbeAnswerInput } from '@/ui/components/probe/ProbeAnswerInput';

type Filter = 'unread' | 'pending_response' | 'all';
type Tab = 'inbox' | 'proactive';

const FILTER_LABELS: Record<Filter, string> = {
  unread: 'Непрочитанные',
  pending_response: 'Ждут ответа',
  all: 'Все',
};

const TAB_LABELS: Record<Tab, string> = {
  inbox: 'Входящие',
  proactive: 'Проактивные',
};

export function NotificationsClient() {
  const { currentOrgId, isLoading } = useAuth();
  const [tab, setTab] = useState<Tab>('inbox');
  const [filter, setFilter] = useState<Filter>('unread');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const listKey = currentOrgId
    ? ['my-notifications', currentOrgId, filter]
    : null;
  const { data: listData, error: listError, isLoading: listLoading } = useSWR(
    listKey,
    async () => {
      const res = await listMyNotifications(currentOrgId!, { status: filter });
      return res.items.map(mapNotification);
    },
  );

  const detailKey =
    currentOrgId && selectedId
      ? ['my-notification', currentOrgId, selectedId]
      : null;
  const { data: detail, isLoading: detailLoading } = useSWR(
    detailKey,
    async () => {
      const res = await getMyNotification(currentOrgId!, selectedId!);
      return mapNotificationDetail(res);
    },
  );

  if (isLoading) return null;
  if (!currentOrgId) {
    return (
      <section className="p-6">
        <p className="text-muted-foreground">
          Этот раздел доступен только в рамках организации.
        </p>
      </section>
    );
  }

  return (
    <section className="container mx-auto max-w-6xl space-y-4 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Уведомления</h1>
        <p className="text-sm text-muted-foreground">
          Здесь Кора задаёт уточняющие вопросы, зовёт на модерацию карточек и
          сама подсвечивает вещи, которые могла бы посмотреть. Ответы
          возвращаются обратно в память компании.
        </p>
      </header>

      <div className="flex flex-wrap gap-2 border-b pb-2">
        {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
          <Button
            key={t}
            variant={tab === t ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setTab(t)}
          >
            {t === 'proactive' && <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
            {TAB_LABELS[t]}
          </Button>
        ))}
      </div>

      {tab === 'proactive' && (
        <ProactivePanel orgId={currentOrgId} />
      )}

      {tab === 'inbox' && (
        <div className="flex flex-wrap gap-2">
          {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => (
            <Button
              key={f}
              variant={filter === f ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter(f)}
            >
              {FILTER_LABELS[f]}
            </Button>
          ))}
        </div>
      )}

      {tab === 'inbox' && (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_2fr]">
        <div className="space-y-2">
          {listLoading && (
            <>
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </>
          )}
          {listError instanceof Error && (
            <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm">
              Ошибка: {listError.message}
            </div>
          )}
          {!listLoading && listData && listData.length === 0 && (
            <Card>
              <CardContent className="p-4 text-sm text-muted-foreground">
                Пока тихо — уведомлений в этом фильтре нет.
              </CardContent>
            </Card>
          )}
          {listData?.map((n) => (
            <NotificationRow
              key={n.id}
              n={n}
              active={selectedId === n.id}
              onClick={() => {
                setSelectedId(n.id);
                if (n.status === 'queued' || n.status === 'delivered' || n.status === 'sent_partial') {
                  void markNotificationRead(n.id).then(() => mutate(listKey));
                }
              }}
            />
          ))}
        </div>

        <div>
          {!selectedId && (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                Выберите уведомление слева, чтобы открыть детали.
              </CardContent>
            </Card>
          )}
          {selectedId && detailLoading && (
            <Card>
              <CardContent className="p-6">
                <Loader2 className="h-4 w-4 animate-spin" />
              </CardContent>
            </Card>
          )}
          {detail && (
            <NotificationDetail
              n={detail}
              onChanged={async () => {
                await mutate(detailKey);
                await mutate(listKey);
              }}
            />
          )}
        </div>
      </div>
      )}

      {tab === 'inbox' && (
        <FreeNoteCard orgId={currentOrgId} onCreated={() => mutate(listKey)} />
      )}
    </section>
  );
}

function NotificationRow({
  n,
  active,
  onClick,
}: {
  n: Notification;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`block w-full rounded-md border p-3 text-left transition hover:bg-muted ${
        active ? 'border-primary bg-muted' : 'border-border'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{n.eventTypeLabel}</span>
        {n.needsResponse && (
          <Badge variant="default" className="text-[10px]">
            нужен ответ
          </Badge>
        )}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {n.statusLabel} · {n.createdAt.toLocaleString('ru-RU')}
      </div>
    </button>
  );
}

function NotificationDetail({
  n,
  onChanged,
}: {
  n: ReturnType<typeof mapNotificationDetail>;
  onChanged: () => Promise<void>;
}) {
  const [responseText, setResponseText] = useState('');
  const [busy, setBusy] = useState<'respond' | 'dismiss' | null>(null);

  const payload = n.payload as {
    question?: string;
    /** Agents v2 Фаза 0.2 — сама строка вопроса, сформулированная LLM. */
    formulatedQuestion?: string;
    context?: string;
    summary?: string;
    resourceType?: string;
    title?: string;
    body?: string;
  };

  // Для probe.question рендерим компонент свободного ввода без inline-кнопок
  // (правило [[probe-no-buttons-text-voice-only]]). Старый textarea остаётся
  // для остальных типов уведомлений, где ответ — это просто текст.
  const isProbeQuestion = n.eventType === 'probe.question';
  const probeQuestion =
    payload.formulatedQuestion?.trim() || payload.question?.trim() || '';

  async function handleRespond() {
    if (!responseText.trim()) return;
    setBusy('respond');
    try {
      await respondToNotification(n.id, { text: responseText.trim() });
      setResponseText('');
      await onChanged();
    } catch (e) {
      if (e instanceof ApiError) toast.error(`Не удалось отправить ответ: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  async function handleProbeSubmit(answer: string): Promise<void> {
    setBusy('respond');
    try {
      // Backend `ProbeResponseHandler.extractResponseText` принимает любой из
      // ключей `text|response|body|answer` — посылаем `response` как явный
      // probe-ответ (ТЗ §«Probe без кнопок» / Frontend §Phase 0.3).
      await respondToNotification(n.id, { response: answer });
      await onChanged();
    } catch (e) {
      if (e instanceof ApiError) toast.error(`Не удалось отправить ответ: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  async function handleDismiss() {
    setBusy('dismiss');
    try {
      await dismissNotification(n.id);
      await onChanged();
    } catch (e) {
      if (e instanceof ApiError) toast.error(`Не удалось пропустить: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {n.eventTypeLabel}
          <Badge variant="secondary">{n.statusLabel}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {/* Для probe.question вопрос рендерим внутри ProbeAnswerInput ниже,
            тут не дублируем. Для остальных типов — обычный блок «Вопрос». */}
        {!isProbeQuestion && payload.question && (
          <div>
            <div className="text-xs uppercase text-muted-foreground">Вопрос</div>
            <p className="whitespace-pre-wrap">{payload.question}</p>
          </div>
        )}
        {payload.context && (
          <div>
            <div className="text-xs uppercase text-muted-foreground">Контекст</div>
            <p className="whitespace-pre-wrap">{payload.context}</p>
          </div>
        )}
        {payload.summary && (
          <div>
            <div className="text-xs uppercase text-muted-foreground">
              Карточка{payload.resourceType ? ` (${payload.resourceType})` : ''}
            </div>
            <p className="whitespace-pre-wrap">{payload.summary}</p>
          </div>
        )}
        {payload.title && (
          <div>
            <div className="text-xs uppercase text-muted-foreground">Заголовок</div>
            <p className="whitespace-pre-wrap font-medium">{payload.title}</p>
          </div>
        )}
        {payload.body && <p className="whitespace-pre-wrap">{payload.body}</p>}

        {n.needsResponse && isProbeQuestion && probeQuestion && (
          <div className="space-y-2">
            <ProbeAnswerInput
              question={probeQuestion}
              onSubmit={handleProbeSubmit}
              isSubmitting={busy === 'respond'}
              voiceEnabled={true}
            />
            <div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleDismiss}
                disabled={busy === 'dismiss'}
              >
                {busy === 'dismiss' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <X className="mr-2 h-4 w-4" />
                )}
                Пропустить
              </Button>
            </div>
          </div>
        )}

        {n.needsResponse && !(isProbeQuestion && probeQuestion) && (
          <div className="space-y-2 rounded-md border border-dashed p-3">
            <label className="text-xs uppercase text-muted-foreground">
              Ваш ответ
            </label>
            <Textarea
              rows={3}
              value={responseText}
              onChange={(e) => setResponseText(e.target.value)}
              placeholder="Напишите ответ…"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleRespond}
                disabled={busy === 'respond' || !responseText.trim()}
              >
                {busy === 'respond' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                Ответить
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleDismiss}
                disabled={busy === 'dismiss'}
              >
                {busy === 'dismiss' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <X className="mr-2 h-4 w-4" />
                )}
                Пропустить
              </Button>
            </div>
          </div>
        )}

        {n.responsePayload && (
          <div>
            <div className="text-xs uppercase text-muted-foreground">
              Ваш ответ ({n.respondedAt?.toLocaleString('ru-RU') ?? '—'})
            </div>
            <pre className="whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">
              {JSON.stringify(n.responsePayload, null, 2)}
            </pre>
          </div>
        )}

        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">История доставок</summary>
          <ul className="mt-2 space-y-1">
            {n.deliveries.map((d) => (
              <li key={d.id} className="flex justify-between font-mono">
                <span>
                  {d.status} · попыток: {d.attempts}
                </span>
                <span>{d.attemptedAt.toLocaleString('ru-RU')}</span>
              </li>
            ))}
          </ul>
        </details>
      </CardContent>
    </Card>
  );
}

function FreeNoteCard({
  orgId,
  onCreated,
}: {
  orgId: string;
  onCreated: () => Promise<unknown> | void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await createFreeNote(orgId, text.trim());
      setText('');
      await onCreated();
      toast.success('Заметка отправлена в память компании.');
    } catch (e) {
      if (e instanceof ApiError) toast.error(`Не удалось отправить: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquarePlus className="h-4 w-4" />
          Свободная заметка
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          Поделитесь мыслью, идеей, фактом или сигналом — Кора добавит это в граф
          знаний компании.
        </p>
        <Textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Например: клиент жалуется на медленный отчёт по продажам…"
        />
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={busy || !text.trim()}
        >
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <MessageSquare className="mr-2 h-4 w-4" />
          )}
          Отправить
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * SBA δ-2 — панель проактивных уведомлений. Кора сама заметила вещи и
 * подсветила их. Каждую можно «Скрыть».
 */
function ProactivePanel({ orgId }: { orgId: string }) {
  const [includeDismissed, setIncludeDismissed] = useState(false);
  const listKey = ['my-proactive-notifications', orgId, includeDismissed];
  const { data, isLoading, error } = useSWR(
    listKey,
    async () => {
      const res = await listMyProactiveNotifications(orgId, {
        includeDismissed,
        limit: 100,
      });
      return res.items.map(mapProactiveNotification);
    },
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Кора заметила кое-что и решила позвать — без давления и без срочности.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIncludeDismissed((v) => !v)}
        >
          {includeDismissed ? 'Скрыть отклонённые' : 'Показать отклонённые'}
        </Button>
      </div>

      {isLoading && (
        <>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </>
      )}
      {error instanceof Error && (
        <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm">
          Ошибка: {error.message}
        </div>
      )}
      {!isLoading && data && data.length === 0 && (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            Пока тихо — Кора не заметила ничего, что стоило бы подсветить.
          </CardContent>
        </Card>
      )}
      {data?.map((p) => (
        <ProactiveRow
          key={p.id}
          item={p}
          orgId={orgId}
          onChanged={() => mutate(listKey)}
        />
      ))}
    </div>
  );
}

function ProactiveRow({
  item,
  orgId,
  onChanged,
}: {
  item: ProactiveNotification;
  orgId: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function handleDismiss() {
    setBusy(true);
    try {
      await dismissProactiveNotification(orgId, item.id);
      onChanged();
    } catch (e) {
      if (e instanceof ApiError) toast.error(`Не удалось скрыть: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  const severityVariant: 'default' | 'secondary' | 'warning' | 'danger' =
    item.severity === 'high'
      ? 'danger'
      : item.severity === 'medium'
        ? 'warning'
        : 'secondary';

  return (
    <Card className={item.dismissedAt ? 'opacity-60' : undefined}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-sm">
          <span className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            {item.ruleLabel}
          </span>
          <Badge variant={severityVariant} className="text-[10px]">
            {item.severityLabel}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p className="font-medium">{item.title}</p>
        <p className="text-muted-foreground">{item.body}</p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {item.actionUrl && (
            <Button size="sm" variant="outline" asChild>
              <a href={item.actionUrl}>Открыть</a>
            </Button>
          )}
          {!item.dismissedAt && (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleDismiss}
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <X className="mr-2 h-4 w-4" />
              )}
              Скрыть
            </Button>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {item.emittedAt.toLocaleString('ru-RU')}
            {item.dismissedAt && ' · скрыто'}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
