"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import {
  ArrowLeft,
  Building2,
  Database,
  Loader2,
  Plug,
  RefreshCw,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { ApiError } from "@/api/api-error";
import { bitrixApi, type BitrixSyncScope } from "@/api/bitrix.api";
import {
  mapBitrixIntegration,
  mapBitrixStatus,
  type BitrixIntegrationView,
} from "@/domain/bitrix";
import {
  CardTitle,
  GlassCard,
  GRAD,
  STATUS_TONE,
} from "@/ui/components/dashboard/modern";
import { TierGate } from "@/ui/components/TierGate";
import { useConfirmDialog } from "@/ui/components/shared/useConfirmDialog";
import { Button } from "@/ui/shadcn/button";
import { Input } from "@/ui/shadcn/input";
import { Label } from "@/ui/shadcn/label";
import { Switch } from "@/ui/shadcn/switch";

function errMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

function formatDate(d: Date | null): string {
  return d ? d.toLocaleString("ru-RU") : "—";
}

const SYNC_SCOPES: ReadonlyArray<{
  scope: BitrixSyncScope;
  label: string;
  icon: typeof Users;
}> = [
  { scope: "users", label: "Сотрудники", icon: Users },
  { scope: "dialogs", label: "Диалоги", icon: Plug },
  { scope: "crm", label: "CRM", icon: Building2 },
  { scope: "all", label: "Всё", icon: RefreshCw },
];

function syncScopeLabel(scope: BitrixSyncScope): string {
  return SYNC_SCOPES.find((s) => s.scope === scope)?.label ?? "Данные";
}

export function BitrixIntegrationClient() {
  return (
    <TierGate feature="feature.bitrix">
      <BitrixIntegrationContent />
    </TierGate>
  );
}

function BitrixIntegrationContent() {
  const { data, error, isLoading, mutate } = useSWR(
    ["bitrix-integration"],
    () => bitrixApi.getIntegration().then(mapBitrixIntegration),
    { revalidateOnFocus: false },
  );

  const handledRef = useRef(false);
  useEffect(() => {
    if (handledRef.current || typeof window === "undefined") return;
    const status = new URLSearchParams(window.location.search).get("bitrix");
    if (status === "connected") {
      handledRef.current = true;
      toast.success("Bitrix24 подключён");
      void mutate();
    } else if (status === "error") {
      handledRef.current = true;
      toast.error("Не удалось подключить Bitrix24");
    }
  }, [mutate]);

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
          style={{ background: GRAD.blue, color: "oklch(0.99 0.005 280)" }}
        >
          <Building2 size={20} />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
            Bitrix24
          </h1>
          <p className="text-sm text-fg-secondary">
            Внутренние чаты и CRM портала Bitrix24 — в память компании.
          </p>
        </div>
      </header>

      {error && !isLoading ? (
        <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          {errMessage(error, "Не удалось загрузить интеграцию")}
        </div>
      ) : isLoading ? (
        <div className="flex items-center justify-center py-16 text-sm text-fg-tertiary">
          <Loader2 size={16} className="mr-2 animate-spin" /> Загружаем...
        </div>
      ) : data ? (
        <ConnectedView integration={data} onChanged={() => void mutate()} />
      ) : (
        <ConnectForm onConnected={() => void mutate()} />
      )}
    </div>
  );
}

