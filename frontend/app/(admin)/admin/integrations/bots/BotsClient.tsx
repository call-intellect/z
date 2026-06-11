'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  Inbox,
  Loader2,
  Send,
  TestTube2,
  Trash2,
  Webhook,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';

import { ApiError } from '@/api/api-error';
import { adminBotsApi } from '@/api/admin-bots.api';
import {
  BOT_STATUS_LABELS,
  botsOverviewFromApi,
  type BotChannelSettingsDomain,
  type BotKindApi,
  type BotsOverviewDomain,
  type EmailInboxSettingsDomain,
} from '@/domain/admin-bot';
import { AdminSection } from '@/ui/components/admin/AdminSection';
import { AdminTabs, type AdminTabDef } from '@/ui/components/admin/AdminTabs';
import { AdminSettingField } from '@/ui/components/admin/AdminSettingField';
import { useAdminSettingEditor } from '@/hooks/useAdminSettingEditor';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';

import {
  AdminEmpty,
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '../../AdminStateViews';
import { useAdminQuery } from '../../useAdminQuery';
import { adminRootCrumb } from '@/ui/components/admin/brand';

const TABS: AdminTabDef[] = [
  { value: 'telegram', label: 'Telegram', icon: Send },
  { value: 'max', label: 'Max', icon: Bot },
  { value: 'email_inbox', label: 'Email-inbox', icon: Inbox },
];

/**
 * `/admin/integrations/bots` — управление conversational ботами
 * (Telegram / Max / Email-inbox).
 *
 * Каждая вкладка отображает:
 *   - статус канала (last webhook event, ошибки);
 *   - метаданные токена (только последние 4 символа);
 *   - кнопки «Установить/Удалить webhook»;
 *   - настройки rate-limit и quiet hours через `AdminSettingField`
 *     (`conversational.<kind>.global_rps`, `…quiet_hours`).
 *
 * При отсутствии backend-эндпоинта (404) вкладки показывают `AdminEmpty`.
 */
export function BotsClient() {
  const q = useAdminQuery('admin-bots-overview', async () => {
    const res = await adminBotsApi.overview();
    return botsOverviewFromApi(res);
  });

  return (
    <AdminSection
      breadcrumbs={[
        adminRootCrumb(),
        { label: 'Каналы и интеграции' },
        { label: 'Conversational боты' },
      ]}
      title="Conversational боты"
      description="Глобальные боты Z: один Telegram-канал @kora_bot, Max и Email-inbox. Содержимое переписки сотрудников супер-админу недоступно (продуктовый принцип №1)."
    >
      {q.isLoading && <AdminLoading rows={4} />}
      {!q.isLoading && q.isForbidden && <AdminForbidden />}
      {!q.isLoading && q.error && (
        <AdminError message={q.error} onRetry={q.refetch} />
      )}
      {!q.isLoading && (q.data || !q.error) && (
        <AdminTabs tabs={TABS} defaultTab="telegram">
          {(active) =>
            active === 'email_inbox' ? (
              <EmailInboxTab
                data={q.data?.emailInbox ?? null}
                fallback={!q.data}
                onRefetch={q.refetch}
              />
            ) : (
              <BotChannelTab
                kind={active as Exclude<BotKindApi, 'email_inbox'>}
                data={pickChannel(q.data, active)}
                fallback={!q.data}
                onRefetch={q.refetch}
              />
            )
          }
        </AdminTabs>
      )}
    </AdminSection>
  );
}

function pickChannel(
  overview: BotsOverviewDomain | null,
  kind: string,
): BotChannelSettingsDomain | null {
  if (!overview) return null;
  if (kind === 'telegram') return overview.telegram;
  if (kind === 'max') return overview.max;
  return null;
}

// ─────────────────────────── Telegram / Max ───────────────────────────

const KIND_LABELS: Record<Exclude<BotKindApi, 'email_inbox'>, string> = {
  telegram: 'Telegram',
  max: 'Max',
};

function BotChannelTab({
  kind,
  data,
  fallback,
  onRefetch,
}: {
  kind: Exclude<BotKindApi, 'email_inbox'>;
  data: BotChannelSettingsDomain | null;
  fallback: boolean;
  onRefetch: () => void;
}) {
  if (fallback) {
    return (
      <AdminEmpty
        title={`Канал «${KIND_LABELS[kind]}» недоступен`}
        description="Backend-эндпоинт /api/v1/admin/integrations/bots ещё не реализован. Управление перейдёт сюда после Фазы 6 (backend)."
      />
    );
  }
  if (!data) {
    return (
      <AdminEmpty
        title={`Канал «${KIND_LABELS[kind]}» не настроен`}
        description="Установите токен бота через форму ниже — карточка появится автоматически."
      />
    );
  }
  return (
    <BotChannelEditor kind={kind} data={data} onRefetch={onRefetch} />
  );
}

function BotChannelEditor({
  kind,
  data,
  onRefetch,
}: {
  kind: Exclude<BotKindApi, 'email_inbox'>;
  data: BotChannelSettingsDomain;
  onRefetch: () => void;
}) {
  const [webhookUrl, setWebhookUrl] = useState<string>(
    data.webhookUrl ?? '',
  );
  const [token, setToken] = useState<string>('');
  const [isSavingWebhook, setIsSavingWebhook] = useState(false);
  const [isDeletingWebhook, setIsDeletingWebhook] = useState(false);
  const [isSavingToken, setIsSavingToken] = useState(false);

  useEffect(() => {
    setWebhookUrl(data.webhookUrl ?? '');
  }, [data.webhookUrl]);

  const handleSetWebhook = async () => {
    if (!webhookUrl.trim()) {
      toast.error('Введите URL webhook');
      return;
    }
    setIsSavingWebhook(true);
    try {
      await adminBotsApi.setWebhook(kind, { webhookUrl: webhookUrl.trim() });
      toast.success('Webhook установлен');
      onRefetch();
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Не удалось установить webhook',
      );
    } finally {
      setIsSavingWebhook(false);
    }
  };

  const handleDeleteWebhook = async () => {
    setIsDeletingWebhook(true);
    try {
      await adminBotsApi.deleteWebhook(kind);
      toast.success('Webhook удалён');
      onRefetch();
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Не удалось удалить webhook',
      );
    } finally {
      setIsDeletingWebhook(false);
    }
  };

  const handleSaveToken = async () => {
    if (!token.trim()) {
      toast.error('Введите токен');
      return;
    }
    setIsSavingToken(true);
    try {
      await adminBotsApi.setToken(kind, { token: token.trim() });
      toast.success('Токен сохранён');
      setToken('');
      onRefetch();
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Не удалось сохранить токен',
      );
    } finally {
      setIsSavingToken(false);
    }
  };

  const sevVariant: 'success' | 'warning' | 'danger' | 'secondary' = data.isLive
    ? 'success'
    : data.status === 'broken'
      ? 'danger'
      : data.isGloballyDisabled
        ? 'warning'
        : 'secondary';

  return (
    <div className="flex flex-col gap-6">
      {/* Статус-карточка */}
      <div className="rounded-xl border border-border-subtle bg-bg-elevated p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-fg-primary">Состояние</h3>
            <Badge variant={sevVariant}>
              {BOT_STATUS_LABELS[data.status] ?? data.status}
            </Badge>
          </div>
          <span className="text-xs text-fg-tertiary">
            Обновлено {data.updatedAt.toLocaleString('ru-RU')}
          </span>
        </div>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <StatRow
            label="Токен установлен"
            value={
              data.tokenIsSet ? (
                <span className="inline-flex items-center gap-1 text-success">
                  <CheckCircle2 size={14} /> да
                  {data.tokenLastChars ? (
                    <span className="font-mono text-fg-tertiary">
                      (…{data.tokenLastChars})
                    </span>
                  ) : null}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-danger">
                  <XCircle size={14} /> нет
                </span>
              )
            }
          />
          <StatRow
            label="Webhook secret"
            value={
              data.webhookSecretIsSet ? (
                <span className="text-success">установлен</span>
              ) : (
                <span className="text-danger">не установлен</span>
              )
            }
          />
          <StatRow
            label="Webhook URL"
            value={
              data.webhookUrl ? (
                <span className="font-mono text-xs text-fg-secondary">
                  {data.webhookUrl}
                </span>
              ) : (
                <span className="text-fg-tertiary">не задан</span>
              )
            }
          />
          <StatRow
            label="Последнее событие"
            value={
              data.lastWebhookEventAt ? (
                <span>{data.lastWebhookEventAt.toLocaleString('ru-RU')}</span>
              ) : (
                <span className="text-fg-tertiary">пока нет</span>
              )
            }
          />
          {data.lastWebhookError ? (
            <StatRow
              label="Последняя ошибка"
              value={
                <span className="text-danger" title={data.lastWebhookError}>
                  {data.lastWebhookError}
                </span>
              }
            />
          ) : null}
        </dl>
      </div>

      {/* Webhook controls */}
      <div className="rounded-xl border border-border-subtle bg-bg-elevated p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg-primary">
          <Webhook size={14} /> Webhook
        </h3>
        <div className="flex flex-col gap-2">
          <label
            htmlFor={`${kind}-webhook-url`}
            className="text-xs font-medium text-fg-secondary"
          >
            URL webhook (https://...)
          </label>
          <Input
            id={`${kind}-webhook-url`}
            type="text"
            value={webhookUrl}
            placeholder="https://example.com/api/v1/webhooks/telegram-bot"
            onChange={(e) => setWebhookUrl(e.target.value)}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => void handleSetWebhook()}
              disabled={isSavingWebhook}
            >
              {isSavingWebhook ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Webhook size={14} />
              )}
              Установить webhook
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleDeleteWebhook()}
              disabled={isDeletingWebhook || !data.webhookSecretIsSet}
            >
              {isDeletingWebhook ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Trash2 size={14} />
              )}
              Удалить webhook
            </Button>
          </div>
        </div>
      </div>

      {/* Token controls */}
      <div className="rounded-xl border border-border-subtle bg-bg-elevated p-4">
        <h3 className="mb-3 text-sm font-semibold text-fg-primary">
          Токен бота
        </h3>
        <div className="flex flex-col gap-2">
          <label
            htmlFor={`${kind}-token`}
            className="text-xs font-medium text-fg-secondary"
          >
            Новый токен (вставьте, чтобы обновить — старый не отображается)
          </label>
          <Input
            id={`${kind}-token`}
            type="password"
            value={token}
            placeholder="bot-token"
            onChange={(e) => setToken(e.target.value)}
          />
          <div className="mt-2">
            <Button
              size="sm"
              onClick={() => void handleSaveToken()}
              disabled={isSavingToken || token.length === 0}
            >
              {isSavingToken ? (
                <Loader2 size={14} className="animate-spin" />
              ) : null}
              Сохранить токен
            </Button>
          </div>
        </div>
      </div>

      {/* Глобальные настройки (AdminSetting) */}
      <BotGlobalSettings kind={kind} />
    </div>
  );
}

