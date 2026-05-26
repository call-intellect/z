'use client';

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  MessageSquareText,
  PowerOff,
  RefreshCw,
  Send,
  ServerCog,
  Webhook,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { adminSystemTelegramBotApi } from '@/api/admin-system-telegram-bot.api';
import { ApiError } from '@/api/api-error';
import {
  telegramBotBindingsPageFromApi,
  telegramBotFromApi,
  type TelegramBotBindingsPageDomain,
  type TelegramBotDomain,
} from '@/domain/admin-telegram-bot';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
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

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../../AdminStateViews';
import { useAdminQuery } from '../../useAdminQuery';

type BindingStatusFilter =
  | 'all'
  | 'linked'
  | 'pending'
  | 'no_membership'
  | 'bot_blocked'
  | 'inactive';

const BINDING_STATUS_OPTIONS: Array<{
  value: BindingStatusFilter;
  label: string;
}> = [
  { value: 'all', label: 'Все статусы' },
  { value: 'linked', label: 'Привязаны' },
  { value: 'pending', label: 'Ожидают подтверждения' },
  { value: 'no_membership', label: 'Без компании' },
  { value: 'bot_blocked', label: 'Бот заблокирован' },
  { value: 'inactive', label: 'Неактивны' },
];

export function TelegramBotClient() {
  const settingsQuery = useAdminQuery(
    'admin-telegram-bot-settings',
    async () => {
      const res = await adminSystemTelegramBotApi.fetchSettings();
      return telegramBotFromApi(res);
    },
    [],
  );

  return (
    <div className="space-y-6">
      <Header />

      {settingsQuery.isLoading && <AdminLoading rows={6} />}
      {!settingsQuery.isLoading && settingsQuery.isForbidden && (
        <AdminForbidden />
      )}
      {!settingsQuery.isLoading && settingsQuery.error && (
        <AdminError
          message={settingsQuery.error}
          onRetry={settingsQuery.refetch}
        />
      )}

      {!settingsQuery.isLoading && settingsQuery.data && (
        <SettingsBlocks
          data={settingsQuery.data}
          onChanged={settingsQuery.refetch}
        />
      )}

      <BindingsSection />
    </div>
  );
}

function Header() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold">Глобальный Telegram-бот</h1>
        <p className="text-sm text-fg-tertiary">
          Единый бот Коры для всех компаний-клиентов. Настройки видны только
          главному администратору Z. Содержимое переписки сотрудников
          недоступно — это продуктовое обещание клиентам.
        </p>
      </div>
    </div>
  );
}

function StatusBadge({ data }: { data: TelegramBotDomain }) {
  if (!data.channelExists) {
    return (
      <Badge variant="secondary">
        <AlertTriangle size={12} /> Не настроен
      </Badge>
    );
  }
  if (data.isGloballyDisabled) {
    return (
      <Badge variant="warning">
        <PowerOff size={12} /> Выключен глобально
      </Badge>
    );
  }
  if (data.status === 'broken') {
    return (
      <Badge variant="danger">
        <AlertTriangle size={12} /> Проблема с webhook
      </Badge>
    );
  }
  if (data.isLive) {
    return (
      <Badge variant="success">
        <CheckCircle2 size={12} /> Включён, работает
      </Badge>
    );
  }
  return (
    <Badge variant="warning">
      <AlertTriangle size={12} /> Требует настройки
    </Badge>
  );
}

