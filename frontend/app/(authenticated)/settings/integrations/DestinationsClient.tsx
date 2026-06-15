'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  AtSign,
  Download,
  Globe,
  Loader2,
  MessagesSquare,
  Pencil,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';

import { ApiError, humanizeApiError } from '@/api/api-error';
import {
  destinationsApi,
  type CreateDestinationRequest,
  type DestinationApi,
  type DestinationType,
} from '@/api/destinations.api';
import { toast } from 'sonner';
import { useConfirmDialog } from '@/ui/components/shared/useConfirmDialog';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/shadcn/dialog';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';

const TYPE_META: Record<
  DestinationType,
  { label: string; icon: typeof AtSign; description: string }
> = {
  email: { label: 'Почта', icon: AtSign, description: 'Письмо на адрес' },
  slack_webhook: { label: 'Slack', icon: MessagesSquare, description: 'Входящий вебхук Slack' },
  telegram_bot: {
    label: 'Telegram',
    icon: MessagesSquare,
    description: 'Токен бота + идентификатор чата',
  },
  generic_webhook: { label: 'Произвольный вебхук', icon: Globe, description: 'Любой HTTPS-адрес' },
};

const TYPE_ORDER: DestinationType[] = ['email', 'slack_webhook', 'telegram_bot', 'generic_webhook'];

type DialogState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; dest: DestinationApi };

