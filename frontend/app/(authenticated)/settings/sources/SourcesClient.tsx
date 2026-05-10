'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Copy,
  Globe,
  Loader2,
  Mail,
  Phone,
  Plus,
  PowerOff,
  Send,
  Settings as SettingsIcon,
  Trash2,
  XCircle,
  type LucideIcon,
} from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { sourcesApi } from '@/api/sources.api';
import { useAuth } from '@/contexts/auth-context';
import { useToast } from '@/contexts/toast-context';
import {
  DATA_CLASS_LABELS,
  DATA_CLASS_VALUES,
  ENCRYPTED_MARKER,
  SOURCE_TYPE_LABELS,
  SOURCE_UI_TYPES,
  dataClassBadgeVariant,
  generateWebhookSecret,
  mapSourceDtoToDomain,
  parseLinesToList,
  parseLinesToNumbers,
  relativeTime,
  type DataClass,
  type SourceApi,
  type SourceDomain,
  type SourceTestResultApi,
  type SourceUiType,
} from '@/domain/source';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';
import { Textarea } from '@/ui/shadcn/textarea';
import { cn } from '@/ui/shadcn/lib/utils';

const TYPE_ICONS: Record<SourceUiType, LucideIcon> = {
  bot: Send,
  phone_call: Phone,
  email: Mail,
  web_form: Globe,
};

function isUiType(t: string): t is SourceUiType {
  return (SOURCE_UI_TYPES as readonly string[]).includes(t);
}

export function SourcesClient() {
  const { currentOrgId, currentOrgRole, isLoading: authLoading } = useAuth();
  const { addToast } = useToast();
  const canManage =
    currentOrgRole === 'owner' || currentOrgRole === 'admin';

  const [items, setItems] = useState<SourceDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<SourceDomain | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!currentOrgId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await sourcesApi.list(currentOrgId);
      setItems(res.items.map(mapSourceDtoToDomain));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить');
    } finally {
      setLoading(false);
    }
  }, [currentOrgId]);

  useEffect(() => {
    if (authLoading) return;
    void fetchAll();
  }, [authLoading, fetchAll]);

  const handleTest = async (s: SourceDomain) => {
    if (!currentOrgId) return;
    setPendingId(s.id);
    try {
      const res = await sourcesApi.test(currentOrgId, s.id);
      if (res.ok) {
        addToast({ type: 'success', message: `Тест «${s.name}» — успешно` });
      } else {
        addToast({
          type: 'error',
          message: `Тест не прошёл: ${res.errorMessage ?? 'неизвестная ошибка'}`,
        });
      }
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiError ? e.message : 'Тест не прошёл',
      });
    } finally {
      setPendingId(null);
    }
  };

  const handleToggleActive = async (s: SourceDomain) => {
    if (!currentOrgId) return;
    setPendingId(s.id);
    try {
      const updated = await sourcesApi.update(currentOrgId, s.id, {
        isActive: !s.isActive,
      });
      setItems((prev) =>
        prev.map((x) =>
          x.id === s.id ? mapSourceDtoToDomain(updated) : x,
        ),
      );
      addToast({
        type: 'success',
        message: updated.isActive ? 'Источник включён' : 'Источник выключен',
      });
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiError ? e.message : 'Не удалось обновить',
      });
    } finally {
      setPendingId(null);
    }
  };

  const handleDelete = async (s: SourceDomain) => {
    if (!currentOrgId) return;
    if (
      !confirm(
        `Отключить источник «${s.name}»? Накопленные события останутся, но новые поступать не будут.`,
      )
    )
      return;
    setPendingId(s.id);
    try {
      await sourcesApi.remove(currentOrgId, s.id);
      // Soft-delete на бэке = isActive=false. Перезагрузим список.
      await fetchAll();
      addToast({ type: 'success', message: 'Источник отключён' });
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiError ? e.message : 'Не удалось отключить',
      });
    } finally {
      setPendingId(null);
    }
  };

  if (authLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-fg-tertiary">
        <Loader2 size={16} className="mr-2 animate-spin" /> Загружаем...
      </div>
    );
  }

  if (!currentOrgId) {
    return (
      <div className="rounded-md border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
        Эта страница доступна только в рамках Org. Создайте или присоединитесь к организации.
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="rounded-md border border-warning/30 bg-warning/10 p-4 text-sm">
        Управление источниками доступно только владельцу или администратору Org.
      </div>
    );
  }

  return (
    <div className="w-full">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
            Источники данных
          </h1>
          <p className="text-sm text-fg-secondary">
            Подключите внешние каналы — Telegram, телефония, почта, дамп мысли —
            события из них попадают в общий knowledge-core Org.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} size="sm">
          <Plus size={14} /> Подключить источник
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

      {!loading && !error && items.length === 0 && (
        <div className="rounded-lg border border-dashed border-border-subtle bg-bg-card/40 p-10 text-center text-sm text-fg-secondary">
          Подключённых источников пока нет.
          <br />
          Нажмите «Подключить источник», чтобы начать.
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((s) => (
            <SourceRow
              key={s.id}
              source={s}
              isPending={pendingId === s.id}
              onEdit={() => setEditing(s)}
              onTest={() => void handleTest(s)}
              onToggleActive={() => void handleToggleActive(s)}
              onDelete={() => void handleDelete(s)}
            />
          ))}
        </ul>
      )}

      <CreateSourceDialog
        open={createOpen}
        orgId={currentOrgId}
        onClose={() => setCreateOpen(false)}
        onCreated={async () => {
          setCreateOpen(false);
          await fetchAll();
        }}
      />

      <EditSourceDialog
        source={editing}
        orgId={currentOrgId}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await fetchAll();
        }}
      />
    </div>
  );
}

