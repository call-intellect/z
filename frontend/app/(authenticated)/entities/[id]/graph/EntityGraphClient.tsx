'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  AlertTriangle,
  Calendar,
  Flag,
  Info,
  Loader2,
  Quote,
  X,
} from 'lucide-react';
import { toast } from 'sonner';

import { ApiError } from '@/api/api-error';
import {
  entitiesGraphApi,
  type EntityGraphResultApi,
} from '@/api/entities-graph.api';
import { useAuth } from '@/contexts/auth-context';
import {
  edgeColorByConfidence,
  mapEntityGraph,
  type EntityGraph,
  type EntityGraphEdge,
  type EntityGraphNode,
} from '@/domain/entity-graph';
import { Button } from '@/ui/shadcn/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/shadcn/dialog';
import { Label } from '@/ui/shadcn/label';
import { Textarea } from '@/ui/shadcn/textarea';

import {
  AdminError,
  AdminForbidden,
  AdminLoading,
} from '@app/(admin)/admin/AdminStateViews';
import { ForceGraphCanvas } from './ForceGraphCanvas';

/**
 * G.3 — UI «что система знает про X» (entity-centric Карта знаний).
 *
 * Источник: plans/tz/2026-05-25-knowledge-core-temporal-and-graph-quality.md
 * раздел «G.3».
 *
 * Слои:
 *   - Container: SWR-запрос `entitiesGraphApi.getGraph(entityId, depth=2)`.
 *   - Visualization: `ForceGraphCanvas` (react-force-graph-2d через dynamic
 *     import, ssr:false). Hover на ребро → tooltip с top-1 evidence.
 *   - Side panel: «Как мы это узнали» — top-3 source blocks (block name +
 *     цитата + timestamp).
 *   - Mark-wrong modal: textarea «reason» → POST `/mark-wrong`.
 *
 * Стиль — dark-first, mint #5EEAD4 accent (как `/decisions`, `/insights`).
 */
export function EntityGraphClient({ entityId }: { entityId: string }) {
  const { currentOrgId, isLoading: authLoading } = useAuth();
  if (authLoading) return <AdminLoading rows={4} />;
  if (!currentOrgId) {
    return (
      <AdminForbidden
        title="Нет организации"
        description="Вы не состоите ни в одной Org."
      />
    );
  }
  return <EntityGraphContent entityId={entityId} orgId={currentOrgId} />;
}

interface DepthOption {
  value: 1 | 2 | 3;
  label: string;
}

const DEPTH_OPTIONS: ReadonlyArray<DepthOption> = [
  { value: 1, label: 'Прямые соседи (1)' },
  { value: 2, label: 'Соседи соседей (2)' },
  { value: 3, label: 'Глубоко (3)' },
];

