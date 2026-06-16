'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import {
  ArrowLeft,
  Contact,
  Database,
  Loader2,
  MessagesSquare,
  Trash2,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/api/api-error';
import { chatboxApi, type ChatboxSyncScope } from '@/api/chatbox.api';
import { mapIntegration } from '@/domain/chatbox';
import {
  CardTitle,
  GlassCard,
  GRAD,
  STATUS_TONE,
} from '@/ui/components/dashboard/modern';
import { TierGate } from '@/ui/components/TierGate';
import { useConfirmDialog } from '@/ui/components/shared/useConfirmDialog';
import { Button } from '@/ui/shadcn/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';
import { Switch } from '@/ui/shadcn/switch';

import {
  ChatboxConnectWizard,
  WIZARD_STORAGE_KEY,
} from './ChatboxConnectWizard';
import { ChatboxMemorySummaryCard } from './ChatboxMemorySummaryCard';

function errMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

function formatDate(d: Date | null): string {
  if (!d) return '—';
  return d.toLocaleString('ru-RU');
}

// Принудительная синхронизация — по отдельности. «Всё» и «Чаты» убраны:
// чаты НЕ дёргаются мгновенно — только по периоду (бэкафилл ниже), т.к. новые
// и так подтягиваются раз в сутки. Здесь — только точечные справочники.
const SYNC_SCOPES: ReadonlyArray<{
  scope: ChatboxSyncScope;
  label: string;
  icon: typeof Users;
}> = [
  { scope: 'customers', label: 'Клиенты', icon: Contact },
  { scope: 'managers', label: 'Менеджеры', icon: Users },
];

