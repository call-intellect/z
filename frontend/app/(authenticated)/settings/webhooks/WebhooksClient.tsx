'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, FileClock, Loader2, Plus, Send, Trash2 } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import {
  WEBHOOK_EVENTS,
  webhooksOutApi,
  type CreateWebhookSubscriptionApiResponse,
  type WebhookDeliveryApi,
  type WebhookEventName,
  type WebhookSubscriptionApi,
} from '@/api/webhooks-out.api';
import { toast } from 'sonner';
import { EmptyState } from '@/ui/components/shared/EmptyState';
import { QueryGate } from '@/ui/components/shared/QueryGate';
import { useConfirmDialog } from '@/ui/components/shared/useConfirmDialog';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/shadcn/dialog';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/ui/shadcn/sheet';
import { cn } from '@/ui/shadcn/lib/utils';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const STATUS_VARIANT: Record<
  WebhookSubscriptionApi['status'],
  { variant: 'success' | 'warning' | 'danger'; label: string }
> = {
  active: { variant: 'success', label: 'Активна' },
  paused: { variant: 'warning', label: 'Пауза' },
  failing: { variant: 'danger', label: 'Падает' },
};

export function WebhooksClient() {
  const [subs, setSubs] = useState<WebhookSubscriptionApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [created, setCreated] = useState<CreateWebhookSubscriptionApiResponse | null>(null);
  const [deliveriesFor, setDeliveriesFor] = useState<WebhookSubscriptionApi | null>(null);
  const { ask, dialog: confirmDialog } = useConfirmDialog();

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await webhooksOutApi.list();
      setSubs(res.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetch();
  }, [fetch]);

  const handleTest = async (id: string) => {
    try {
      await webhooksOutApi.test(id);
      toast.success('Тест отправлен');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Тест не прошёл');
    }
  };

  const handleDelete = async (id: string) => {
    const ok = await ask({
      title: 'Удалить подписку?',
      confirmLabel: 'Удалить',
      destructive: true,
    });
    if (!ok) return;
    try {
      await webhooksOutApi.remove(id);
      setSubs((prev) => prev.filter((s) => s.id !== id));
      toast.success('Удалено');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Не удалось удалить');
    }
  };

  return (
    <div className="w-full">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">Webhooks</h1>
          <p className="text-sm text-fg-secondary">
            Получайте события Z на свои эндпоинты в реальном времени.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} size="sm">
          <Plus size={14} /> Создать подписку
        </Button>
      </header>

      <QueryGate
        isLoading={loading}
        error={error}
        isEmpty={subs.length === 0}
        skeleton={
          <div className="flex items-center justify-center py-16 text-sm text-fg-tertiary">
            <Loader2 size={16} className="mr-2 animate-spin" /> Загружаем...
          </div>
        }
        empty={
          <EmptyState
            title="Подписок пока нет"
            description="Создайте подписку, чтобы получать webhook-уведомления о событиях."
          />
        }
        onRetry={() => void fetch()}
      >
        <ul className="space-y-2">
          {subs.map((s) => {
            const statusMeta = STATUS_VARIANT[s.status];
            return (
              <li
                key={s.id}
                className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-bg-card p-3 md:flex-row md:items-start"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="block min-w-0 max-w-full truncate text-sm text-fg-primary">
                      {s.url}
                    </code>
                    <Badge variant={statusMeta.variant}>{statusMeta.label}</Badge>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    {s.events.map((e) => (
                      <Badge key={e} variant="secondary" className="text-[10px]">
                        {e}
                      </Badge>
                    ))}
                  </div>
                  <div className="mt-1 text-[11px] text-fg-tertiary">
                    Последняя доставка: {formatDate(s.lastDeliveryAt)}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => void handleTest(s.id)}>
                    <Send size={12} /> Тест
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDeliveriesFor(s)}
                  >
                    <FileClock size={12} /> Журнал
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => void handleDelete(s.id)}
                    className="hover:text-danger"
                    aria-label="Удалить"
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </QueryGate>

      <CreateSubscriptionDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(res) => {
          setCreated(res);
          setCreateOpen(false);
          void fetch();
        }}
      />

      <CreatedSecretDialog created={created} onClose={() => setCreated(null)} />

      <DeliveriesSheet
        sub={deliveriesFor}
        onClose={() => setDeliveriesFor(null)}
      />
      {confirmDialog}
    </div>
  );
}

function CreateSubscriptionDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (res: CreateWebhookSubscriptionApiResponse) => void;
}) {
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<WebhookEventName[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setUrl('');
      setEvents([]);
    }
  }, [open]);

  const toggleEvent = (e: WebhookEventName) => {
    setEvents((prev) => (prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]));
  };

  const urlValid = /^https:\/\//i.test(url.trim());

  const handleSubmit = async () => {
    if (!urlValid || events.length === 0) return;
    setSubmitting(true);
    try {
      const res = await webhooksOutApi.create({ url: url.trim(), events });
      onCreated(res);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Не удалось создать');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новая подписка</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="wh-url">URL получателя</Label>
            <Input
              id="wh-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/hooks/z"
              autoFocus
            />
            {url.trim().length > 0 && !urlValid && (
              <p className="text-xs text-danger">URL должен начинаться с https://</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>События</Label>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {WEBHOOK_EVENTS.map((e) => (
                <label
                  key={e}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded-md border p-2 text-xs transition-colors',
                    events.includes(e)
                      ? 'border-accent-border bg-accent-muted/30'
                      : 'border-border-subtle hover:bg-bg-overlay',
                  )}
                >
                  <Checkbox
                    checked={events.includes(e)}
                    onCheckedChange={() => toggleEvent(e)}
                  />
                  <code className="font-mono text-[11px] text-fg-primary">{e}</code>
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Отмена
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={submitting || !urlValid || events.length === 0}
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            Создать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreatedSecretDialog({
  created,
  onClose,
}: {
  created: CreateWebhookSubscriptionApiResponse | null;
  onClose: () => void;
}) {
  const open = created !== null;

  const handleCopy = () => {
    if (!created) return;
    void navigator.clipboard.writeText(created.secret).then(
      () => toast.success('Скопировано'),
      () => toast.error('Не удалось скопировать'),
    );
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Подписка создана</DialogTitle>
          <DialogDescription>
            Это единственный раз, когда вы видите secret. Сохраните его — он нужен для проверки
            HMAC-подписи (заголовок <code className="font-mono">X-Z-Signature</code>).
          </DialogDescription>
        </DialogHeader>
        {created && (
          <div className="space-y-2">
            <Label>Ваш secret</Label>
            <div className="flex gap-2">
              <code className="flex-1 select-all break-all rounded-md border border-border-subtle bg-bg-overlay p-3 font-mono text-xs text-fg-primary">
                {created.secret}
              </code>
              <Button onClick={handleCopy} variant="secondary">
                <Copy size={14} />
              </Button>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button onClick={onClose}>Готово</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeliveriesSheet({
  sub,
  onClose,
}: {
  sub: WebhookSubscriptionApi | null;
  onClose: () => void;
}) {
  const [items, setItems] = useState<WebhookDeliveryApi[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!sub) {
      setItems([]);
      return;
    }
    setLoading(true);
    webhooksOutApi
      .deliveries(sub.id)
      .then((res) => setItems(res.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [sub]);

  return (
    <Sheet open={sub !== null} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md md:max-w-lg">
        <SheetHeader>
          <SheetTitle>Журнал доставок</SheetTitle>
          {sub && <SheetDescription className="truncate">{sub.url}</SheetDescription>}
        </SheetHeader>
        <div className="mt-4 max-h-[80vh] overflow-y-auto pr-1">
          {loading && (
            <div className="flex items-center justify-center py-10 text-sm text-fg-tertiary">
              <Loader2 size={14} className="mr-2 animate-spin" /> Загружаем...
            </div>
          )}
          {!loading && items.length === 0 && (
            <div className="rounded-md border border-dashed border-border-subtle p-6 text-center text-sm text-fg-tertiary">
              Доставок ещё не было.
            </div>
          )}
          <ul className="space-y-2">
            {items.map((d) => {
              const isExpanded = expandedId === d.id;
              const variant: 'success' | 'warning' | 'danger' =
                d.status === 'delivered'
                  ? 'success'
                  : d.status === 'failed'
                    ? 'danger'
                    : 'warning';
              return (
                <li
                  key={d.id}
                  className="rounded-md border border-border-subtle bg-bg-card p-2 text-xs"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : d.id)}
                    className="flex w-full items-center gap-2 text-left"
                  >
                    <Badge variant={variant}>{d.status}</Badge>
                    <code className="font-mono text-[11px] text-fg-primary">{d.event}</code>
                    {d.lastStatus !== null && (
                      <span className="text-fg-tertiary">HTTP {d.lastStatus}</span>
                    )}
                    <span className="ml-auto text-fg-tertiary">{formatDate(d.createdAt)}</span>
                  </button>
                  {isExpanded && d.lastResponse && (
                    <pre className="mt-2 max-h-40 overflow-auto rounded bg-bg-overlay p-2 font-mono text-[10px] text-fg-secondary">
                      {d.lastResponse}
                    </pre>
                  )}
                  <div className="mt-1 text-[10px] text-fg-tertiary">
                    attempts: {d.attempts}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  );
}
