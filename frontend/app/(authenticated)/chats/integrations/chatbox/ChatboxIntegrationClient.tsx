'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import {
  Contact,
  Loader2,
  MessagesSquare,
  RefreshCw,
  Trash2,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/api/api-error';
import {
  chatboxApi,
  type ChatboxSyncMode,
  type ChatboxSyncScope,
  type ChatboxWorkspaceApi,
} from '@/api/chatbox.api';
import { CHATBOX_SYNC_MODES, mapIntegration } from '@/domain/chatbox';
import { TierGate } from '@/ui/components/TierGate';
import { useConfirmDialog } from '@/ui/components/shared/useConfirmDialog';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
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

import { ChatboxMemorySummaryCard } from './ChatboxMemorySummaryCard';

function errMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

function formatDate(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleString('ru-RU');
}

const SYNC_SCOPES: ReadonlyArray<{ scope: ChatboxSyncScope; label: string }> = [
  { scope: 'all', label: 'Синхронизировать всё' },
  { scope: 'customers', label: 'Клиентов' },
  { scope: 'managers', label: 'Менеджеров' },
  { scope: 'chats', label: 'Чаты' },
];

export function ChatboxIntegrationClient() {
  return (
    <TierGate feature="feature.chatbox">
      <ChatboxIntegrationContent />
    </TierGate>
  );
}

function ChatboxIntegrationContent() {
  const { data, error, isLoading, mutate } = useSWR(
    ['chatbox-integration'],
    () => chatboxApi.getIntegration().then(mapIntegration),
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <header className="mb-6 flex items-center gap-2">
        <MessagesSquare size={20} className="text-accent" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
            Чат бокс
          </h1>
          <p className="text-sm text-fg-secondary">
            Подключите рабочее пространство Чат бокса, чтобы Кора собирала
            знания из переписок с клиентами.
          </p>
        </div>
      </header>

      {isLoading && (
        <div className="flex items-center justify-center py-16 text-sm text-fg-tertiary">
          <Loader2 size={16} className="mr-2 animate-spin" /> Загружаем...
        </div>
      )}

      {error && !isLoading && (
        <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {errMessage(error, 'Не удалось загрузить интеграцию')}
        </div>
      )}

      {!isLoading && !error && data === null && (
        <ConnectForm onConnected={() => void mutate()} />
      )}

      {!isLoading && !error && data && (
        <ConnectedView integration={data} onChanged={() => void mutate()} />
      )}
    </div>
  );
}

// ─────────────────────────── Не настроено ────────────────────────────────

