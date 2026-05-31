'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Trash2 } from 'lucide-react';

import { ApiError } from '@/api/api-error';
import { orgAdminKnowledgeApi } from '@/api/org-admin-knowledge.api';
import { formatUsd } from '@/domain/admin-usage';
import {
  KNOWN_WORKER_KEYS,
  WORKER_LABELS,
  orgAdminAuditLogListFromApi,
  orgAdminLinksFromApi,
  orgAdminMetricsFromApi,
  type OrgAdminLinkKind,
  type OrgAdminLinksDomain,
  type OrgAdminMetricsDomain,
} from '@/domain/org-admin-knowledge';
import { toast } from 'sonner';
import { useConfirmDialog } from '@/ui/components/shared/useConfirmDialog';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/ui/shadcn/card';
import { Input } from '@/ui/shadcn/input';
import { Switch } from '@/ui/shadcn/switch';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/ui/shadcn/tabs';

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '@app/(admin)/admin/AdminStateViews';
import { useCurrentOrgId } from '../useCurrentOrgId';

export function KnowledgeCoreClient() {
  const { orgId, isLoading: orgLoading, error: orgError } = useCurrentOrgId();

  if (orgLoading) return <AdminLoading rows={3} />;
  if (orgError) return <AdminError message={orgError} />;
  if (orgId === undefined) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Вы не состоите ни в одной Org. Попросите владельца пригласить вас."
      />
    );
  }

  return <KnowledgeCoreContent orgId={orgId!} />;
}

