"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import {
  ArrowLeft,
  Contact,
  Database,
  History,
  Loader2,
  MessagesSquare,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { ApiError } from "@/api/api-error";
import {
  chatboxApi,
  type ChatboxSyncRunApi,
  type ChatboxSyncScope,
} from "@/api/chatbox.api";
import { mapIntegration } from "@/domain/chatbox";
import {
  CardTitle,
  GlassCard,
  GRAD,
  STATUS_TONE,
} from "@/ui/components/dashboard/modern";
import { TierGate } from "@/ui/components/TierGate";
import { useConfirmDialog } from "@/ui/components/shared/useConfirmDialog";
import { Button } from "@/ui/shadcn/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/shadcn/select";
import { Switch } from "@/ui/shadcn/switch";

import {
  ChatboxConnectWizard,
  WIZARD_STORAGE_KEY,
} from "./ChatboxConnectWizard";
import { ChatboxMemorySummaryCard } from "./ChatboxMemorySummaryCard";

function errMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("ru-RU");
}

const SYNC_SCOPES: ReadonlyArray<{
  scope: ChatboxSyncScope;
  label: string;
  icon: typeof Users;
}> = [
  { scope: "customers", label: "Получить клиентов", icon: Contact },
  { scope: "managers", label: "Получить менеджеров", icon: Users },
];

function chatboxSyncLabel(scope: ChatboxSyncScope, since?: string): string {
  if (scope === "chats") return since ? "Прошлые чаты" : "Чаты";
  if (scope === "all") return "Всё";
  return SYNC_SCOPES.find((s) => s.scope === scope)?.label ?? "Данные";
}

const KNOWN_SYNC_SCOPES: readonly ChatboxSyncScope[] = [
  "all",
  "customers",
  "managers",
  "chats",
];

function chatboxSyncProgress(
  scope: ChatboxSyncScope,
  counts: {
    chats: number;
    messages: number;
    customers: number;
    members: number;
  },
): string {
  const n = (v: number) => v.toLocaleString("ru-RU");
  switch (scope) {
    case "managers":
      return `менеджеров в памяти: ${n(counts.members)}`;
    case "customers":
      return `клиентов в памяти: ${n(counts.customers)}`;
    case "chats":
      return `чатов: ${n(counts.chats)} · сообщений: ${n(counts.messages)}`;
    default:
      return `${n(counts.chats)} чатов · ${n(counts.customers)} клиентов · ${n(counts.members)} менеджеров`;
  }
}