function ConnectForm({ onConnected }: { onConnected: () => void }) {
  const [token, setToken] = useState('');
  const [workspaces, setWorkspaces] = useState<ChatboxWorkspaceApi[] | null>(
    null,
  );
  const [workspaceId, setWorkspaceId] = useState('');
  const [syncMode, setSyncMode] = useState<ChatboxSyncMode>('hourly');
  const [checking, setChecking] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const handleCheck = async () => {
    if (!token.trim()) {
      toast.error('Введите токен');
      return;
    }
    setChecking(true);
    try {
      const res = await chatboxApi.listWorkspaces(token.trim());
      setWorkspaces(res);
      if (res.length > 0) {
        setWorkspaceId(res[0]!.id);
      }
      if (res.length === 0) {
        toast.error('В этом аккаунте нет доступных пространств');
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'chatbox_token_invalid') {
        toast.error('Неверный токен');
      } else {
        toast.error(errMessage(e, 'Не удалось проверить токен'));
      }
      setWorkspaces(null);
    } finally {
      setChecking(false);
    }
  };

  const handleConnect = async () => {
    if (!workspaceId) {
      toast.error('Выберите рабочее пространство');
      return;
    }
    setConnecting(true);
    try {
      await chatboxApi.saveIntegration({
        token: token.trim(),
        workspaceId,
        syncMode,
      });
      toast.success('Интеграция подключена');
      onConnected();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'chatbox_token_invalid') {
        toast.error('Неверный токен');
      } else if (
        e instanceof ApiError &&
        e.code === 'chatbox_workspace_not_found'
      ) {
        toast.error('Рабочее пространство не найдено');
      } else {
        toast.error(errMessage(e, 'Не удалось подключить'));
      }
    } finally {
      setConnecting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Подключение</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="chatbox-token">API-токен Чат бокса</Label>
          <div className="flex gap-2">
            <Input
              id="chatbox-token"
              type="password"
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                setWorkspaces(null);
              }}
              placeholder="Вставьте токен"
              autoComplete="off"
            />
            <Button
              variant="outline"
              onClick={() => void handleCheck()}
              disabled={checking || connecting}
            >
              {checking && <Loader2 size={14} className="animate-spin" />}
              Проверить токен
            </Button>
          </div>
        </div>

        {workspaces && workspaces.length > 0 && (
          <>
            <div className="space-y-1.5">
              <Label>Рабочее пространство</Label>
              <Select
                value={workspaceId}
                onValueChange={setWorkspaceId}
                disabled={connecting}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Выберите пространство" />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                      {w.role ? ` — ${w.role}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Режим синхронизации</Label>
              <Select
                value={syncMode}
                onValueChange={(v) => setSyncMode(v as ChatboxSyncMode)}
                disabled={connecting}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHATBOX_SYNC_MODES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={() => void handleConnect()}
              disabled={connecting || !workspaceId}
            >
              {connecting && <Loader2 size={14} className="animate-spin" />}
              Подключить
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────── Настроено ───────────────────────────────────

function ConnectedView({
  integration,
  onChanged,
}: {
  integration: NonNullable<ReturnType<typeof mapIntegration>>;
  onChanged: () => void;
}) {
  const [syncMode, setSyncMode] = useState<ChatboxSyncMode>(
    integration.syncMode,
  );
  const [analysisEnabled, setAnalysisEnabled] = useState(
    integration.analysisEnabled,
  );
  const [savingAnalysis, setSavingAnalysis] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const [syncingScope, setSyncingScope] = useState<ChatboxSyncScope | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  // Идёт ли синхронизация (для прогресса): пока true — опрашиваем статус.
  const [syncing, setSyncing] = useState(false);
  const syncBaselineRef = useRef<string | null>(null);
  const syncStartMsRef = useRef<number>(0);
  const { ask, dialog: confirmDialog } = useConfirmDialog();

  // Общий с SyncStatusCard опрос статуса (один SWR-ключ → общий кэш).
  // Пока syncing — поллим каждые 2.5с, иначе не дёргаем.
  const { data: syncStatus, mutate: mutateStatus } = useSWR(
    ['chatbox-sync-status'],
    () => chatboxApi.syncStatus(),
    { refreshInterval: syncing ? 2500 : 0 },
  );

  // Завершение синка: ловим появление НОВОЙ полной синхронизации
  // (lastFullSyncAt сдвинулся) либо страховочный таймаут 4 минуты.
  useEffect(() => {
    if (!syncing) return;
    const curFull =
      syncStatus && 'lastFullSyncAt' in syncStatus
        ? syncStatus.lastFullSyncAt
        : null;
    const done =
      (curFull && curFull !== syncBaselineRef.current) ||
      Date.now() - syncStartMsRef.current > 240_000;
    if (done) {
      setSyncing(false);
      toast.success('Синхронизация завершена');
      onChanged();
    }
  }, [syncing, syncStatus, onChanged]);

  const statusVariant =
    integration.status === 'connected'
      ? 'success'
      : integration.status === 'error'
        ? 'danger'
        : 'secondary';

  const handleToggleAnalysis = async (next: boolean) => {
    setAnalysisEnabled(next);
    setSavingAnalysis(true);
    try {
      await chatboxApi.saveIntegration({
        workspaceId: integration.workspaceId,
        syncMode: integration.syncMode,
        analysisEnabled: next,
      });
      toast.success(next ? 'AI-анализ включён' : 'AI-анализ выключен');
      onChanged();
    } catch (e) {
      setAnalysisEnabled(!next); // откат при ошибке
      toast.error(errMessage(e, 'Не удалось сохранить'));
    } finally {
      setSavingAnalysis(false);
    }
  };

  const handleSaveMode = async () => {
    setSavingMode(true);
    try {
      await chatboxApi.saveIntegration({
        workspaceId: integration.workspaceId,
        syncMode,
      });
      toast.success('Режим синхронизации сохранён');
      onChanged();
    } catch (e) {
      toast.error(errMessage(e, 'Не удалось сохранить'));
    } finally {
      setSavingMode(false);
    }
  };

  const handleSync = async (scope: ChatboxSyncScope) => {
    setSyncingScope(scope);
    try {
      await chatboxApi.sync(scope);
      // Точка отсчёта для детекта завершения.
      syncBaselineRef.current =
        syncStatus && 'lastFullSyncAt' in syncStatus
          ? syncStatus.lastFullSyncAt
          : null;
      syncStartMsRef.current = Date.now();
      setSyncing(true);
      void mutateStatus();
      toast.success('Синхронизация запущена');
    } catch (e) {
      toast.error(errMessage(e, 'Не удалось запустить синхронизацию'));
    } finally {
      setSyncingScope(null);
    }
  };

  const handleDelete = async () => {
    const ok = await ask({
      title: 'Отключить интеграцию?',
      description:
        'Синхронизация прекратится. Уже собранные данные останутся в памяти компании.',
      confirmLabel: 'Отключить',
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await chatboxApi.deleteIntegration();
      toast.success('Интеграция отключена');
      onChanged();
    } catch (e) {
      toast.error(errMessage(e, 'Не удалось отключить'));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Карточка статуса */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>{integration.workspaceName}</CardTitle>
            <Badge variant={statusVariant}>{integration.statusLabel}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {integration.status === 'error' && integration.lastError && (
            <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
              {integration.lastError}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Режим синхронизации</Label>
            <div className="flex gap-2">
              <Select
                value={syncMode}
                onValueChange={(v) => setSyncMode(v as ChatboxSyncMode)}
                disabled={savingMode}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHATBOX_SYNC_MODES.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                onClick={() => void handleSaveMode()}
                disabled={savingMode || syncMode === integration.syncMode}
              >
                {savingMode && <Loader2 size={14} className="animate-spin" />}
                Сохранить
              </Button>
            </div>
          </div>

          <div className="text-xs text-fg-tertiary">
            Последняя полная синхронизация:{' '}
            {formatDate(integration.lastFullSyncAt)}
          </div>
        </CardContent>
      </Card>

      {/* AI-анализ */}
      <Card>
        <CardHeader>
          <CardTitle>AI-анализ переписок</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm text-fg-secondary">
                Когда включено, Кора строит summary диалогов и добавляет знания
                из переписок в граф (расходует LLM). Выключено — чаты просто
                зеркалятся без анализа.
              </p>
            </div>
            <div className="flex items-center gap-2 pt-0.5">
              {savingAnalysis && (
                <Loader2 size={14} className="animate-spin text-fg-tertiary" />
              )}
              <Switch
                checked={analysisEnabled}
                onCheckedChange={(v) => void handleToggleAnalysis(v)}
                disabled={savingAnalysis}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Синхронизация */}
      <Card>
        <CardHeader>
          <CardTitle>Синхронизация</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {SYNC_SCOPES.map(({ scope, label }) => (
              <Button
                key={scope}
                variant={scope === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => void handleSync(scope)}
                disabled={syncingScope !== null || syncing}
              >
                {syncingScope === scope || (syncing && scope === 'all') ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <RefreshCw size={14} />
                )}
                {label}
              </Button>
            ))}
          </div>

          {syncing && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border-subtle bg-bg-card p-3 text-sm">
              <Loader2 size={14} className="animate-spin text-accent" />
              <span className="font-medium text-fg-primary">
                Идёт синхронизация…
              </span>
              {syncStatus && 'counts' in syncStatus && (
                <span className="text-fg-tertiary">
                  собрано: {syncStatus.counts.chats.toLocaleString('ru-RU')} чатов ·{' '}
                  {syncStatus.counts.messages.toLocaleString('ru-RU')} сообщений ·{' '}
                  {syncStatus.counts.customers.toLocaleString('ru-RU')} клиентов ·{' '}
                  {syncStatus.counts.sessions.toLocaleString('ru-RU')} сессий
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Менеджеры и сотрудники */}
      <Card>
        <CardHeader>
          <CardTitle>Менеджеры и сотрудники</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-fg-secondary">
            Свяжите менеджеров Чат бокса с сотрудниками компании, чтобы Кора
            верно приписывала знания из переписок.
          </p>
          <Button asChild variant="outline">
            <Link href="/chats/integrations/chatbox/managers">
              <Users size={14} />
              Менеджеры и сотрудники
            </Link>
          </Button>
        </CardContent>
      </Card>

      {/* Клиенты и сотрудники */}
      <Card>
        <CardHeader>
          <CardTitle>Клиенты и сотрудники</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-fg-secondary">
            Свяжите клиентов Чат бокса с карточками людей компании, чтобы Кора
            верно приписывала знания из переписок.
          </p>
          <Button asChild variant="outline">
            <Link href="/chats/integrations/chatbox/customers">
              <Contact size={14} />
              Клиенты и сотрудники
            </Link>
          </Button>
        </CardContent>
      </Card>

      {/* Чаты в памяти — сводка анализа и графа */}
      <ChatboxMemorySummaryCard />

      {/* Статус собранных данных */}
      <SyncStatusCard />

      {/* Отключение */}
      <Card>
        <CardHeader>
          <CardTitle>Отключение</CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
            onClick={() => void handleDelete()}
            disabled={deleting}
          >
            {deleting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Trash2 size={14} />
            )}
            Отключить интеграцию
          </Button>
        </CardContent>
      </Card>

      {confirmDialog}
    </div>
  );
}

// ─────────────────────────── Статус собранных данных ─────────────────────

const COUNT_LABELS: Array<{
  key: 'chats' | 'messages' | 'customers' | 'channelClients' | 'members' | 'sessions';
  label: string;
}> = [
  { key: 'chats', label: 'Чаты' },
  { key: 'messages', label: 'Сообщения' },
  { key: 'customers', label: 'Клиенты' },
  { key: 'channelClients', label: 'Клиенты каналов' },
  { key: 'members', label: 'Менеджеры' },
  { key: 'sessions', label: 'Сессии' },
];

function SyncStatusCard() {
  const { data, isLoading } = useSWR(['chatbox-sync-status'], () =>
    chatboxApi.syncStatus(),
  );

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Статус данных</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center text-sm text-fg-tertiary">
            <Loader2 size={14} className="mr-2 animate-spin" /> Загружаем...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || !('counts' in data)) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Статус данных</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {COUNT_LABELS.map(({ key, label }) => (
            <div
              key={key}
              className="rounded-lg border border-border-subtle bg-bg-card p-3"
            >
              <div className="text-lg font-semibold text-fg-primary">
                {(data.counts[key] ?? 0).toLocaleString('ru-RU')}
              </div>
              <div className="text-xs text-fg-tertiary">{label}</div>
            </div>
          ))}
        </div>
        <div className="space-y-1 text-xs text-fg-tertiary">
          <div>
            Полная синхронизация: {formatDate(toDate(data.lastFullSyncAt))}
          </div>
          <div>
            Инкрементальная синхронизация:{' '}
            {formatDate(toDate(data.lastIncrementalSyncAt))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function toDate(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