// ─────────────────────────── AdminSetting-поля ───────────────────────────

const RPS_SCHEMA = z.number().min(0).max(1000);
const QUIET_HOURS_SCHEMA = z.string();

function BotGlobalSettings({
  kind,
}: {
  kind: Exclude<BotKindApi, 'email_inbox'>;
}) {
  const rpsKey = `conversational.${kind}.global_rps`;
  const quietKey = `conversational.${kind}.quiet_hours`;

  const rps = useAdminSettingEditor<number>(rpsKey, {
    schema: RPS_SCHEMA,
    defaultValue: 30,
    requiresReason: 'low',
  });
  const quiet = useAdminSettingEditor<string>(quietKey, {
    schema: QUIET_HOURS_SCHEMA,
    defaultValue: '',
    requiresReason: 'low',
  });

  const onSave = useCallback(
    async (saver: () => Promise<void>, label: string) => {
      try {
        await saver();
        toast.success(`${label} сохранено`);
      } catch (e) {
        if (e instanceof Error) {
          toast.error(e.message);
        }
      }
    },
    [],
  );

  return (
    <div className="rounded-xl border border-border-subtle bg-bg-elevated p-4">
      <h3 className="mb-3 text-sm font-semibold text-fg-primary">
        Лимиты и расписание
      </h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <AdminSettingField
            schema={RPS_SCHEMA}
            value={rps.value}
            onChange={rps.setValue}
            label="Глобальный rate-limit (RPS)"
            description="Максимум запросов в секунду к API бота. 0 — без ограничений."
            disabled={rps.isLoading}
            error={rps.error ?? undefined}
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!rps.isDirty || rps.isSaving}
              onClick={() => void onSave(() => rps.save(), 'RPS')}
            >
              {rps.isSaving ? <Loader2 size={14} className="animate-spin" /> : null}
              Сохранить
            </Button>
            {rps.isDirty ? (
              <Button size="sm" variant="ghost" onClick={rps.reset}>
                Отменить
              </Button>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <AdminSettingField
            schema={QUIET_HOURS_SCHEMA}
            value={quiet.value}
            onChange={quiet.setValue}
            label="Тихие часы"
            description="Например, «22:00-08:00» (МСК). В этот интервал бот ничего не отправляет."
            disabled={quiet.isLoading}
            error={quiet.error ?? undefined}
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!quiet.isDirty || quiet.isSaving}
              onClick={() => void onSave(() => quiet.save(), 'Тихие часы')}
            >
              {quiet.isSaving ? (
                <Loader2 size={14} className="animate-spin" />
              ) : null}
              Сохранить
            </Button>
            {quiet.isDirty ? (
              <Button size="sm" variant="ghost" onClick={quiet.reset}>
                Отменить
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── Email-inbox ───────────────────────────

function EmailInboxTab({
  data,
  fallback,
  onRefetch,
}: {
  data: EmailInboxSettingsDomain | null;
  fallback: boolean;
  onRefetch: () => void;
}) {
  const [isTesting, setIsTesting] = useState(false);

  if (fallback) {
    return (
      <AdminEmpty
        title="Email-inbox недоступен"
        description="Backend-эндпоинт /api/v1/admin/integrations/bots ещё не реализован. Управление перейдёт сюда после Фазы 6 (backend)."
      />
    );
  }

  if (!data) {
    return (
      <AdminEmpty
        title="Email-inbox не настроен"
        description="Глобальный inbox-канал ещё не настроен. Параметры IMAP/POP3 выставляются через системные ENV (см. документацию интеграции)."
      />
    );
  }

  const handleTest = async () => {
    setIsTesting(true);
    try {
      const res = await adminBotsApi.testEmailInbox();
      if (res.ok) {
        toast.success('Соединение успешно');
      } else {
        toast.error(res.message ?? 'Соединение не удалось');
      }
      onRefetch();
    } catch (e) {
      toast.error(
        e instanceof ApiError ? e.message : 'Не удалось проверить соединение',
      );
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border-subtle bg-bg-elevated p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-fg-primary">Email-inbox</h3>
            <Badge variant={data.isLive ? 'success' : 'secondary'}>
              {BOT_STATUS_LABELS[data.status] ?? data.status}
            </Badge>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleTest()}
            disabled={isTesting}
          >
            {isTesting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <TestTube2 size={14} />
            )}
            Тест соединения
          </Button>
        </div>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <StatRow
            label="Host"
            value={
              data.host ? (
                <span className="font-mono text-xs">{data.host}</span>
              ) : (
                <span className="text-fg-tertiary">не задан</span>
              )
            }
          />
          <StatRow
            label="Port"
            value={
              data.port !== null ? (
                <span className="font-mono text-xs">{data.port}</span>
              ) : (
                <span className="text-fg-tertiary">не задан</span>
              )
            }
          />
          <StatRow
            label="User"
            value={
              data.user ? (
                <span className="font-mono text-xs">{data.user}</span>
              ) : (
                <span className="text-fg-tertiary">не задан</span>
              )
            }
          />
          <StatRow
            label="Folder"
            value={
              data.folder ? (
                <span className="font-mono text-xs">{data.folder}</span>
              ) : (
                <span className="text-fg-tertiary">INBOX</span>
              )
            }
          />
          <StatRow
            label="Последняя выборка"
            value={
              data.lastFetchAt ? (
                <span>{data.lastFetchAt.toLocaleString('ru-RU')}</span>
              ) : (
                <span className="text-fg-tertiary">пока нет</span>
              )
            }
          />
          {data.lastWebhookError ? (
            <StatRow
              label="Последняя ошибка"
              value={<span className="text-danger">{data.lastWebhookError}</span>}
            />
          ) : null}
        </dl>
      </div>
    </div>
  );
}

// ─────────────────────────── helpers ───────────────────────────

function StatRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs uppercase tracking-wide text-fg-tertiary">
        {label}
      </dt>
      <dd className="text-sm text-fg-primary">{value}</dd>
    </div>
  );
}