function ConnectForm({ onConnected }: { onConnected: () => void }) {
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);

  const handleConnect = async () => {
    const normalized = domain.trim();
    if (!normalized) {
      toast.error("Введите домен портала, например acme.bitrix24.ru");
      return;
    }
    setBusy(true);
    try {
      await bitrixApi.claimByDomain(normalized);
      toast.success("Портал Bitrix24 привязан к вашей компании");
      onConnected();
      return;
    } catch (e) {
      if (e instanceof ApiError && e.code === "bitrix_pending_not_found") {
        try {
          const { url } = await bitrixApi.getAuthorizeUrl(normalized);
          window.location.href = url;
          return;
        } catch (e2) {
          toast.error(errMessage(e2, "Не удалось начать подключение"));
          setBusy(false);
          return;
        }
      }
      toast.error(errMessage(e, "Не удалось подключить Bitrix24"));
      setBusy(false);
    }
  };

  return (
    <GlassCard className="space-y-4">
      <CardTitle icon={<Building2 size={16} />} grad={GRAD.blue}>
        Подключить портал
      </CardTitle>
      <p className="max-w-[68ch] text-sm text-fg-secondary">
        Введите домен портала Bitrix24. Если приложение уже установлено из
        Маркета — портал привяжется сразу. Иначе откроется окно авторизации;
        после подтверждения вернётесь сюда: свяжете сотрудников и запустите
        первую синхронизацию.
      </p>
      <div className="space-y-1.5">
        <Label htmlFor="bitrix-domain">Домен портала</Label>
        <Input
          id="bitrix-domain"
          placeholder="acme.bitrix24.ru"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          disabled={busy}
          className="max-w-sm"
        />
      </div>
      <Button onClick={() => void handleConnect()} disabled={busy} size="sm">
        {busy ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <Plug size={16} />
        )}
        Подключить Bitrix24
      </Button>
    </GlassCard>
  );
}