function EntityGraphContent({
  entityId,
  orgId,
}: {
  entityId: string;
  orgId: string;
}) {
  const [depth, setDepth] = useState<1 | 2 | 3>(2);
  const swrKey = useMemo(
    () =>
      ['entity-graph', orgId, entityId, depth] as readonly [
        string,
        string,
        string,
        number,
      ],
    [orgId, entityId, depth],
  );

  const { data, error, isLoading, mutate } = useSWR<EntityGraphResultApi>(
    swrKey,
    () => entitiesGraphApi.getGraph(orgId, entityId, { depth }),
    { revalidateOnFocus: false },
  );

  const graph: EntityGraph | null = useMemo(
    () => (data ? mapEntityGraph(data) : null),
    [data],
  );

  // Выбор для side-panel «Как мы это узнали».
  const [selectedEdge, setSelectedEdge] = useState<EntityGraphEdge | null>(null);
  const [selectedNode, setSelectedNode] = useState<EntityGraphNode | null>(null);

  // Mark-wrong modal state.
  const [markTarget, setMarkTarget] = useState<
    | { kind: 'edge'; edge: EntityGraphEdge }
    | { kind: 'node'; node: EntityGraphNode }
    | null
  >(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Сбрасываем selection при смене сущности.
  useEffect(() => {
    setSelectedEdge(null);
    setSelectedNode(null);
    setMarkTarget(null);
    setReason('');
  }, [entityId, depth]);

  const handleMarkWrong = useCallback(async () => {
    if (!markTarget) return;
    setSubmitting(true);
    try {
      if (markTarget.kind === 'edge') {
        await entitiesGraphApi.markWrong(orgId, entityId, {
          edgeId: markTarget.edge.edgeId,
          reason: reason.trim() || undefined,
        });
        toast.success('Ребро помечено как неверное. Спасибо за обратную связь!');
      } else {
        await entitiesGraphApi.markWrong(orgId, entityId, {
          nodeId: markTarget.node.id,
          reason: reason.trim() || undefined,
        });
        toast.success('Узел помечен как неверный.');
      }
      setMarkTarget(null);
      setReason('');
      await mutate();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : 'Не удалось отправить отметку. Попробуйте позже.';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }, [markTarget, orgId, entityId, reason, mutate]);

  if (isLoading) return <AdminLoading rows={6} />;
  if (error instanceof ApiError && error.code === 'forbidden') {
    return (
      <AdminForbidden
        title="Нет доступа"
        description="У вас нет прав на чтение карты знаний этой сущности."
      />
    );
  }
  if (error) {
    return (
      <AdminError
        message={
          error instanceof Error
            ? `Ошибка загрузки: ${error.message}`
            : 'Неизвестная ошибка при загрузке карты знаний'
        }
        onRetry={() => mutate()}
      />
    );
  }
  if (!graph) return <AdminLoading rows={6} />;

  return (
    <div className="flex h-full min-h-[calc(100vh-4rem)] flex-col gap-4 p-4 lg:p-6">
      <header className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">
            Что система знает про:{' '}
            <span className="text-[#5EEAD4]">{graph.center.label}</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Узлов: {graph.nodes.length}, рёбер: {graph.edges.length}
            {graph.truncated && (
              <span className="ml-2 inline-flex items-center gap-1 rounded bg-amber-500/20 px-2 py-0.5 text-xs text-warning">
                <AlertTriangle className="h-3 w-3" /> Результат обрезан (лимит
                100 узлов)
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Label
            htmlFor="depth-select"
            className="text-sm text-muted-foreground"
          >
            Глубина:
          </Label>
          <select
            id="depth-select"
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value) as 1 | 2 | 3)}
            className="rounded-md border border-border-subtle bg-bg-overlay px-3 py-1.5 text-sm text-foreground"
          >
            {DEPTH_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        {/* Канва графа */}
        <div className="relative min-h-[480px] overflow-hidden rounded-xl border border-border-subtle bg-bg-overlay backdrop-blur">
          <ForceGraphCanvas
            graph={graph}
            onEdgeClick={(edge) => {
              setSelectedEdge(edge);
              setSelectedNode(null);
            }}
            onNodeClick={(node) => {
              setSelectedNode(node);
              setSelectedEdge(null);
            }}
          />
          {graph.edges.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-center text-sm text-muted-foreground">
              Связей пока нет. Когда специалисты Слоя&nbsp;3 проиндексируют
              встречи / чаты, связи появятся здесь.
            </div>
          )}
        </div>

        {/* Side panel */}
        <aside className="flex max-h-[78vh] flex-col gap-4 overflow-y-auto rounded-xl border border-border-subtle bg-bg-overlay p-4 backdrop-blur">
          {selectedEdge ? (
            <EdgeDetailsPanel
              edge={selectedEdge}
              center={graph.center}
              nodes={graph.nodes}
              onClose={() => setSelectedEdge(null)}
              onMarkWrong={() =>
                setMarkTarget({ kind: 'edge', edge: selectedEdge })
              }
            />
          ) : selectedNode ? (
            <NodeDetailsPanel
              node={selectedNode}
              onClose={() => setSelectedNode(null)}
              onMarkWrong={() =>
                setMarkTarget({ kind: 'node', node: selectedNode })
              }
            />
          ) : (
            <EmptyPanel />
          )}
        </aside>
      </div>

      {/* Mark-wrong modal */}
      <Dialog
        open={markTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setMarkTarget(null);
            setReason('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Flag className="h-4 w-4 text-red-400" /> Это неверно?
            </DialogTitle>
            <DialogDescription>
              Ваша отметка попадёт в обучающий датасет — система научится не
              делать такую ошибку повторно.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="reason-textarea">
              Расскажите, что не так (опционально)
            </Label>
            <Textarea
              id="reason-textarea"
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Например: связь устарела, неверный тип отношения, путаница с однофамильцем…"
              maxLength={4000}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setMarkTarget(null);
                setReason('');
              }}
              disabled={submitting}
            >
              Отмена
            </Button>
            <Button onClick={handleMarkWrong} disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Отправляем…
                </>
              ) : (
                'Подтвердить «Это неверно»'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ──────────────────────── Side panels ─────────────────────────────────

function EmptyPanel() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
      <Info className="h-8 w-8 opacity-60" />
      <p className="max-w-[260px]">
        Кликните на ребро — увидите top-3 источника, на основании которых
        система построила эту связь.
      </p>
      <p className="max-w-[260px]">
        Кликните на узел — увидите детали сущности и сможете пометить её как
        «неверную».
      </p>
    </div>
  );
}

function EdgeDetailsPanel({
  edge,
  center,
  nodes,
  onClose,
  onMarkWrong,
}: {
  edge: EntityGraphEdge;
  center: { id: string; label: string };
  nodes: EntityGraphNode[];
  onClose: () => void;
  onMarkWrong: () => void;
}) {
  const fromLabel = nodeLabelById(edge.from, nodes, center);
  const toLabel = nodeLabelById(edge.to, nodes, center);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Связь
          </p>
          <p className="mt-0.5 text-base font-semibold text-foreground">
            {fromLabel}{' '}
            <span className="text-[#5EEAD4]">{edge.relationLabel}</span>{' '}
            {toLabel}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} title="Закрыть">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-lg border border-border-subtle bg-bg-overlay p-3 text-xs">
        <div>
          <p className="text-muted-foreground">Уверенность</p>
          <p className="mt-0.5 font-medium text-foreground">
            {edge.confidencePercent}%
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">Тип связи</p>
          <p className="mt-0.5 font-medium text-foreground">
            {edge.relationType}
          </p>
        </div>
        <div className="col-span-2">
          <p className="flex items-center gap-1 text-muted-foreground">
            <Calendar className="h-3 w-3" /> Период действия
          </p>
          <p
            className={`mt-0.5 font-medium ${
              edge.isExpired ? 'text-muted-foreground line-through' : 'text-foreground'
            }`}
          >
            {edge.periodLabel}
          </p>
        </div>
        {edge.attributes && Object.keys(edge.attributes).length > 0 && (
          <div className="col-span-2">
            <p className="text-muted-foreground">Атрибуты</p>
            <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap break-words text-[11px] text-foreground/90">
              {JSON.stringify(edge.attributes, null, 2)}
            </pre>
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-foreground">
          Как мы это узнали ({edge.evidence.length})
        </h3>
        {edge.evidence.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Источников нет. Возможно, связь была создана старым пайплайном без
            трассировки.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {edge.evidence.map((ev) => (
              <li
                key={ev.blockId}
                className="rounded-md border border-border-subtle bg-bg-overlay p-3 text-xs"
              >
                <p className="font-medium text-foreground">{ev.blockName}</p>
                <p className="mt-1 flex items-start gap-1 text-foreground/80">
                  <Quote className="mt-0.5 h-3 w-3 shrink-0 text-[#5EEAD4]" />
                  <span className="italic">«{ev.quote}»</span>
                </p>
                {ev.sourceTimestamp && (
                  <p className="mt-1 text-muted-foreground">
                    {ev.sourceTimestamp.toLocaleString('ru-RU', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Button
        variant="outline"
        className="border-red-500/40 text-red-400 hover:bg-red-500/10"
        onClick={onMarkWrong}
      >
        <Flag className="mr-2 h-4 w-4" /> Это неверно
      </Button>
    </div>
  );
}

function NodeDetailsPanel({
  node,
  onClose,
  onMarkWrong,
}: {
  node: EntityGraphNode;
  onClose: () => void;
  onMarkWrong: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Узел
          </p>
          <p className="mt-0.5 text-base font-semibold text-foreground">
            {node.label}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} title="Закрыть">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="rounded-lg border border-border-subtle bg-bg-overlay p-3 text-xs">
        <p>
          <span className="text-muted-foreground">Тип: </span>
          <span className="font-medium text-foreground">{node.entityType}</span>
        </p>
        <p className="mt-1">
          <span className="text-muted-foreground">Глубина от центра: </span>
          <span className="font-medium text-foreground">{node.depth}</span>
        </p>
      </div>
      {!node.isCenter && (
        <Button
          variant="outline"
          className="border-red-500/40 text-red-400 hover:bg-red-500/10"
          onClick={onMarkWrong}
        >
          <Flag className="mr-2 h-4 w-4" /> Это неверная сущность
        </Button>
      )}
    </div>
  );
}

function nodeLabelById(
  id: string,
  nodes: EntityGraphNode[],
  center: { id: string; label: string },
): string {
  if (id === center.id) return center.label;
  return nodes.find((n) => n.id === id)?.label ?? id;
}

// Re-export для удобства tests / других страниц.
export { edgeColorByConfidence };