function SettingsBlocks({
  data,
  onChanged,
}: {
  data: TelegramBotDomain;
  onChanged: () => void;
}) {
  return (
    <div className="space-y-6">
      {/* Шапка со статусом */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">Состояние бота</CardTitle>
            <p className="mt-1 text-xs text-fg-tertiary">
              Имя бота:{' '}
              {data.botUsername ? (
                <span className="font-mono text-fg-secondary">
                  @{data.botUsername}
                </span>
              ) : (
                'не определено'
              )}
              {' · '}
              обновлено: {data.updatedAt.toLocaleString('ru-RU')}
            </p>
          </div>
          <StatusBadge data={data} />
        </CardHeader>
      </Card>

      <TokenSection data={data} onChanged={onChanged} />
      <ProxySection data={data} onChanged={onChanged} />
      <WebhookSection data={data} onChanged={onChanged} />
      <GlobalSwitchSection data={data} onChanged={onChanged} />
      <TemplatesSection data={data} onChanged={onChanged} />
    </div>
  );
}

// ─────────────────────────── Прокси telegram.crossmark.ru ───────

function ProxySection({
  data,
  onChanged: _onChanged,
}: {
  data: TelegramBotDomain;
  onChanged: () => void;
}) {
  const [pinging, setPinging] = useState(false);
  const [pingResult, setPingResult] = useState<string | null>(null);
  const [pingKind, setPingKind] = useState<'ok' | 'error'>('ok');

  async function onPing() {
    setPinging(true);
    setPingResult(null);
    try {
      const r = await adminSystemTelegramBotApi.pingProxy();
      if (r.ok) {
        setPingResult(
          `Прокси доступен. HTTP ${r.status}, ${r.durationMs} мс.`,
        );
        setPingKind('ok');
      } else {
        setPingResult(
          `Прокси не отвечает: ${r.error ?? `HTTP ${r.status}`} (${r.durationMs} мс).`,
        );
        setPingKind('error');
      }
    } catch (e) {
      setPingResult(
        e instanceof ApiError
          ? e.message
          : 'Не удалось проверить прокси (ошибка сети).',
      );
      setPingKind('error');
    } finally {
      setPinging(false);
    }
  }

  const proxy = data.proxy;
  const trafficLightClass: Record<typeof proxy.trafficLight, string> = {
    green: 'bg-success/15 text-success',
    yellow: 'bg-warning/15 text-warning',
    red: 'bg-danger/15 text-danger',
    gray: 'bg-bg-overlay text-fg-tertiary',
  };
  const trafficLightLabel: Record<typeof proxy.trafficLight, string> = {
    green: 'Прокси работает, бот зарегистрирован',
    yellow: 'Прокси работает, но бот ещё не зарегистрирован',
    red: proxy.lastSyncError
      ? `Ошибка регистрации: ${proxy.lastSyncError}`
      : 'Прокси не отвечает',
    gray: proxy.enabled
      ? 'Нет данных (health-check ещё не запускался)'
      : 'Прокси выключен в настройках сервера',
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ServerCog size={16} /> Прокси telegram.crossmark.ru
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${trafficLightClass[proxy.trafficLight]}`}
        >
          <Activity size={14} />
          {trafficLightLabel[proxy.trafficLight]}
        </div>

        <div className="space-y-1 text-xs">
          <p>
            <span className="text-fg-tertiary">Адрес прокси: </span>
            <code className="rounded bg-bg-overlay px-1.5 py-0.5">
              {proxy.apiBase}
            </code>
          </p>
          {proxy.botId && (
            <p>
              <span className="text-fg-tertiary">ID бота в прокси: </span>
              <code className="rounded bg-bg-overlay px-1.5 py-0.5">
                {proxy.botId}
              </code>
            </p>
          )}
          {proxy.registeredAt && (
            <p className="text-fg-tertiary">
              Зарегистрирован: {proxy.registeredAt.toLocaleString('ru-RU')}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={onPing}
            disabled={pinging || !proxy.enabled}
          >
            {pinging ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            Проверить прокси сейчас
          </Button>
        </div>

        {pingResult && (
          <p
            className={`text-xs ${
              pingKind === 'ok' ? 'text-success' : 'text-danger'
            }`}
          >
            {pingResult}
          </p>
        )}
        {!proxy.enabled && (
          <p className="text-xs text-fg-tertiary">
            Прокси выключен переменной окружения{' '}
            <code>TELEGRAM_PROXY_ENABLED=false</code>. В этом режиме
            бэкенд работает напрямую с api.telegram.org (legacy/dev).
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────── Токен ──────────────────────────

function TokenSection({
  data,
  onChanged,
}: {
  data: TelegramBotDomain;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave() {
    if (token.trim().length < 10) {
      setError('Токен слишком короткий');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await adminSystemTelegramBotApi.updateToken({ token: token.trim() });
      setOpen(false);
      setToken('');
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось сохранить токен');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound size={16} /> Токен бота
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            {data.tokenIsSet ? (
              <>
                Установлен. Последние 4 символа:{' '}
                <span className="rounded bg-bg-overlay px-2 py-0.5 font-mono text-xs">
                  {data.tokenLastChars}
                </span>
              </>
            ) : (
              <span className="text-fg-tertiary">
                Не установлен. Боту нужно выдать токен от @BotFather, чтобы он
                начал работать.
              </span>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            {data.tokenIsSet ? 'Сменить токен' : 'Установить токен'}
          </Button>
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Новый токен Telegram-бота</DialogTitle>
              <DialogDescription>
                Токен будет зашифрован (алгоритм AES-256-GCM) и виден только
                серверу. После сохранения автоматически проверяется через
                Telegram (метод getMe).
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Label htmlFor="bot-token">
                Токен от @BotFather (формат «&lt;bot_id&gt;:&lt;secret&gt;»)
              </Label>
              <div className="relative">
                <Input
                  id="bot-token"
                  type={showToken ? 'text' : 'password'}
                  placeholder="123456789:ABCdef..."
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setShowToken((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-tertiary hover:text-fg-primary"
                  aria-label={showToken ? 'Скрыть токен' : 'Показать токен'}
                >
                  {showToken ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {error && <p className="text-xs text-danger">{error}</p>}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={saving}
              >
                Отмена
              </Button>
              <Button onClick={onSave} disabled={saving}>
                {saving && <Loader2 size={14} className="animate-spin" />}
                Сохранить токен
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────── Webhook ─────────────────────────

function WebhookSection({
  data,
  onChanged,
}: {
  data: TelegramBotDomain;
  onChanged: () => void;
}) {
  const [resetting, setResetting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackKind, setFeedbackKind] = useState<'ok' | 'error'>('ok');

  async function onReset() {
    if (!confirm('Перенастроить webhook? Старый секрет перестанет работать.')) {
      return;
    }
    setResetting(true);
    setFeedback(null);
    try {
      await adminSystemTelegramBotApi.resetWebhook();
      setFeedback('Webhook успешно перенастроен.');
      setFeedbackKind('ok');
      onChanged();
    } catch (e) {
      setFeedback(
        e instanceof ApiError
          ? e.message
          : 'Не удалось перенастроить webhook (проверьте, что токен установлен).',
      );
      setFeedbackKind('error');
    } finally {
      setResetting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Webhook size={16} /> Webhook (приём входящих сообщений)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wider text-fg-tertiary">
            Адрес для Telegram
          </p>
          <code className="block break-all rounded bg-bg-overlay px-2 py-1 text-xs">
            {data.webhookUrl}
          </code>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            Секрет {data.webhookSecretIsSet ? 'установлен' : 'не задан'} ·{' '}
            {data.webhookSecretIsSet
              ? 'Telegram подтверждает каждый запрос через заголовок «X-Telegram-Bot-Api-Secret-Token».'
              : 'Без секрета мы не сможем отличить настоящие запросы Telegram от подделок.'}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onReset}
            disabled={resetting || !data.tokenIsSet}
          >
            {resetting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            Перенастроить webhook
          </Button>
        </div>
        {!data.tokenIsSet && (
          <p className="text-xs text-fg-tertiary">
            Сначала установите токен бота — без токена Telegram не примет
            настройку webhook.
          </p>
        )}
        {feedback && (
          <p
            className={`text-xs ${
              feedbackKind === 'ok' ? 'text-success' : 'text-danger'
            }`}
          >
            {feedback}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────── Глобальный выключатель ──────────

function GlobalSwitchSection({
  data,
  onChanged,
}: {
  data: TelegramBotDomain;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = data.status === 'active';

  async function onToggle(next: boolean) {
    if (!data.channelExists) {
      setError('Сначала установите токен — глобального канала ещё нет.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await adminSystemTelegramBotApi.setStatus({
        status: next ? 'active' : 'global_disabled',
      });
      onChanged();
    } catch (e) {
      setError(
        e instanceof ApiError ? e.message : 'Не удалось изменить статус бота',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PowerOff size={16} /> Глобальный выключатель
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <p>
              <strong>Бот работает для всех клиентов</strong>
            </p>
            <p className="text-fg-tertiary">
              Если выключить — бот перестанет отвечать всем сотрудникам.
              Используйте только в крайнем случае (например, после утечки
              токена или при техническом инциденте).
            </p>
          </div>
          <div className="flex items-center gap-3">
            {saving && <Loader2 size={14} className="animate-spin" />}
            <Switch
              checked={enabled}
              onCheckedChange={onToggle}
              disabled={saving || !data.channelExists}
            />
          </div>
        </div>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────── Шаблоны сообщений ──────────────

function TemplatesSection({
  data,
  onChanged,
}: {
  data: TelegramBotDomain;
  onChanged: () => void;
}) {
  const [welcome, setWelcome] = useState(data.templates.welcome);
  const [notLinked, setNotLinked] = useState(data.templates.notLinked);
  const [employeeOffboarded, setEmployeeOffboarded] = useState(
    data.templates.employeeOffboarded,
  );
  const [orgFrozen, setOrgFrozen] = useState(data.templates.orgFrozen);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Подтянуть значения при обновлении data (refetch).
  useEffect(() => {
    setWelcome(data.templates.welcome);
    setNotLinked(data.templates.notLinked);
    setEmployeeOffboarded(data.templates.employeeOffboarded);
    setOrgFrozen(data.templates.orgFrozen);
  }, [data.templates]);

  const isDirty = useMemo(
    () =>
      welcome !== data.templates.welcome ||
      notLinked !== data.templates.notLinked ||
      employeeOffboarded !== data.templates.employeeOffboarded ||
      orgFrozen !== data.templates.orgFrozen,
    [welcome, notLinked, employeeOffboarded, orgFrozen, data.templates],
  );

  async function onSave() {
    setSaving(true);
    setFeedback(null);
    try {
      await adminSystemTelegramBotApi.updateTemplates({
        welcome,
        notLinked,
        employeeOffboarded,
        orgFrozen,
      });
      setFeedback('Шаблоны сохранены.');
      onChanged();
    } catch (e) {
      setFeedback(
        e instanceof ApiError ? e.message : 'Не удалось сохранить шаблоны',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageSquareText size={16} /> Шаблоны сообщений бота
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <TemplateField
          label="Приветствие после привязки"
          help="Сообщение, которое бот отправляет сотруднику сразу после успешной привязки аккаунта (по /start или коду)."
          value={welcome}
          onChange={setWelcome}
        />
        <TemplateField
          label="Если сотрудник не привязан"
          help="Ответ незнакомому отправителю — у которого нет действующей привязки или приглашения."
          value={notLinked}
          onChange={setNotLinked}
        />
        <TemplateField
          label="Уволенному сотруднику"
          help="Прощальное сообщение, которое бот отправляет однократно после исключения сотрудника из компании. Поддерживается подстановка «{{orgName}}»."
          value={employeeOffboarded}
          onChange={setEmployeeOffboarded}
        />
        <TemplateField
          label="Если компания заморожена"
          help="Сообщение, когда вся компания временно отключена (например, не оплачен тариф). Подстановка «{{orgName}}»."
          value={orgFrozen}
          onChange={setOrgFrozen}
        />

        <div className="flex items-center justify-end gap-3">
          {feedback && (
            <span className="text-xs text-fg-tertiary">{feedback}</span>
          )}
          <Button onClick={onSave} disabled={!isDirty || saving}>
            {saving && <Loader2 size={14} className="animate-spin" />}
            Сохранить шаблоны
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function TemplateField({
  label,
  help,
  value,
  onChange,
}: {
  label: string;
  help: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      <p className="text-xs text-fg-tertiary">{help}</p>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        maxLength={2000}
      />
    </div>
  );
}

// ─────────────────────────── Привязки сотрудников ──────────

function BindingsSection() {
  const [statusFilter, setStatusFilter] =
    useState<BindingStatusFilter>('all');
  const [orgIdFilter, setOrgIdFilter] = useState('');
  const [appliedOrgId, setAppliedOrgId] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const bindingsQuery = useAdminQuery<TelegramBotBindingsPageDomain>(
    `admin-telegram-bot-bindings:${statusFilter}:${appliedOrgId}:${page}`,
    async () => {
      const res = await adminSystemTelegramBotApi.fetchBindings({
        ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        ...(appliedOrgId.trim() ? { orgId: appliedOrgId.trim() } : {}),
        page,
        pageSize,
      });
      return telegramBotBindingsPageFromApi(res);
    },
    [statusFilter, appliedOrgId, page],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Send size={16} /> Привязки сотрудников
        </CardTitle>
        <p className="mt-1 text-xs text-fg-tertiary">
          Метаданные привязок по всем компаниям-клиентам. Содержимое сообщений
          не отображается — это продуктовое обещание клиентам (приватность
          переписки).
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Фильтры */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_220px_auto]">
          <div className="space-y-1">
            <Label className="text-xs">Идентификатор компании</Label>
            <Input
              placeholder="ID организации (cuid)"
              value={orgIdFilter}
              onChange={(e) => setOrgIdFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setPage(1);
                  setAppliedOrgId(orgIdFilter);
                }
              }}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Статус</Label>
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v as BindingStatusFilter);
                setPage(1);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Все статусы" />
              </SelectTrigger>
              <SelectContent>
                {BINDING_STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setPage(1);
                setAppliedOrgId(orgIdFilter);
              }}
            >
              Применить
            </Button>
          </div>
        </div>

        {bindingsQuery.isLoading && <AdminLoading rows={4} />}
        {bindingsQuery.isForbidden && <AdminForbidden />}
        {bindingsQuery.error && (
          <AdminError
            message={bindingsQuery.error}
            onRetry={bindingsQuery.refetch}
          />
        )}

        {bindingsQuery.data && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-fg-tertiary">
                  <tr>
                    <th className="px-2 py-1 text-left">Компания</th>
                    <th className="px-2 py-1 text-left">Сотрудник</th>
                    <th className="px-2 py-1 text-left">Статус</th>
                    <th className="px-2 py-1 text-left">
                      Последнее входящее
                    </th>
                    <th className="px-2 py-1 text-right">
                      Сообщений вх/исх
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {bindingsQuery.data.items.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-2 py-6 text-center text-fg-tertiary"
                      >
                        Под фильтр ничего не попало.
                      </td>
                    </tr>
                  )}
                  {bindingsQuery.data.items.map((b) => (
                    <tr
                      key={b.id}
                      className="border-t border-border-subtle align-top"
                    >
                      <td className="px-2 py-1.5">
                        {b.orgName ? (
                          <>
                            <div className="font-medium text-fg-primary">
                              {b.orgName}
                            </div>
                            {b.orgId && (
                              <div className="font-mono text-[11px] text-fg-tertiary">
                                {b.orgId}
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="text-fg-tertiary">— нет —</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="font-medium text-fg-primary">
                          {b.userName ?? '— без имени —'}
                        </div>
                        {b.userEmail && (
                          <div className="text-xs text-fg-tertiary">
                            {b.userEmail}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <BindingStatusBadge
                          status={b.status}
                          label={b.statusLabel}
                        />
                      </td>
                      <td className="px-2 py-1.5 text-xs text-fg-secondary">
                        {b.lastInboundAt
                          ? b.lastInboundAt.toLocaleString('ru-RU')
                          : '—'}
                        {b.linkedAt && (
                          <div className="text-[11px] text-fg-tertiary">
                            привязан: {b.linkedAt.toLocaleDateString('ru-RU')}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {b.inboundCount.toLocaleString('ru-RU')} /{' '}
                        {b.outboundCount.toLocaleString('ru-RU')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between text-xs text-fg-tertiary">
              <div>
                Всего: {bindingsQuery.data.total.toLocaleString('ru-RU')} ·
                страница {bindingsQuery.data.page}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1 || bindingsQuery.isLoading}
                >
                  Назад
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={
                    !bindingsQuery.data.hasMore || bindingsQuery.isLoading
                  }
                >
                  Вперёд
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function BindingStatusBadge({
  status,
  label,
}: {
  status: TelegramBotBindingsPageDomain['items'][number]['status'];
  label: string;
}) {
  const variant: 'success' | 'warning' | 'danger' | 'secondary' =
    status === 'linked'
      ? 'success'
      : status === 'bot_blocked'
        ? 'danger'
        : status === 'no_membership' || status === 'inactive'
          ? 'warning'
          : 'secondary';
  return <Badge variant={variant}>{label}</Badge>;
}