const CHAT_PERIOD_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "1", label: "Последний 1 день" },
  { value: "7", label: "Последние 7 дней" },
  { value: "30", label: "Последний 1 месяц" },
  { value: "90", label: "Последние 3 месяца" },
  { value: "180", label: "Последние 6 месяцев" },
  { value: "365", label: "Последний год" },
  { value: "all", label: "Вся история" },
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
    ["chatbox-integration"],
    () => chatboxApi.getIntegration().then(mapIntegration),
    { revalidateOnFocus: false },
  );

  const [wizardMode, setWizardMode] = useState<boolean | null>(null);
  useEffect(() => {
    if (isLoading || error) return;
    setWizardMode((prev) => {
      if (prev !== null) return prev;
      const inProgress =
        typeof window !== "undefined" &&
        sessionStorage.getItem(WIZARD_STORAGE_KEY) !== null;
      return inProgress || data === null;
    });
  }, [isLoading, error, data]);

  const finishWizard = () => {
    try {
      sessionStorage.removeItem(WIZARD_STORAGE_KEY);
    } catch {}
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
          style={{ background: GRAD.violet, color: "oklch(0.99 0.005 280)" }}
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
          {errMessage(error, "Не удалось загрузить интеграцию")}
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
  const [optimisticScope, setOptimisticScope] =
    useState<ChatboxSyncScope | null>(null);
  const [chatPeriod, setChatPeriod] = useState("90");
  const optimisticStartMsRef = useRef<number>(0);
  const sawRunningRef = useRef(false);
  const prevRunningRef = useRef(false);
  const { ask, dialog: confirmDialog } = useConfirmDialog();

  const { data: syncStatus, mutate: mutateStatus } = useSWR(
    ["chatbox-sync-status"],
    () => chatboxApi.syncStatus(),
    {
      revalidateOnFocus: true,
      refreshInterval: (latest) => {
        const running =
          latest && "runningScopes" in latest
            ? (latest.runningScopes?.length ?? 0) > 0
            : false;
        return optimisticScope !== null || running ? 2500 : 0;
      },
    },
  );

  const serverSyncing =
    syncStatus && "runningScopes" in syncStatus
      ? (syncStatus.runningScopes?.length ?? 0) > 0
      : false;
  const rawServerScope =
    syncStatus && "activeSyncScope" in syncStatus
      ? (syncStatus.activeSyncScope ?? null)
      : null;
  const serverScope = KNOWN_SYNC_SCOPES.includes(
    rawServerScope as ChatboxSyncScope,
  )
    ? (rawServerScope as ChatboxSyncScope)
    : null;

  const syncing = serverSyncing || optimisticScope !== null;
  const activeScope = serverScope ?? optimisticScope;

  useEffect(() => {
    if (optimisticScope === null) return;
    if (serverSyncing) {
      setOptimisticScope(null);
      return;
    }
    if (Date.now() - optimisticStartMsRef.current > 10_000) {
      setOptimisticScope(null);
      void mutateStatus();
      onChanged();
    }
  }, [optimisticScope, serverSyncing, syncStatus, mutateStatus, onChanged]);

  useEffect(() => {
    if (serverSyncing) sawRunningRef.current = true;
    if (prevRunningRef.current && !serverSyncing && sawRunningRef.current) {
      sawRunningRef.current = false;
      toast.success("Синхронизация завершена");
      void mutateStatus();
      onChanged();
    }
    prevRunningRef.current = serverSyncing;
  }, [serverSyncing, mutateStatus, onChanged]);

  const statusTone =
    integration.status === "connected"
      ? STATUS_TONE.ok
      : integration.status === "error"
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
      toast.success(next ? "AI-анализ включён" : "AI-анализ выключен");
      onChanged();
    } catch (e) {
      setAnalysisEnabled(!next);
      toast.error(errMessage(e, "Не удалось сохранить"));
    } finally {
      setSavingAnalysis(false);
    }
  };

  const handleSync = async (scope: ChatboxSyncScope, since?: string) => {
    setSyncingScope(scope);
    try {
      await chatboxApi.sync(scope, since);
      optimisticStartMsRef.current = Date.now();
      setOptimisticScope(scope);
      void mutateStatus();
      toast.success(
        since
          ? "Запущен импорт прошлых чатов"
          : `Запущена синхронизация: ${chatboxSyncLabel(scope, since)}`,
      );
    } catch (e) {
      toast.error(errMessage(e, "Не удалось запустить синхронизацию"));
    } finally {
      setSyncingScope(null);
    }
  };

  const handleBackfillChats = () => {
    const since =
      chatPeriod === "all"
        ? undefined
        : new Date(
            Date.now() - Number(chatPeriod) * 24 * 60 * 60 * 1000,
          ).toISOString();
    void handleSync("chats", since);
  };

  const handleDelete = async () => {
    const ok = await ask({
      title: "Отключить интеграцию?",
      description:
        "Синхронизация прекратится. Уже собранные данные останутся в памяти компании.",
      confirmLabel: "Отключить",
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await chatboxApi.deleteIntegration();
      toast.success("Интеграция отключена");
      onChanged();
    } catch (e) {
      toast.error(errMessage(e, "Не удалось отключить"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-5">
      {}
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

        {integration.status === "error" && integration.lastError && (
          <div
            className="rounded-xl px-3 py-2.5 text-sm"
            style={{
              color: STATUS_TONE.risk.c,
              background: STATUS_TONE.risk.bg,
            }}
          >
            {integration.lastError}
          </div>
        )}

        <p className="text-sm text-fg-secondary">
          Автоматическая синхронизация — раз в сутки в 00:00.
        </p>

        {}
        <div className="space-y-2.5">
          <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">
            Получить данные
          </span>
          <div className="flex flex-wrap gap-2">
            {SYNC_SCOPES.map(({ scope, label, icon: Icon }) => (
              <Button
                key={scope}
                variant="outline"
                size="sm"
                onClick={() => void handleSync(scope)}
                disabled={syncingScope !== null || syncing || serverSyncing}
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
                {activeScope
                  ? `Синхронизируем: ${chatboxSyncLabel(activeScope)}…`
                  : "Идёт синхронизация…"}
              </span>
              {syncStatus && "counts" in syncStatus && activeScope && (
                <span className="text-fg-secondary">
                  {chatboxSyncProgress(activeScope, syncStatus.counts)}
                </span>
              )}
            </div>
          )}
        </div>

        {}
        <div className="space-y-2.5 border-t border-border-subtle pt-5">
          <span className="text-xs font-medium uppercase tracking-wide text-fg-tertiary">
            Забрать прошлые чаты за период
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={chatPeriod}
              onValueChange={setChatPeriod}
              disabled={syncingScope !== null || syncing || serverSyncing}
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
              disabled={syncingScope !== null || syncing || serverSyncing}
            >
              {syncingScope === "chats" ? (
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
              ? " Забранные диалоги уйдут в AI-анализ (без повторов уже разобранных)."
              : " Сейчас AI-анализ выключен: чаты просто зеркалятся."}
          </p>
        </div>

        {}
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

      {}
      <GlassCard className="space-y-3">
        <CardTitle icon={<Users size={16} />} grad={GRAD.teal}>
          Связи с людьми
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
          <Button asChild variant="outline" size="sm">
            <Link href="/chats/integrations/chatbox/chats">
              <MessagesSquare size={14} />
              Чаты
            </Link>
          </Button>
        </div>
      </GlassCard>

      {}
      <ChatboxMemorySummaryCard />

      {}
      <SyncStatusCard />

      {}
      <SyncLogCard />

      {}
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

const COUNT_LABELS: Array<{
  key:
    | "chats"
    | "messages"
    | "customers"
    | "channelClients"
    | "members"
    | "sessions";
  label: string;
}> = [
  { key: "chats", label: "Чаты" },
  { key: "messages", label: "Сообщения" },
  { key: "customers", label: "Клиенты" },
  { key: "channelClients", label: "Клиенты каналов" },
  { key: "members", label: "Менеджеры" },
  { key: "sessions", label: "Сессии" },
];

function SyncStatusCard() {
  const { data, isLoading } = useSWR(["chatbox-sync-status"], () =>
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

  if (!data || !("counts" in data)) {
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
              {(data.counts[key] ?? 0).toLocaleString("ru-RU")}
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

const SYNC_STATUS_META: Record<
  string,
  { label: string; tone: keyof typeof STATUS_TONE }
> = {
  success: { label: "Готово", tone: "ok" },
  failed: { label: "Ошибка", tone: "risk" },
  running: { label: "Идёт", tone: "warning" },
  skipped: { label: "Пропуск", tone: "warning" },
};

const SYNC_COUNT_LABELS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "chats", label: "чатов" },
  { key: "messages", label: "сообщений" },
  { key: "customers", label: "клиентов" },
  { key: "channelClients", label: "контактов" },
  { key: "members", label: "менеджеров" },
  { key: "channels", label: "каналов" },
  { key: "analysisEnqueued", label: "в граф" },
];

function syncCountParts(
  counts: Record<string, unknown> | null,
): Array<{ label: string; value: number }> {
  if (!counts) return [];
  const parts: Array<{ label: string; value: number }> = [];
  for (const { key, label } of SYNC_COUNT_LABELS) {
    const v = counts[key];
    if (typeof v === "number") parts.push({ label, value: v });
  }
  return parts;
}

function SyncLogRow({ run }: { run: ChatboxSyncRunApi }) {
  const started = toDate(run.startedAt);
  const meta = SYNC_STATUS_META[run.status] ?? {
    label: run.status,
    tone: "warning" as const,
  };
  const tone = STATUS_TONE[meta.tone];
  const duration =
    run.durationMs != null ? `${Math.round(run.durationMs / 1000)} с` : null;
  const parts = syncCountParts(run.counts);

  return (
    <div className="space-y-1 border-t border-border-subtle py-2.5 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
        <span className="text-fg-primary">{formatDate(started)}</span>
        <span className="text-fg-tertiary">·</span>
        <span className="text-fg-secondary">
          {run.trigger === "auto" ? "По расписанию" : "Ручная"}
        </span>
        <span
          className="rounded-full px-2 py-0.5 text-xs font-medium"
          style={{ color: tone.c, background: tone.bg }}
        >
          {meta.label}
        </span>
        {duration && (
          <span className="text-xs text-fg-tertiary">{duration}</span>
        )}
      </div>
      {parts.length > 0 && (
        <p className="text-xs text-fg-tertiary">
          собрано:{" "}
          {parts
            .map((p) => `${p.label} ${p.value.toLocaleString("ru-RU")}`)
            .join(" · ")}
        </p>
      )}
      {run.status === "failed" && run.error && (
        <p className="text-xs text-danger">{run.error}</p>
      )}
    </div>
  );
}

function SyncLogCard() {
  const { data, isLoading } = useSWR(["chatbox-sync-log"], () =>
    chatboxApi.syncLog(20),
  );

  return (
    <GlassCard className="space-y-3">
      <CardTitle icon={<History size={16} />} grad={GRAD.blue}>
        Журнал синхронизаций
      </CardTitle>
      {isLoading ? (
        <div className="flex items-center text-sm text-fg-tertiary">
          <Loader2 size={14} className="mr-2 animate-spin" /> Загружаем...
        </div>
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-fg-tertiary">Синхронизаций ещё не было.</p>
      ) : (
        <div className="flex flex-col">
          {data.map((run) => (
            <SyncLogRow key={run.id} run={run} />
          ))}
        </div>
      )}
    </GlassCard>
  );
}