function ConnectedView({
  integration,
  onChanged,
}: {
  integration: BitrixIntegrationView;
  onChanged: () => void;
}) {
  const [analysisEnabled, setAnalysisEnabled] = useState(false);
  const [savingAnalysis, setSavingAnalysis] = useState(false);
  const [syncingScope, setSyncingScope] = useState<BitrixSyncScope | null>(
    null,
  );
  const [syncing, setSyncing] = useState(false);
  const [activeSyncScope, setActiveSyncScope] =
    useState<BitrixSyncScope | null>(null);
  const [deleting, setDeleting] = useState(false);
  const syncBaselineRef = useRef<string | null>(null);
  const syncStartMsRef = useRef<number>(0);
  const { ask, dialog: confirmDialog } = useConfirmDialog();

  const { data: status, mutate: mutateStatus } = useSWR(
    ["bitrix-status"],
    () => bitrixApi.getStatus().then(mapBitrixStatus),
    {
      refreshInterval: (latest) =>
        syncing || (latest?.runningScopes?.length ?? 0) > 0 ? 2500 : 0,
      revalidateOnFocus: false,
    },
  );

  const serverSyncing = (status?.runningScopes?.length ?? 0) > 0;

  const analysisSyncedRef = useRef(false);
  useEffect(() => {
    if (!analysisSyncedRef.current && status) {
      analysisSyncedRef.current = true;
      setAnalysisEnabled(status.analysisEnabled);
    }
  }, [status]);

  useEffect(() => {
    if (!syncing) return;
    const cur = status?.lastIncrementalSyncAt?.toISOString() ?? null;
    const done =
      (cur && cur !== syncBaselineRef.current) ||
      Date.now() - syncStartMsRef.current > 240_000;
    if (done && !serverSyncing) {
      setSyncing(false);
      setActiveSyncScope(null);
      toast.success("Синхронизация завершена");
      onChanged();
    }
  }, [syncing, status, onChanged, serverSyncing]);

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
      await bitrixApi.setAnalysis(next);
      toast.success(next ? "AI-анализ включён" : "AI-анализ выключен");
      void mutateStatus();
    } catch (e) {
      setAnalysisEnabled(!next);
      toast.error(errMessage(e, "Не удалось сохранить"));
    } finally {
      setSavingAnalysis(false);
    }
  };

  const handleSync = async (scope: BitrixSyncScope) => {
    setSyncingScope(scope);
    try {
      await bitrixApi.sync(scope);
      syncBaselineRef.current =
        status?.lastIncrementalSyncAt?.toISOString() ?? null;
      syncStartMsRef.current = Date.now();
      setActiveSyncScope(scope);
      setSyncing(true);
      void mutateStatus();
      toast.success(`Запущена синхронизация: ${syncScopeLabel(scope)}`);
    } catch (e) {
      toast.error(errMessage(e, "Не удалось запустить синхронизацию"));
    } finally {
      setSyncingScope(null);
    }
  };

  const handleDelete = async () => {
    const ok = await ask({
      title: "Отключить Bitrix24?",
      description:
        "Токены портала будут удалены, синхронизация прекратится. Уже собранные данные останутся в памяти компании.",
      confirmLabel: "Отключить",
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await bitrixApi.deleteIntegration();
      toast.success("Bitrix24 отключён");
      onChanged();
    } catch (e) {
      toast.error(errMessage(e, "Не удалось отключить"));
    } finally {
      setDeleting(false);
    }
  };

  const c = status?.counts;

  return (
    <div className="space-y-5">
      {}
      <GlassCard className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <CardTitle icon={<Building2 size={16} />} grad={GRAD.blue}>
            {integration.portalDomain}
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

          {(syncing || serverSyncing) && (
            <div
              className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl px-3 py-2.5 text-sm"
              style={{ background: STATUS_TONE.ok.bg }}
            >
              <Loader2 size={14} className="animate-spin text-accent" />
              <span className="font-medium text-fg-primary">
                {(() => {
                  const scope = activeSyncScope ?? status?.activeSyncScope ?? null;
                  return scope
                    ? `Синхронизируем: ${syncScopeLabel(scope)}…`
                    : "Идёт синхронизация…";
                })()}
              </span>
              {c && (
                <span className="text-fg-secondary">
                  собрано: {c.users.toLocaleString("ru-RU")} сотрудников ·{" "}
                  {c.dialogs.toLocaleString("ru-RU")} диалогов ·{" "}
                  {c.sessions.toLocaleString("ru-RU")} сессий
                </span>
              )}
            </div>
          )}
        </div>

        {}
        <div className="flex items-start justify-between gap-4 border-t border-border-subtle pt-5">
          <div className="min-w-0 max-w-[68ch]">
            <p className="text-sm font-medium text-fg-primary">
              AI-анализ переписок
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-fg-tertiary">
              Включено: Кора строит посуточные summary диалогов и добавляет
              знания в граф (расходует LLM). Выключено: диалоги просто
              зеркалятся.
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
          Связи с сотрудниками
        </CardTitle>
        <p className="max-w-[68ch] text-sm text-fg-secondary">
          Свяжите сотрудников портала Bitrix24 с людьми компании, чтобы Кора
          верно приписывала знания из внутренних переписок.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/company-admin/sources/bitrix/managers">
            <Users size={14} />
            Сопоставить сотрудников
          </Link>
        </Button>
      </GlassCard>

      {}
      <GlassCard className="space-y-4">
        <CardTitle icon={<Database size={16} />} grad={GRAD.violet}>
          Статус данных
        </CardTitle>
        {c ? (
          <>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {(
                [
                  { key: "users", label: "Сотрудники" },
                  { key: "dialogs", label: "Диалоги" },
                  { key: "sessions", label: "Сессии" },
                  { key: "contacts", label: "Контакты" },
                  { key: "companies", label: "Компании" },
                  { key: "deals", label: "Сделки" },
                  { key: "leads", label: "Лиды" },
                  { key: "notes", label: "Заметки" },
                ] as const
              ).map(({ key, label }) => (
                <div
                  key={key}
                  className="rounded-xl border border-border-subtle bg-[oklch(1_0_0/0.03)] px-3 py-2.5"
                >
                  <div className="text-xl font-semibold tabular-nums text-fg-primary">
                    {c[key].toLocaleString("ru-RU")}
                  </div>
                  <div className="mt-0.5 text-[11px] text-fg-tertiary">
                    {label}
                  </div>
                </div>
              ))}
            </div>
            {status && (
              <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border-subtle pt-3 text-xs text-fg-tertiary">
                <span>Полная: {formatDate(status.lastFullSyncAt)}</span>
                <span>
                  Инкрементальная: {formatDate(status.lastIncrementalSyncAt)}
                </span>
                <span>
                  Сессии: {status.sessionsByStatus.done} проанализировано ·{" "}
                  {status.sessionsByStatus.pending} в очереди
                </span>
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center text-sm text-fg-tertiary">
            <Loader2 size={14} className="mr-2 animate-spin" /> Загружаем...
          </div>
        )}
      </GlassCard>

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