function KnowledgeCoreContent({ orgId }: { orgId: string }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Отладка ядра знаний</h1>
        <p className="text-sm text-fg-tertiary">
          Воркеры, журнал, связи, сущности и метрики вашей Org.
        </p>
      </div>

      <Tabs defaultValue="workers">
        <TabsList>
          <TabsTrigger value="workers">Воркеры</TabsTrigger>
          <TabsTrigger value="metrics">Метрики</TabsTrigger>
          <TabsTrigger value="audit">Журнал</TabsTrigger>
          <TabsTrigger value="links-block">Связи блоков</TabsTrigger>
          <TabsTrigger value="links-entity">Связи сущностей</TabsTrigger>
          <TabsTrigger value="reprocess">Reprocess</TabsTrigger>
        </TabsList>
        <TabsContent value="workers">
          <WorkersTab orgId={orgId} />
        </TabsContent>
        <TabsContent value="metrics">
          <MetricsTab orgId={orgId} />
        </TabsContent>
        <TabsContent value="audit">
          <AuditTab orgId={orgId} />
        </TabsContent>
        <TabsContent value="links-block">
          <LinksTab orgId={orgId} kind="block" />
        </TabsContent>
        <TabsContent value="links-entity">
          <LinksTab orgId={orgId} kind="entity" />
        </TabsContent>
        <TabsContent value="reprocess">
          <ReprocessTab orgId={orgId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Workers tab ────────────────────────────────────────────────────────────

function WorkersTab({ orgId }: { orgId: string }) {
  const [state, setState] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  // Тумблеры — берём начальное состояние из metrics (там нет — но
  // мы не загружаем org конфиг отдельно). Заводим дефолт «всё включено».
  useEffect(() => {
    const initial: Record<string, boolean> = {};
    for (const k of KNOWN_WORKER_KEYS) initial[k] = true;
    setState(initial);
  }, []);

  const toggle = async (worker: string, enabled: boolean) => {
    const prev = state[worker];
    setState((s) => ({ ...s, [worker]: enabled }));
    setPending(worker);
    try {
      const res = await orgAdminKnowledgeApi.setWorkers(orgId, {
        [worker]: enabled,
      });
      // Обновляем state из ответа.
      setState((s) => ({ ...s, ...(res.workersEnabled as Record<string, boolean>) }));
      toast.success('Сохранено');
    } catch (e) {
      // Откат UI.
      setState((s) => ({ ...s, [worker]: prev ?? true }));
      if (e instanceof ApiError && e.code === 'forbidden') {
        setForbidden(true);
      } else {
        toast.error(e instanceof ApiError ? e.message : 'Не удалось');
      }
    } finally {
      setPending(null);
    }
  };

  if (forbidden) {
    return (
      <AdminForbidden description="Управление воркерами доступно только owner / admin Org." />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Тумблеры воркеров</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-fg-tertiary">
          Если воркер выключен — джобы соответствующего типа для этой Org
          переходят в delayed на 5 минут (см. WorkerOrgGate). Включённое
          состояние = по умолчанию.
        </p>
        <ul className="divide-y divide-border-subtle">
          {KNOWN_WORKER_KEYS.map((w) => (
            <li
              key={w}
              className="flex items-center justify-between py-2.5"
            >
              <div>
                <div className="text-sm font-medium">
                  {WORKER_LABELS[w] ?? w}
                </div>
                <code className="font-mono text-[10px] text-fg-tertiary">
                  {w}
                </code>
              </div>
              <Switch
                checked={state[w] ?? true}
                onCheckedChange={(v) => void toggle(w, v)}
                disabled={pending === w}
              />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ─── Metrics tab ────────────────────────────────────────────────────────────

function MetricsTab({ orgId }: { orgId: string }) {
  const [data, setData] = useState<OrgAdminMetricsDomain | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const res = await orgAdminKnowledgeApi.getMetrics(orgId);
      setData(orgAdminMetricsFromApi(res));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'forbidden') {
        setForbidden(true);
      } else {
        setError(e instanceof ApiError ? e.message : 'Ошибка');
      }
    } finally {
      setIsLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void fetch();
  }, [fetch]);

  if (isLoading) return <AdminLoading rows={4} />;
  if (forbidden) return <AdminForbidden />;
  if (error) return <AdminError message={error} onRetry={fetch} />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile label="RawEvents" value={data.rawEvents.total.toLocaleString('ru-RU')} sub={`+${data.rawEvents.recent7d} за 7д`} />
        <MetricTile
          label="Idea blocks"
          value={data.blocks.total.toLocaleString('ru-RU')}
          sub={`canonical: ${data.blocks.canonical}`}
        />
        <MetricTile
          label="Сущности"
          value={data.entities.total.toLocaleString('ru-RU')}
        />
        <MetricTile
          label="Активные темы"
          value={data.themes.active.toLocaleString('ru-RU')}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Связи (active)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span>между блоками</span>
              <span className="tabular-nums">
                {data.links.block.active.toLocaleString('ru-RU')}
              </span>
            </div>
            <div className="flex justify-between">
              <span>между сущностями</span>
              <span className="tabular-nums">
                {data.links.entity.active.toLocaleString('ru-RU')}
              </span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">LLM расход</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-fg-tertiary">за 24 часа</span>
              <span className="font-medium tabular-nums">
                {formatUsd(data.llm.last24h.costUsd)}
              </span>
            </div>
            <div className="flex justify-between text-xs text-fg-tertiary">
              <span>{data.llm.last24h.calls} вызовов</span>
              <span>
                {data.llm.last24h.inputTokens}/{data.llm.last24h.outputTokens} ток.
              </span>
            </div>
            <div className="mt-2 flex justify-between">
              <span className="text-fg-tertiary">за 7 дней</span>
              <span className="font-medium tabular-nums">
                {formatUsd(data.llm.last7d.costUsd)}
              </span>
            </div>
            <div className="flex justify-between text-xs text-fg-tertiary">
              <span>{data.llm.last7d.calls} вызовов</span>
              <span>
                {data.llm.last7d.inputTokens}/{data.llm.last7d.outputTokens} ток.
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="text-xs text-fg-tertiary">{label}</div>
        <div className="text-xl font-semibold tabular-nums">{value}</div>
        {sub && <div className="text-xs text-fg-tertiary">{sub}</div>}
      </CardContent>
    </Card>
  );
}

// ─── Audit tab ──────────────────────────────────────────────────────────────

function AuditTab({ orgId }: { orgId: string }) {
  const [data, setData] = useState<ReturnType<typeof orgAdminAuditLogListFromApi> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const res = await orgAdminKnowledgeApi.getAuditLogs(orgId, { limit: 200 });
      setData(orgAdminAuditLogListFromApi(res));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'forbidden') setForbidden(true);
      else setError(e instanceof ApiError ? e.message : 'Ошибка');
    } finally {
      setIsLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void fetch();
  }, [fetch]);

  if (isLoading) return <AdminLoading rows={5} />;
  if (forbidden) return <AdminForbidden />;
  if (error) return <AdminError message={error} onRetry={fetch} />;
  if (!data || data.items.length === 0) {
    return (
      <p className="text-sm text-fg-tertiary">Журнал событий пуст.</p>
    );
  }

  return (
    <ul className="space-y-1 font-mono text-xs">
      {data.items.map((a) => (
        <li
          key={a.id}
          className="rounded border border-border-subtle bg-bg-card px-2 py-1"
        >
          <span className="text-fg-tertiary">
            {a.createdAt.toLocaleString('ru-RU')}
          </span>
          {' · '}
          <span className="font-medium">{a.action}</span>
          {a.resourceId && (
            <>
              {' · '}
              <span className="text-fg-tertiary">res: {a.resourceId}</span>
            </>
          )}
          {a.userId && (
            <>
              {' · '}
              <span className="text-fg-tertiary">user: {a.userId.slice(0, 8)}…</span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

// ─── Links tab ──────────────────────────────────────────────────────────────

function LinksTab({
  orgId,
  kind,
}: {
  orgId: string;
  kind: OrgAdminLinkKind;
}) {
  const [data, setData] = useState<OrgAdminLinksDomain | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minConfidence, setMinConfidence] = useState('');
  const [busy, setBusy] = useState(false);
  const { ask, dialog: confirmDialog } = useConfirmDialog();

  const fetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const res = await orgAdminKnowledgeApi.listLinks(orgId, {
        kind,
        sortBy: 'createdAt',
        ...(minConfidence ? { minConfidence: Number(minConfidence) } : {}),
        limit: 100,
      });
      setData(orgAdminLinksFromApi(res));
    } catch (e) {
      if (e instanceof ApiError && e.code === 'forbidden') setForbidden(true);
      else setError(e instanceof ApiError ? e.message : 'Ошибка');
    } finally {
      setIsLoading(false);
    }
  }, [orgId, kind, minConfidence]);

  useEffect(() => {
    void fetch();
  }, [fetch]);

  const handleDelete = async (id: string) => {
    const ok = await ask({
      title: 'Удалить связь?',
      description: 'Soft-delete на 30 дней.',
      confirmLabel: 'Удалить',
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await orgAdminKnowledgeApi.deleteLink(orgId, id, kind);
      toast.success('Удалено');
      void fetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Не удалось');
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return <AdminLoading rows={5} />;
  if (forbidden) return <AdminForbidden />;
  if (error) return <AdminError message={error} onRetry={fetch} />;
  if (!data) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-2">
        <div>
          <label className="text-xs text-fg-tertiary">min confidence</label>
          <Input
            type="number"
            step="0.01"
            min={0}
            max={1}
            value={minConfidence}
            onChange={(e) => setMinConfidence(e.target.value)}
            className="h-8 w-32"
          />
        </div>
        <Button size="sm" variant="secondary" onClick={fetch}>
          <RefreshCw size={12} /> Обновить
        </Button>
      </div>

      {data.items.length === 0 ? (
        <p className="text-sm text-fg-tertiary">Активных связей нет.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border-subtle">
          <table className="w-full text-xs">
            <thead className="bg-bg-overlay text-fg-tertiary">
              <tr>
                <th className="px-2 py-1 text-left">From → To</th>
                <th className="px-2 py-1 text-left">Тип</th>
                <th className="px-2 py-1 text-right">Confidence</th>
                <th className="px-2 py-1 text-left">Источник</th>
                <th className="px-2 py-1 text-left">Когда</th>
                <th className="px-2 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((l) => (
                <tr key={l.id} className="border-t border-border-subtle">
                  <td className="px-2 py-1 font-mono">
                    {kind === 'block'
                      ? `${(l as { fromBlockId: string }).fromBlockId.slice(0, 6)}… → ${(l as { toBlockId: string }).toBlockId.slice(0, 6)}…`
                      : `${(l as { fromEntityId: string }).fromEntityId.slice(0, 6)}… → ${(l as { toEntityId: string }).toEntityId.slice(0, 6)}…`}
                  </td>
                  <td className="px-2 py-1">{l.relationType}</td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {l.confidence.toFixed(2)}
                  </td>
                  <td className="px-2 py-1">
                    <Badge variant="secondary" className="text-[9px]">
                      {l.createdBy}
                    </Badge>
                  </td>
                  <td className="px-2 py-1 text-fg-tertiary">
                    {l.createdAt.toLocaleDateString('ru-RU')}
                  </td>
                  <td className="px-2 py-1 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleDelete(l.id)}
                      disabled={busy}
                      className="text-danger hover:bg-danger/10"
                    >
                      <Trash2 size={12} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}

// ─── Reprocess tab ──────────────────────────────────────────────────────────

function ReprocessTab({ orgId }: { orgId: string }) {
  const [rawEventId, setRawEventId] = useState('');
  const [busy, setBusy] = useState(false);
  const { ask, dialog: confirmDialog } = useConfirmDialog();

  const handleReprocess = async () => {
    if (!rawEventId.trim()) {
      toast.error('Введите rawEventId');
      return;
    }
    const ok = await ask({
      title: 'Перезапустить pipeline для этого RawEvent?',
      description: 'Существующие idea_blocks будут удалены, потом созданы заново.',
      confirmLabel: 'Перезапустить',
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await orgAdminKnowledgeApi.reprocessRawEvent(
        orgId,
        rawEventId.trim(),
      );
      toast.success(`Перезапущено. Удалено блоков: ${res.deletedBlocks}.`);
      setRawEventId('');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Не удалось');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Reprocess RawEvent</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-fg-tertiary">
          Опасная операция: удалит все Idea blocks, созданные из этого RawEvent
          (со связями и evidence), и заново отправит в очередь block-ingest.
          Используйте, если pipeline отработал криво и нужно перезапустить.
        </p>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="text-xs text-fg-tertiary">RawEvent ID</label>
            <Input
              value={rawEventId}
              onChange={(e) => setRawEventId(e.target.value)}
              placeholder="cuid…"
              className="font-mono"
            />
          </div>
          <Button onClick={() => void handleReprocess()} disabled={busy}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Перезапустить
          </Button>
        </div>
      </CardContent>
      {confirmDialog}
    </Card>
  );
}