// Период бэкафилла чатов — в ДНЯХ (как в мастере подключения). 'all' — всё.
const CHAT_PERIOD_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '1', label: 'Последний 1 день' },
  { value: '7', label: 'Последние 7 дней' },
  { value: '30', label: 'Последний 1 месяц' },
  { value: '90', label: 'Последние 3 месяца' },
  { value: '180', label: 'Последние 6 месяцев' },
  { value: '365', label: 'Последний год' },
  { value: 'all', label: 'Вся история' },
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
    { revalidateOnFocus: false },
  );

  // Латч режима: решаем один раз после первой загрузки.
  //   - визард активен, если он «в процессе» (есть сохранённый прогресс в
  //     sessionStorage) ИЛИ интеграции ещё нет (data === null);
  //   - иначе ConnectedView.
  // Это держит мастер открытым на шагах 3–4 даже после создания интеграции
  // (data !== null) и переживает уход со страницы и возврат — прогресс
  // восстанавливается из sessionStorage внутри визарда.
  const [wizardMode, setWizardMode] = useState<boolean | null>(null);
  useEffect(() => {
    if (isLoading || error) return;
    setWizardMode((prev) => {
      if (prev !== null) return prev;
      // Визард активен, если он «в процессе» (есть сохранённый прогресс) ИЛИ
      // интеграции ещё нет. НИКАКОГО stale-guard по шагу: после «Подключить»
      // SWR-кэш ещё показывает data=null (mutate не звали), и guard ошибочно
      // принимал это за «удалённую интеграцию» и стирал прогресс → сброс на шаг 1.
      const inProgress =
        typeof window !== 'undefined' &&
        sessionStorage.getItem(WIZARD_STORAGE_KEY) !== null;
      return inProgress || data === null;
    });
  }, [isLoading, error, data]);

  const finishWizard = () => {
    try {
      sessionStorage.removeItem(WIZARD_STORAGE_KEY);
    } catch {
      /* noop */
    }
    setWizardMode(false);
    void mutate();
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <Link
        href="/company-admin/sources"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-fg-secondary hover:text-fg-primary"
      >
        <ArrowLeft size={15} /> К источникам
      </Link>
      <header className="mb-6 flex items-center gap-3">
        <span
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
          style={{ background: GRAD.violet, color: 'oklch(0.99 0.005 280)' }}
        >
          <MessagesSquare size={20} />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
            Чат бокс
          </h1>
          <p className="text-sm text-fg-secondary">
            Переписки с клиентами из Чат бокса — в память компании.
          </p>
        </div>
      </header>

      {error && !isLoading ? (
        <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {errMessage(error, 'Не удалось загрузить интеграцию')}
        </div>
      ) : isLoading || wizardMode === null ? (
        <div className="flex items-center justify-center py-16 text-sm text-fg-tertiary">
          <Loader2 size={16} className="mr-2 animate-spin" /> Загружаем...
        </div>
      ) : wizardMode ? (
        <ChatboxConnectWizard onDone={finishWizard} />
      ) : data ? (
        <ConnectedView integration={data} onChanged={() => void mutate()} />
      ) : (
        <div className="flex items-center justify-center py-16 text-sm text-fg-tertiary">
          <Loader2 size={16} className="mr-2 animate-spin" /> Загружаем...
        </div>
      )}
    </div>
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
  const [analysisEnabled, setAnalysisEnabled] = useState(
    integration.analysisEnabled,
  );
  const [savingAnalysis, setSavingAnalysis] = useState(false);
  const [syncingScope, setSyncingScope] = useState<ChatboxSyncScope | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  // Идёт ли синхронизация (для прогресса): пока true — опрашиваем статус.
  const [syncing, setSyncing] = useState(false);
  // Период бэкафилла чатов (дни / 'all'). По умолчанию — 3 месяца.
  const [chatPeriod, setChatPeriod] = useState('90');
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

  const statusTone =
    integration.status === 'connected'
      ? STATUS_TONE.ok
      : integration.status === 'error'
        ? STATUS_TONE.risk
        : STATUS_TONE.warning;

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

  const handleSync = async (scope: ChatboxSyncScope, since?: string) => {
    setSyncingScope(scope);
    try {
      await chatboxApi.sync(scope, since);
      // Точка отсчёта для детекта завершения.
      syncBaselineRef.current =
        syncStatus && 'lastFullSyncAt' in syncStatus
          ? syncStatus.lastFullSyncAt
          : null;
      syncStartMsRef.current = Date.now();
      setSyncing(true);
      void mutateStatus();
      toast.success(
        since ? 'Запущен импорт прошлых чатов' : 'Синхронизация запущена',
      );
    } catch (e) {
      toast.error(errMessage(e, 'Не удалось запустить синхронизацию'));
    } finally {
      setSyncingScope(null);
    }
  };

  // Бэкафилл чатов: период (дни) → since (ISO). 'all' → без границы.
  const handleBackfillChats = () => {
    const since =
      chatPeriod === 'all'
        ? undefined
        : new Date(
            Date.now() - Number(chatPeriod) * 24 * 60 * 60 * 1000,
          ).toISOString();
    void handleSync('chats', since);
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
    <div className="space-y-5">
      {/* Источник: статус + ручной синк + чаты + AI-анализ — одной карточкой */}
      <GlassCard className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <CardTitle icon={<MessagesSquare size={16} />} grad={GRAD.violet}>
            {integration.workspaceName}
          </CardTitle>
          <span
            className="shrink-0 rounded-full px-3 py-1 text-xs font-medium"
            style={{ color: statusTone.c, background: statusTone.bg }}
          >
            {integration.statusLabel}
          </span>
        </div>

        {integration.status === 'error' && integration.lastError && (
          <div
            className="rounded-xl px-3 py-2.5 text-sm"
            style={{ color: STATUS_TONE.risk.c, background: STATUS_TONE.risk.bg }}
          >
            {integration.lastError}
          </div>
        )}

        <p className="text-sm text-fg-secondary">
          Автоматическая синхронизация — раз в сутки в 00:00.
        </p>

        {/* Принудительный синк справочников */}
        <div className="space-y-2.5">
          <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">
            Синхронизировать вручную
          </span>
          <div className="flex flex-wrap gap-2">
            {SYNC_SCOPES.map(({ scope, label, icon: Icon }) => (
              <Button
                key={scope}
                variant="outline"
                size="sm"
                onClick={() => void handleSync(scope)}
                disabled={syncingScope !== null || syncing}
              >
                {syncingScope === scope ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Icon size={14} />
                )}
                {label}
              </Button>
            ))}
          </div>

          {syncing && (
            <div
              className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl px-3 py-2.5 text-sm"
              style={{ background: STATUS_TONE.ok.bg }}
            >
              <Loader2 size={14} className="animate-spin text-accent" />
              <span className="font-medium text-fg-primary">
                Идёт синхронизация…
              </span>
              {syncStatus && 'counts' in syncStatus && (
                <span className="text-fg-secondary">
                  собрано: {syncStatus.counts.chats.toLocaleString('ru-RU')} чатов ·{' '}
                  {syncStatus.counts.messages.toLocaleString('ru-RU')} сообщений ·{' '}
                  {syncStatus.counts.customers.toLocaleString('ru-RU')} клиентов ·{' '}
                  {syncStatus.counts.sessions.toLocaleString('ru-RU')} сессий
                </span>
              )}
            </div>
          )}
        </div>

        {/* Чаты — только по периоду (новые подтягиваются раз в сутки) */}
        <div className="space-y-2.5 border-t border-border-subtle pt-5">
          <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">
            Забрать прошлые чаты за период
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={chatPeriod}
              onValueChange={setChatPeriod}
              disabled={syncingScope !== null || syncing}
            >
              <SelectTrigger className="w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHAT_PERIOD_OPTIONS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleBackfillChats()}
              disabled={syncingScope !== null || syncing}
            >
              {syncingScope === 'chats' ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <MessagesSquare size={14} />
              )}
              Забрать чаты
            </Button>
          </div>
          <p className="max-w-[68ch] text-xs leading-relaxed text-fg-tertiary">
            Новые чаты подтягиваются автоматически раз в сутки. Здесь — добрать
            прошлые за выбранный период, если при установке пропустили.
            {analysisEnabled
              ? ' Забранные диалоги уйдут в AI-анализ (без повторов уже разобранных).'
              : ' Сейчас AI-анализ выключен: чаты просто зеркалятся.'}
          </p>
        </div>

        {/* AI-анализ — строкой с тумблером */}
        <div className="flex items-start justify-between gap-4 border-t border-border-subtle pt-5">
          <div className="min-w-0 max-w-[68ch]">
            <p className="text-sm font-medium text-fg-primary">
              AI-анализ переписок
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-fg-tertiary">
              Включено: Кора строит summary и добавляет знания из переписок в
              граф (расходует LLM). Выключено: чаты просто зеркалятся.
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
      </GlassCard>

      {/* Связи с сотрудниками — менеджеры + клиенты одной карточкой */}
      <GlassCard className="space-y-3">
        <CardTitle icon={<Users size={16} />} grad={GRAD.teal}>
          Связи с сотрудниками
        </CardTitle>
        <p className="max-w-[68ch] text-sm text-fg-secondary">
          Свяжите менеджеров и клиентов Чат бокса с людьми компании, чтобы Кора
          верно приписывала знания из переписок.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/chats/integrations/chatbox/managers">
              <Users size={14} />
              Менеджеры
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/chats/integrations/chatbox/customers">
              <Contact size={14} />
              Клиенты
            </Link>
          </Button>
        </div>
      </GlassCard>

      {/* Чаты в памяти — сводка анализа и графа */}
      <ChatboxMemorySummaryCard />

      {/* Статус собранных данных */}
      <SyncStatusCard />

      {/* Отключение — компактной строкой */}
      <GlassCard className="flex flex-wrap items-center justify-between gap-3 !py-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg-primary">
            Отключить интеграцию
          </p>
          <p className="mt-0.5 text-xs text-fg-tertiary">
            Синхронизация прекратится. Собранные данные останутся в памяти.
          </p>
        </div>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => void handleDelete()}
          disabled={deleting}
        >
          {deleting ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Trash2 size={14} />
          )}
          Отключить
        </Button>
      </GlassCard>

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
      <GlassCard className="space-y-4">
        <CardTitle icon={<Database size={16} />} grad={GRAD.blue}>
          Статус данных
        </CardTitle>
        <div className="flex items-center text-sm text-fg-tertiary">
          <Loader2 size={14} className="mr-2 animate-spin" /> Загружаем...
        </div>
      </GlassCard>
    );
  }

  if (!data || !('counts' in data)) {
    return null;
  }

  return (
    <GlassCard className="space-y-4">
      <CardTitle icon={<Database size={16} />} grad={GRAD.blue}>
        Статус данных
      </CardTitle>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {COUNT_LABELS.map(({ key, label }) => (
          <div
            key={key}
            className="rounded-xl border border-border-subtle bg-[oklch(1_0_0/0.03)] px-3 py-2.5"
          >
            <div className="text-xl font-semibold tabular-nums text-fg-primary">
              {(data.counts[key] ?? 0).toLocaleString('ru-RU')}
            </div>
            <div className="mt-0.5 text-[11px] text-fg-tertiary">{label}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border-subtle pt-3 text-xs text-fg-tertiary">
        <span>Полная: {formatDate(toDate(data.lastFullSyncAt))}</span>
        <span>
          Инкрементальная: {formatDate(toDate(data.lastIncrementalSyncAt))}
        </span>
      </div>
    </GlassCard>
  );
}

function toDate(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