// ───────────────────────────── Row ─────────────────────────────────

function SourceRow({
  source,
  isPending,
  onEdit,
  onTest,
  onToggleActive,
  onDelete,
}: {
  source: SourceDomain;
  isPending: boolean;
  onEdit: () => void;
  onTest: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  const Icon = isUiType(source.type) ? TYPE_ICONS[source.type] : Activity;
  const typeLabel = isUiType(source.type)
    ? SOURCE_TYPE_LABELS[source.type]
    : source.type;

  return (
    <li
      className={cn(
        'flex items-start gap-3 rounded-lg border p-3 transition-colors',
        source.isActive
          ? 'border-border-subtle bg-bg-card'
          : 'border-border-subtle bg-bg-card/50 opacity-70',
      )}
    >
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border-subtle bg-bg-overlay text-fg-secondary">
        <Icon size={16} strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-fg-primary">
            {source.name}
          </span>
          <Badge variant="secondary" className="text-[10px]">
            {typeLabel}
          </Badge>
          <Badge
            variant={dataClassBadgeVariant(source.dataClass)}
            className="text-[10px]"
          >
            {DATA_CLASS_LABELS[source.dataClass]}
          </Badge>
          {!source.isActive && (
            <Badge variant="secondary" className="text-[10px]">
              Отключён
            </Badge>
          )}
        </div>
        <div className="mt-1 text-[11px] text-fg-tertiary">
          Последнее событие: {relativeTime(source.lastEventAt)}
        </div>
        {source.webhookUrl && (
          <div className="mt-1 flex items-center gap-1 text-[11px] text-fg-tertiary">
            <span>Webhook:</span>
            <code className="truncate rounded bg-bg-overlay px-1.5 py-0.5 font-mono">
              {source.webhookUrl}
            </code>
            <CopyButton text={source.webhookUrl} />
          </div>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Switch
          checked={source.isActive}
          onCheckedChange={onToggleActive}
          disabled={isPending}
          aria-label="Активен"
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={onTest}
          disabled={isPending}
        >
          {isPending ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <CheckCircle2 size={12} />
          )}{' '}
          Тест
        </Button>
        <Button size="sm" variant="ghost" onClick={onEdit} disabled={isPending}>
          <SettingsIcon size={12} /> Настроить
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={onDelete}
          disabled={isPending}
          className="hover:text-danger"
          aria-label="Отключить"
        >
          <PowerOff size={13} />
        </Button>
      </div>
    </li>
  );
}

function CopyButton({ text }: { text: string }) {
  const { addToast } = useToast();
  const handle = () => {
    void navigator.clipboard.writeText(text).then(
      () => addToast({ type: 'success', message: 'Скопировано' }),
      () => addToast({ type: 'error', message: 'Не удалось скопировать' }),
    );
  };
  return (
    <button
      type="button"
      onClick={handle}
      className="inline-flex h-5 w-5 items-center justify-center rounded text-fg-tertiary hover:bg-bg-overlay hover:text-fg-primary"
      aria-label="Скопировать"
    >
      <Copy size={11} />
    </button>
  );
}

// ───────────────────────────── Create Dialog ─────────────────────────────────

function CreateSourceDialog({
  open,
  orgId,
  onClose,
  onCreated,
}: {
  open: boolean;
  orgId: string;
  onClose: () => void;
  onCreated: () => Promise<void> | void;
}) {
  const [type, setType] = useState<SourceUiType | null>(null);

  useEffect(() => {
    if (open) setType(null);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Подключить источник</DialogTitle>
          <DialogDescription>
            Выберите тип источника. Каждый адаптер обрабатывает свой формат событий.
          </DialogDescription>
        </DialogHeader>

        {type === null ? (
          <TypePicker onPick={(t) => setType(t)} />
        ) : (
          <SourceForm
            type={type}
            orgId={orgId}
            mode="create"
            onCancel={() => setType(null)}
            onDone={onCreated}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function TypePicker({ onPick }: { onPick: (t: SourceUiType) => void }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {SOURCE_UI_TYPES.map((t) => {
        const Icon = TYPE_ICONS[t];
        return (
          <button
            key={t}
            type="button"
            onClick={() => onPick(t)}
            className="flex items-start gap-3 rounded-lg border border-border-subtle bg-bg-card p-3 text-left transition-colors hover:border-accent-border hover:bg-accent-muted/20"
          >
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border-subtle bg-bg-overlay text-fg-secondary">
              <Icon size={16} strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium text-fg-primary">
                {SOURCE_TYPE_LABELS[t]}
              </div>
              <div className="mt-0.5 text-xs text-fg-tertiary">
                {DESCRIPTION_BY_TYPE[t]}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

const DESCRIPTION_BY_TYPE: Record<SourceUiType, string> = {
  bot: 'Сообщения чатов и каналов через Bot API.',
  phone_call: 'События звонков и записи разговоров.',
  email: 'Чтение входящих писем по IMAP.',
  web_form: 'Быстрый ввод заметок со страницы /dump.',
};

// ───────────────────────────── Edit Dialog ─────────────────────────────────

function EditSourceDialog({
  source,
  orgId,
  onClose,
  onSaved,
}: {
  source: SourceDomain | null;
  orgId: string;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const open = source !== null;
  if (!source || !isUiType(source.type)) {
    return (
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Редактирование</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-fg-secondary">
            Тип источника не управляется через UI.
          </div>
          <DialogFooter>
            <Button onClick={onClose}>Закрыть</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Настроить: {source.name}</DialogTitle>
          <DialogDescription>
            Секреты сохранены в зашифрованном виде. Оставьте поля пустыми, чтобы
            не менять текущее значение.
          </DialogDescription>
        </DialogHeader>
        <SourceForm
          type={source.type as SourceUiType}
          orgId={orgId}
          mode="edit"
          existing={source}
          onCancel={onClose}
          onDone={onSaved}
        />
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────── Form (по типу) ─────────────────────────────────

type FormMode = 'create' | 'edit';

interface SourceFormProps {
  type: SourceUiType;
  orgId: string;
  mode: FormMode;
  existing?: SourceDomain;
  onCancel: () => void;
  onDone: () => Promise<void> | void;
}

function SourceForm(props: SourceFormProps) {
  if (props.type === 'bot') return <TelegramForm {...props} />;
  if (props.type === 'phone_call') return <MangoForm {...props} />;
  if (props.type === 'email') return <ImapForm {...props} />;
  return <WebFormForm {...props} />;
}

// — Telegram

function TelegramForm({
  orgId,
  mode,
  existing,
  onCancel,
  onDone,
}: SourceFormProps) {
  const { addToast } = useToast();
  const cfg = (existing?.config ?? {}) as Record<string, unknown>;

  const [name, setName] = useState(existing?.name ?? '');
  const [botToken, setBotToken] = useState('');
  const [botUsername, setBotUsername] = useState(
    typeof cfg['botUsername'] === 'string' ? (cfg['botUsername'] as string) : '',
  );
  const [allowedChatIdsRaw, setAllowedChatIdsRaw] = useState(
    Array.isArray(cfg['allowedChatIds'])
      ? (cfg['allowedChatIds'] as unknown[])
          .map((x) => String(x))
          .join('\n')
      : '',
  );
  const [includeForwarded, setIncludeForwarded] = useState(
    typeof cfg['includeForwarded'] === 'boolean'
      ? (cfg['includeForwarded'] as boolean)
      : false,
  );
  const [dataClass, setDataClass] = useState<DataClass>(
    existing?.dataClass ?? 'internal',
  );
  const [submitting, setSubmitting] = useState(false);
  const [createdWebhookUrl, setCreatedWebhookUrl] = useState<string | null>(null);

  const computedName = useMemo(() => {
    if (mode === 'edit') return name;
    if (botUsername.trim()) return `Telegram: @${botUsername.trim().replace(/^@/, '')}`;
    return name || 'Telegram';
  }, [mode, name, botUsername]);

  const isValid = mode === 'edit'
    ? botUsername.trim().length > 0
    : botToken.trim().length > 0 && botUsername.trim().length > 0;

  const handleSubmit = async () => {
    if (!isValid || submitting) return;
    setSubmitting(true);
    try {
      const allowedChatIds = parseLinesToNumbers(allowedChatIdsRaw);
      if (mode === 'create') {
        const config = {
          subtype: 'telegram' as const,
          botToken: botToken.trim(),
          botUsername: botUsername.trim().replace(/^@/, ''),
          webhookSecret: generateWebhookSecret(),
          allowedChatIds,
          includeForwarded,
        };
        const created = await sourcesApi.create(orgId, {
          type: 'bot',
          name: computedName,
          config,
          dataClass,
        });
        setCreatedWebhookUrl(created.webhookUrl ?? null);
        addToast({ type: 'success', message: 'Telegram-бот подключён' });
      } else if (existing) {
        const config: Record<string, unknown> = {
          subtype: 'telegram',
          // если поле пустое — присылаем маркер `<encrypted>`, backend сохранит старое
          botToken: botToken.trim().length > 0 ? botToken.trim() : ENCRYPTED_MARKER,
          botUsername: botUsername.trim().replace(/^@/, ''),
          allowedChatIds,
          includeForwarded,
          // webhookSecret оставляем как есть на бэке — он не пересоздаётся.
          webhookSecret:
            typeof cfg['webhookSecret'] === 'string'
              ? (cfg['webhookSecret'] as string)
              : generateWebhookSecret(),
        };
        await sourcesApi.update(orgId, existing.id, {
          name: name.trim() || existing.name,
          config,
          dataClass,
        });
        addToast({ type: 'success', message: 'Сохранено' });
      }
      if (mode === 'edit') await onDone();
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiError ? e.message : 'Не удалось сохранить',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (createdWebhookUrl) {
    return (
      <WebhookCreatedView
        url={createdWebhookUrl}
        instructions={
          <>
            URL уже зарегистрирован в @BotFather через Bot API. Если используете
            альтернативного бота — настройте webhook вручную с помощью
            <code className="mx-1 rounded bg-bg-overlay px-1 py-0.5 font-mono text-[11px]">
              setWebhook
            </code>
            и секрет <code className="font-mono">X-Telegram-Bot-Api-Secret-Token</code>.
          </>
        }
        onClose={() => void onDone()}
      />
    );
  }

  return (
    <div className="space-y-4">
      {mode === 'edit' && (
        <Field label="Название">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Telegram: @mybot"
            maxLength={200}
          />
        </Field>
      )}

      <Field
        label={mode === 'create' ? 'Bot Token' : 'Новый Bot Token'}
        hint={
          mode === 'create'
            ? 'Получить у @BotFather командой /newbot'
            : 'Оставьте пустым, чтобы сохранить текущий токен'
        }
      >
        <Input
          type="password"
          value={botToken}
          onChange={(e) => setBotToken(e.target.value)}
          placeholder={
            mode === 'create' ? '123456:ABC-...' : '••••••••'
          }
          autoComplete="off"
        />
      </Field>

      <Field
        label="Bot Username"
        hint="Без @, например: my_company_bot"
      >
        <Input
          value={botUsername}
          onChange={(e) => setBotUsername(e.target.value)}
          placeholder="my_company_bot"
        />
      </Field>

      <Field
        label="Разрешённые чаты"
        hint="Один chat_id на строку. Пусто = принимать из любого чата, где состоит бот."
      >
        <Textarea
          value={allowedChatIdsRaw}
          onChange={(e) => setAllowedChatIdsRaw(e.target.value)}
          placeholder={'-1001234567890\n100100100'}
          className="min-h-[80px] font-mono text-xs"
        />
      </Field>

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <Checkbox
          checked={includeForwarded}
          onCheckedChange={(v) => setIncludeForwarded(v === true)}
        />
        <span className="text-fg-primary">Принимать пересланные сообщения</span>
      </label>

      <DataClassSelect value={dataClass} onChange={setDataClass} />

      <FormFooter
        onCancel={onCancel}
        onSubmit={() => void handleSubmit()}
        submitting={submitting}
        canSubmit={isValid}
        submitLabel={mode === 'create' ? 'Подключить' : 'Сохранить'}
      />
    </div>
  );
}

// — Mango

function MangoForm({
  orgId,
  mode,
  existing,
  onCancel,
  onDone,
}: SourceFormProps) {
  const { addToast } = useToast();
  const cfg = (existing?.config ?? {}) as Record<string, unknown>;

  const [name, setName] = useState(
    existing?.name ?? 'Mango: телефония',
  );
  const [apiKey, setApiKey] = useState('');
  const [apiSalt, setApiSalt] = useState('');
  const [extensionsRaw, setExtensionsRaw] = useState(
    Array.isArray(cfg['extensions'])
      ? (cfg['extensions'] as unknown[]).map((x) => String(x)).join('\n')
      : '',
  );
  const [dataClass, setDataClass] = useState<DataClass>(
    existing?.dataClass ?? 'internal',
  );
  const [submitting, setSubmitting] = useState(false);
  const [createdWebhookUrl, setCreatedWebhookUrl] = useState<string | null>(null);

  const isValid =
    mode === 'edit'
      ? extensionsRaw.length > 0
      : apiKey.trim().length >= 20 && apiSalt.trim().length >= 20;

  const handleSubmit = async () => {
    if (!isValid || submitting) return;
    setSubmitting(true);
    try {
      const extensions = parseLinesToList(extensionsRaw);
      if (mode === 'create') {
        const created = await sourcesApi.create(orgId, {
          type: 'phone_call',
          name: name.trim() || 'Mango: телефония',
          config: {
            subtype: 'mango',
            apiKey: apiKey.trim(),
            apiSalt: apiSalt.trim(),
            extensions,
          },
          dataClass,
        });
        setCreatedWebhookUrl(created.webhookUrl ?? null);
        addToast({ type: 'success', message: 'Подключение создано' });
      } else if (existing) {
        const config: Record<string, unknown> = {
          subtype: 'mango',
          apiKey: apiKey.trim().length > 0 ? apiKey.trim() : ENCRYPTED_MARKER,
          apiSalt: apiSalt.trim().length > 0 ? apiSalt.trim() : ENCRYPTED_MARKER,
          extensions,
        };
        await sourcesApi.update(orgId, existing.id, {
          name: name.trim() || existing.name,
          config,
          dataClass,
        });
        addToast({ type: 'success', message: 'Сохранено' });
      }
      if (mode === 'edit') await onDone();
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiError ? e.message : 'Не удалось сохранить',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (createdWebhookUrl) {
    return (
      <WebhookCreatedView
        url={createdWebhookUrl}
        instructions={
          <>
            Скопируйте URL и добавьте его в личном кабинете Mango Office как
            «вебхук событий звонков». Подпись считается как
            <code className="mx-1 rounded bg-bg-overlay px-1 py-0.5 font-mono text-[11px]">
              sha256(apiKey + json + apiSalt)
            </code>
            .
          </>
        }
        onClose={() => void onDone()}
      />
    );
  }

  return (
    <div className="space-y-4">
      <Field label="Название">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Mango: основной"
          maxLength={200}
        />
      </Field>

      <Field
        label={mode === 'create' ? 'API Key' : 'Новый API Key'}
        hint={
          mode === 'create'
            ? 'Минимум 20 символов. Из ЛК Mango Office.'
            : 'Оставьте пустым, чтобы сохранить текущий ключ'
        }
      >
        <Input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={mode === 'create' ? 'mango-api-key' : '••••••••'}
          autoComplete="off"
        />
      </Field>

      <Field
        label={mode === 'create' ? 'API Salt' : 'Новый API Salt'}
        hint="Минимум 20 символов"
      >
        <Input
          type="password"
          value={apiSalt}
          onChange={(e) => setApiSalt(e.target.value)}
          placeholder={mode === 'create' ? 'mango-api-salt' : '••••••••'}
          autoComplete="off"
        />
      </Field>

      <Field
        label="Внутренние номера (extensions)"
        hint="Один номер на строку. Только звонки этих extensions попадут в knowledge-core."
      >
        <Textarea
          value={extensionsRaw}
          onChange={(e) => setExtensionsRaw(e.target.value)}
          placeholder={'101\n102'}
          className="min-h-[80px] font-mono text-xs"
        />
      </Field>

      <DataClassSelect value={dataClass} onChange={setDataClass} />

      <FormFooter
        onCancel={onCancel}
        onSubmit={() => void handleSubmit()}
        submitting={submitting}
        canSubmit={isValid}
        submitLabel={mode === 'create' ? 'Подключить' : 'Сохранить'}
      />
    </div>
  );
}

// — IMAP (email)

function ImapForm({
  orgId,
  mode,
  existing,
  onCancel,
  onDone,
}: SourceFormProps) {
  const { addToast } = useToast();
  const cfg = (existing?.config ?? {}) as Record<string, unknown>;

  const [name, setName] = useState(existing?.name ?? '');
  const [host, setHost] = useState(
    typeof cfg['host'] === 'string' ? (cfg['host'] as string) : '',
  );
  const [port, setPort] = useState<number>(
    typeof cfg['port'] === 'number' ? (cfg['port'] as number) : 993,
  );
  const [secure, setSecure] = useState<boolean>(
    typeof cfg['secure'] === 'boolean' ? (cfg['secure'] as boolean) : true,
  );
  const [user, setUser] = useState(
    typeof cfg['user'] === 'string' ? (cfg['user'] as string) : '',
  );
  const [password, setPassword] = useState('');
  const [folder, setFolder] = useState(
    typeof cfg['folder'] === 'string' ? (cfg['folder'] as string) : 'INBOX',
  );
  const [sinceDate, setSinceDate] = useState(
    typeof cfg['sinceDate'] === 'string'
      ? ((cfg['sinceDate'] as string).slice(0, 10))
      : '',
  );
  const [sensitiveFoldersRaw, setSensitiveFoldersRaw] = useState(
    Array.isArray(cfg['sensitiveFolders'])
      ? (cfg['sensitiveFolders'] as unknown[]).map((x) => String(x)).join('\n')
      : '',
  );
  const [dataClass, setDataClass] = useState<DataClass>(
    existing?.dataClass ?? 'internal',
  );
  const [submitting, setSubmitting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<SourceTestResultApi | null>(null);

  const computedName = useMemo(() => {
    if (mode === 'edit') return name;
    return user.trim() || name || 'IMAP';
  }, [mode, name, user]);

  const isValid = mode === 'edit'
    ? host.trim().length > 0 && user.trim().length > 0
    : host.trim().length > 0 &&
      user.trim().length > 0 &&
      password.length > 0 &&
      port > 0;

  const buildConfig = (): Record<string, unknown> => {
    const sensitiveFolders = parseLinesToList(sensitiveFoldersRaw);
    const cfgOut: Record<string, unknown> = {
      subtype: 'imap',
      host: host.trim(),
      port,
      secure,
      user: user.trim(),
      passwordEnc:
        password.length > 0
          ? password
          : (typeof cfg['passwordEnc'] === 'string'
              ? ENCRYPTED_MARKER
              : ''),
      folder: folder.trim() || 'INBOX',
      sensitiveFolders,
    };
    if (sinceDate) {
      cfgOut['sinceDate'] = new Date(sinceDate + 'T00:00:00Z').toISOString();
    }
    return cfgOut;
  };

  const handleSubmit = async () => {
    if (!isValid || submitting) return;
    setSubmitting(true);
    try {
      if (mode === 'create') {
        await sourcesApi.create(orgId, {
          type: 'email',
          name: computedName,
          // На create требуем непустой пароль (валидация выше).
          config: buildConfig(),
          dataClass,
        });
        addToast({ type: 'success', message: 'IMAP-источник подключён' });
      } else if (existing) {
        await sourcesApi.update(orgId, existing.id, {
          name: name.trim() || existing.name,
          config: buildConfig(),
          dataClass,
        });
        addToast({ type: 'success', message: 'Сохранено' });
      }
      await onDone();
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiError ? e.message : 'Не удалось сохранить',
      });
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Test-flow: сохраняем источник как `isActive=false`, делаем `POST /test`,
   * показываем результат. Если ok — пользователь сам нажмёт Switch на странице.
   */
  const handleTestConnection = async () => {
    if (!isValid || testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      let sourceId: string;
      if (mode === 'edit' && existing) {
        await sourcesApi.update(orgId, existing.id, {
          config: buildConfig(),
          dataClass,
          isActive: false,
        });
        sourceId = existing.id;
      } else {
        const created = await sourcesApi.create(orgId, {
          type: 'email',
          name: computedName,
          config: buildConfig(),
          dataClass,
        });
        await sourcesApi.update(orgId, created.id, { isActive: false });
        sourceId = created.id;
      }
      const res = await sourcesApi.test(orgId, sourceId);
      setTestResult(res);
      if (res.ok) {
        addToast({ type: 'success', message: 'Подключение успешно' });
      } else {
        addToast({
          type: 'error',
          message: `Не удалось подключиться: ${res.errorMessage ?? 'неизвестная ошибка'}`,
        });
      }
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiError ? e.message : 'Не удалось проверить',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      {mode === 'edit' && (
        <Field label="Название">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="user@example.com"
            maxLength={200}
          />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="IMAP-хост">
          <Input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="imap.yandex.ru"
          />
        </Field>
        <Field label="Порт">
          <Input
            type="number"
            value={String(port)}
            onChange={(e) => setPort(Number(e.target.value) || 0)}
            placeholder="993"
            min={1}
            max={65535}
          />
        </Field>
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <Checkbox
          checked={secure}
          onCheckedChange={(v) => setSecure(v === true)}
        />
        <span className="text-fg-primary">TLS / SSL (рекомендуется)</span>
      </label>

      <Field label="Логин (email)">
        <Input
          value={user}
          onChange={(e) => setUser(e.target.value)}
          placeholder="user@example.com"
          autoComplete="off"
        />
      </Field>

      <Field
        label={mode === 'create' ? 'Пароль' : 'Новый пароль'}
        hint={
          mode === 'create'
            ? 'Будет зашифрован сервером. Для Gmail/Yandex — используйте app password.'
            : 'Оставьте пустым, чтобы сохранить текущий пароль'
        }
      >
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === 'create' ? 'app-specific-password' : '••••••••'}
          autoComplete="off"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Папка">
          <Input
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="INBOX"
          />
        </Field>
        <Field label="С даты (опционально)">
          <Input
            type="date"
            value={sinceDate}
            onChange={(e) => setSinceDate(e.target.value)}
          />
        </Field>
      </div>

      <Field
        label="Чувствительные папки"
        hint="Письма из этих папок будут помечены как sensitive. Одна папка на строку."
      >
        <Textarea
          value={sensitiveFoldersRaw}
          onChange={(e) => setSensitiveFoldersRaw(e.target.value)}
          placeholder={'Личное\nКонфиденциально'}
          className="min-h-[60px] font-mono text-xs"
        />
      </Field>

      <DataClassSelect value={dataClass} onChange={setDataClass} />

      {testResult && (
        <div
          className={cn(
            'rounded-md border p-2 text-xs',
            testResult.ok
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-danger/30 bg-danger/10 text-danger',
          )}
        >
          <div className="flex items-center gap-2 font-medium">
            {testResult.ok ? (
              <CheckCircle2 size={12} />
            ) : (
              <XCircle size={12} />
            )}
            {testResult.ok ? 'Подключение успешно' : 'Не удалось подключиться'}
          </div>
          {testResult.errorMessage && (
            <div className="mt-1">{testResult.errorMessage}</div>
          )}
          {testResult.details && (
            <pre className="mt-1 max-h-32 overflow-auto font-mono text-[10px] opacity-80">
              {JSON.stringify(testResult.details, null, 2)}
            </pre>
          )}
        </div>
      )}

      <DialogFooter className="!mt-2 flex-col gap-2 sm:flex-row sm:justify-between">
        <Button
          variant="ghost"
          onClick={() => void handleTestConnection()}
          disabled={!isValid || testing || submitting}
        >
          {testing && <Loader2 size={14} className="animate-spin" />}
          Проверить подключение
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={submitting}>
            Отмена
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={!isValid || submitting || testing}
          >
            {submitting && <Loader2 size={14} className="animate-spin" />}
            {mode === 'create' ? 'Подключить' : 'Сохранить'}
          </Button>
        </div>
      </DialogFooter>
    </div>
  );
}

// — Web-form

function WebFormForm({
  orgId,
  mode,
  existing,
  onCancel,
  onDone,
}: SourceFormProps) {
  const { addToast } = useToast();
  const [name, setName] = useState(existing?.name ?? 'Дамп мысли');
  const [dataClass, setDataClass] = useState<DataClass>(
    existing?.dataClass ?? 'internal',
  );
  const [isActive, setIsActive] = useState<boolean>(
    existing?.isActive ?? true,
  );
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      if (mode === 'create') {
        await sourcesApi.create(orgId, {
          type: 'web_form',
          name: name.trim() || 'Дамп мысли',
          dataClass,
        });
        addToast({ type: 'success', message: 'Web-form подключён' });
      } else if (existing) {
        await sourcesApi.update(orgId, existing.id, {
          name: name.trim() || existing.name,
          dataClass,
          isActive,
        });
        addToast({ type: 'success', message: 'Сохранено' });
      }
      await onDone();
    } catch (e) {
      addToast({
        type: 'error',
        message: e instanceof ApiError ? e.message : 'Не удалось сохранить',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border-subtle bg-bg-overlay/40 p-3 text-xs text-fg-secondary">
        Web-form — самый простой адаптер. Бэкенд автоматически создаёт его при
        первом сабмите со страницы{' '}
        <code className="rounded bg-bg-overlay px-1 py-0.5 font-mono">/dump</code>.
        Здесь вы можете лишь переименовать его, изменить класс данных или
        отключить.
      </div>

      <Field label="Название">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Дамп мысли"
          maxLength={200}
        />
      </Field>

      <DataClassSelect value={dataClass} onChange={setDataClass} />

      {mode === 'edit' && (
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Switch
            checked={isActive}
            onCheckedChange={(v) => setIsActive(v === true)}
          />
          <span className="text-fg-primary">Активен</span>
        </label>
      )}

      <FormFooter
        onCancel={onCancel}
        onSubmit={() => void handleSubmit()}
        submitting={submitting}
        canSubmit
        submitLabel={mode === 'create' ? 'Подключить' : 'Сохранить'}
      />
    </div>
  );
}

// ───────────────────────────── Shared form bits ─────────────────────────────────

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-fg-tertiary">{hint}</p>}
    </div>
  );
}

function DataClassSelect({
  value,
  onChange,
}: {
  value: DataClass;
  onChange: (v: DataClass) => void;
}) {
  return (
    <Field
      label="Класс данных"
      hint="Sensitive / private события не уйдут во внешние LLM (Фаза 11)."
    >
      <Select value={value} onValueChange={(v) => onChange(v as DataClass)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DATA_CLASS_VALUES.map((c) => (
            <SelectItem key={c} value={c}>
              {DATA_CLASS_LABELS[c]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function FormFooter({
  onCancel,
  onSubmit,
  submitting,
  canSubmit,
  submitLabel,
}: {
  onCancel: () => void;
  onSubmit: () => void;
  submitting: boolean;
  canSubmit: boolean;
  submitLabel: string;
}) {
  return (
    <DialogFooter className="!mt-2">
      <Button variant="ghost" onClick={onCancel} disabled={submitting}>
        Отмена
      </Button>
      <Button onClick={onSubmit} disabled={submitting || !canSubmit}>
        {submitting && <Loader2 size={14} className="animate-spin" />}
        {submitLabel}
      </Button>
    </DialogFooter>
  );
}

function WebhookCreatedView({
  url,
  instructions,
  onClose,
}: {
  url: string;
  instructions: React.ReactNode;
  onClose: () => void;
}) {
  const { addToast } = useToast();
  const handleCopy = () => {
    void navigator.clipboard.writeText(url).then(
      () => addToast({ type: 'success', message: 'Скопировано' }),
      () => addToast({ type: 'error', message: 'Не удалось скопировать' }),
    );
  };
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success">
        Источник подключён.
      </div>
      <div>
        <Label>Webhook URL</Label>
        <div className="mt-1 flex gap-2">
          <code className="flex-1 select-all break-all rounded-md border border-border-subtle bg-bg-overlay p-3 font-mono text-xs text-fg-primary">
            {url}
          </code>
          <Button onClick={handleCopy} variant="secondary">
            <Copy size={14} />
          </Button>
        </div>
        <p className="mt-2 text-xs text-fg-tertiary">{instructions}</p>
      </div>
      <DialogFooter>
        <Button onClick={onClose}>Готово</Button>
      </DialogFooter>
    </div>
  );
}