export function DestinationsClient() {
  const [items, setItems] = useState<DestinationApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>({ mode: 'closed' });
  const [testingId, setTestingId] = useState<string | null>(null);
  const { ask, dialog: confirmDialog } = useConfirmDialog();

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await destinationsApi.list();
      setItems(res.items);
    } catch (e) {
      setError(humanizeApiError(e, 'Не удалось загрузить'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchItems();
  }, [fetchItems]);

  const handleDelete = async (id: string) => {
    const ok = await ask({
      title: 'Удалить интеграцию?',
      confirmLabel: 'Удалить',
      destructive: true,
    });
    if (!ok) return;
    try {
      await destinationsApi.remove(id);
      setItems((prev) => prev.filter((d) => d.id !== id));
      toast.success('Удалено');
    } catch (e) {
      toast.error(humanizeApiError(e, 'Не удалось удалить'));
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      await destinationsApi.test(id);
      toast.success('Тест отправлен');
    } catch (e) {
      toast.error(humanizeApiError(e, 'Тест не прошёл'));
    } finally {
      setTestingId(null);
    }
  };

  const grouped = TYPE_ORDER.map((type) => ({
    type,
    items: items.filter((d) => d.type === type),
  }));

  return (
    <div className="w-full">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
            Интеграции
          </h1>
          <p className="text-sm text-fg-secondary">
            Куда отправлять задачи и уведомления из встреч.
          </p>
        </div>
        <Button onClick={() => setDialog({ mode: 'create' })} size="sm">
          <Plus size={14} /> Добавить
        </Button>
      </header>

      {loading && (
        <div className="flex items-center justify-center py-16 text-sm text-fg-tertiary">
          <Loader2 size={16} className="mr-2 animate-spin" /> Загружаем...
        </div>
      )}

      {error && !loading && (
        <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-6">
          <ImportTrackerEntry />

          {grouped.map(({ type, items: groupItems }) => {
            const meta = TYPE_META[type];
            const Icon = meta.icon;
            return (
              <section key={type}>
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-fg-tertiary">
                  <Icon size={13} /> {meta.label}
                </div>
                {groupItems.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border-subtle bg-bg-card/40 p-4 text-xs text-fg-tertiary">
                    Нет интеграций этого типа.
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {groupItems.map((d) => (
                      <li
                        key={d.id}
                        className="group flex items-start gap-3 rounded-lg border border-border-subtle bg-bg-card p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-fg-primary">{d.name}</div>
                          <div className="mt-0.5 truncate text-xs text-fg-tertiary">
                            {summarizeConfig(d)}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={testingId === d.id}
                            onClick={() => void handleTest(d.id)}
                          >
                            {testingId === d.id ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <Send size={12} />
                            )}
                            Тест
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setDialog({ mode: 'edit', dest: d })}
                            aria-label="Редактировать"
                          >
                            <Pencil size={13} />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => void handleDelete(d.id)}
                            aria-label="Удалить"
                            className="hover:text-danger"
                          >
                            <Trash2 size={13} />
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      <DestinationDialog
        state={dialog}
        onClose={() => setDialog({ mode: 'closed' })}
        onSaved={() => {
          void fetchItems();
        }}
      />
      {confirmDialog}
    </div>
  );
}

/**
 * Wave 3 / Tracker Phase 5 part 1 — карточка-вход в миграционный wizard.
 * Отдельная секция над списком destinations: импорт это разовое действие,
 * а не сохранённая интеграция.
 */
function ImportTrackerEntry() {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-fg-tertiary">
        <Download size={13} /> Импорт данных
      </div>
      <Link
        href="/integrations/import-tracker"
        className="group flex items-start gap-3 rounded-lg border border-border-subtle bg-bg-card p-4 transition-colors hover:border-accent/40"
      >
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-accent-muted text-accent">
          <Download size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-fg-primary">
            Импорт задач из других трекеров
          </div>
          <div className="mt-0.5 text-xs text-fg-tertiary">
            Перенос проектов, задач, комментариев и вложений из Trello,
            Битрикс24 или Яндекс Трекера. Мастер за 4 шага.
          </div>
        </div>
        <ArrowRight
          size={16}
          className="mt-1 text-fg-tertiary transition-transform group-hover:translate-x-0.5 group-hover:text-accent"
        />
      </Link>
    </section>
  );
}

function summarizeConfig(d: DestinationApi): string {
  const cfg = d.config;
  if (d.type === 'email') return cfg.recipient_email ?? '—';
  if (d.type === 'slack_webhook')
    return cfg.url_present ? 'Адрес вебхука сохранён' : '—';
  if (d.type === 'telegram_bot')
    return `чат: ${cfg.chat_id ?? '—'}${cfg.bot_token_present ? ' · токен сохранён' : ''}`;
  if (d.type === 'generic_webhook')
    return cfg.url_present ? 'URL сохранён' : '—';
  return '';
}

function DestinationDialog({
  state,
  onClose,
  onSaved,
}: {
  state: DialogState;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = useState<DestinationType>('email');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [url, setUrl] = useState('');
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (state.mode === 'create') {
      setType('email');
      setName('');
      setEmail('');
      setUrl('');
      setBotToken('');
      setChatId('');
    } else if (state.mode === 'edit') {
      setType(state.dest.type);
      setName(state.dest.name);
      setEmail((state.dest.config.recipient_email as string | undefined) ?? '');
      setUrl('');
      setBotToken('');
      setChatId(String(state.dest.config.chat_id ?? ''));
    }
  }, [state]);

  const open = state.mode !== 'closed';
  const isEdit = state.mode === 'edit';

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error('Введите название');
      return;
    }
    setSubmitting(true);
    try {
      if (isEdit) {
        const update: { name?: string; config?: Record<string, unknown> } = {
          name: name.trim(),
        };
        // Конфиг обновляем только если пользователь что-то ввёл (секреты иначе перезаписать пустым).
        const cfg: Record<string, unknown> = {};
        if (state.dest.type === 'email' && email) cfg.recipient_email = email.trim();
        if (state.dest.type === 'slack_webhook' && url) cfg.url = url.trim();
        if (state.dest.type === 'generic_webhook' && url) cfg.url = url.trim();
        if (state.dest.type === 'telegram_bot') {
          if (botToken) cfg.bot_token = botToken.trim();
          if (chatId) cfg.chat_id = chatId.trim();
        }
        if (Object.keys(cfg).length > 0) update.config = cfg;
        await destinationsApi.update(state.dest.id, update);
        toast.success('Сохранено');
      } else {
        const body = buildCreatePayload(type, name.trim(), { email, url, botToken, chatId });
        if (!body) {
          toast.error('Заполните все поля');
          setSubmitting(false);
          return;
        }
        await destinationsApi.create(body);
        toast.success('Создано');
      }
      onSaved();
      onClose();
    } catch (e) {
      toast.error(humanizeApiError(e, 'Не удалось сохранить'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEdit ? 'Редактировать интеграцию' : 'Новая интеграция'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!isEdit && (
            <div className="space-y-1.5">
              <Label>Тип</Label>
              <Select value={type} onValueChange={(v) => setType(v as DestinationType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_ORDER.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TYPE_META[t].label} — {TYPE_META[t].description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {isEdit && (
            <div className="text-xs text-fg-tertiary">
              Тип: <Badge variant="secondary">{TYPE_META[state.dest.type].label}</Badge>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="dest-name">Название</Label>
            <Input
              id="dest-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              autoFocus
              placeholder="Например: команда продаж"
            />
          </div>

          {type === 'email' && (
            <div className="space-y-1.5">
              <Label htmlFor="dest-email">Адрес почты</Label>
              <Input
                id="dest-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
              />
            </div>
          )}

          {(type === 'slack_webhook' || type === 'generic_webhook') && (
            <div className="space-y-1.5">
              <Label htmlFor="dest-url">
                {type === 'slack_webhook'
                  ? 'Адрес вебхука Slack'
                  : 'Адрес вебхука'}
              </Label>
              <Input
                id="dest-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={
                  isEdit
                    ? 'Оставьте пустым, чтобы не менять'
                    : 'https://...'
                }
              />
              {isEdit && (
                <p className="text-xs text-fg-tertiary">
                  Текущий URL зашифрован и не показывается. Заполните для замены.
                </p>
              )}
            </div>
          )}

          {type === 'telegram_bot' && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="dest-token">Токен бота</Label>
                <Input
                  id="dest-token"
                  type="password"
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  placeholder={
                    isEdit ? 'Оставьте пустым, чтобы не менять' : '1234567:abcdef...'
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dest-chat">Идентификатор чата</Label>
                <Input
                  id="dest-chat"
                  value={chatId}
                  onChange={(e) => setChatId(e.target.value)}
                  placeholder="-1001234567890"
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Отмена
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting && <Loader2 size={14} className="animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function buildCreatePayload(
  type: DestinationType,
  name: string,
  values: { email: string; url: string; botToken: string; chatId: string },
): CreateDestinationRequest | null {
  if (type === 'email') {
    if (!values.email.trim()) return null;
    return { type: 'email', name, config: { recipient_email: values.email.trim() } };
  }
  if (type === 'slack_webhook') {
    if (!values.url.trim()) return null;
    return { type: 'slack_webhook', name, config: { url: values.url.trim() } };
  }
  if (type === 'generic_webhook') {
    if (!values.url.trim()) return null;
    return { type: 'generic_webhook', name, config: { url: values.url.trim() } };
  }
  if (type === 'telegram_bot') {
    if (!values.botToken.trim() || !values.chatId.trim()) return null;
    return {
      type: 'telegram_bot',
      name,
      config: { bot_token: values.botToken.trim(), chat_id: values.chatId.trim() },
    };
  }
  return null;
}
