'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType } from 'react';

import {
  edgeColorByConfidence,
  type EntityGraph,
  type EntityGraphEdge,
  type EntityGraphNode,
} from '@/domain/entity-graph';

/**
 * ForceGraphCanvas — обёртка над `react-force-graph-2d` с dynamic import
 * через `next/dynamic` (ssr:false). Библиотека использует Canvas/WebGL — она
 * не работает на сервере, плюс тяжёлая (~600KB).
 *
 * Зависимость `react-force-graph-2d` должна быть установлена через
 * `bun install` после merge'а (см. package.json). До установки —
 * рендерится fallback-каркас (узлы списком), чтобы typecheck/UX не падали.
 *
 * Узлы:
 *   - center (depth=0) — крупный, mint #5EEAD4.
 *   - depth=1 — средний, светло-голубой.
 *   - depth=2..3 — мельче, серый.
 *
 * Рёбра:
 *   - цвет — по confidence (red < 0.4 ≤ amber < 0.7 ≤ mint).
 *   - истекшие (validUntil < now) — пунктир + полупрозрачные.
 *
 * Hover на ребро — встроенный tooltip библиотеки. Клик — `onEdgeClick`.
 */

interface GraphLibNode {
  id: string;
  label: string;
  entityType: string;
  depth: number;
  isCenter: boolean;
  /** Visual size (1..12). */
  val: number;
  color: string;
}

interface GraphLibLink {
  source: string;
  target: string;
  edgeId: string;
  color: string;
  label: string;
  tooltip: string;
  isExpired: boolean;
}

interface ForceGraphProps {
  graphData: { nodes: GraphLibNode[]; links: GraphLibLink[] };
  nodeId: string;
  nodeLabel: string;
  nodeVal: string;
  nodeColor: string;
  linkColor: string;
  linkLabel: string;
  linkSource: string;
  linkTarget: string;
  linkDirectionalArrowLength: number;
  linkDirectionalArrowRelPos: number;
  linkWidth: number | ((link: GraphLibLink) => number);
  linkLineDash?: number[] | ((link: GraphLibLink) => number[] | null);
  onLinkClick?: (link: GraphLibLink) => void;
  onNodeClick?: (node: GraphLibNode) => void;
  width?: number;
  height?: number;
  cooldownTicks?: number;
  backgroundColor?: string;
}

// Импорт через next/dynamic — ssr:false. Используем `unknown as` для
// typecheck-safe объявления (react-force-graph-2d может быть не установлен).
let CachedForceGraph2D: ComponentType<ForceGraphProps> | null = null;

async function loadForceGraph(): Promise<ComponentType<ForceGraphProps> | null> {
  if (CachedForceGraph2D) return CachedForceGraph2D;
  try {
    const mod = (await import(
      /* webpackIgnore: true */ 'react-force-graph-2d' as string
    )) as { default: ComponentType<ForceGraphProps> };
    CachedForceGraph2D = mod.default;
    return mod.default;
  } catch {
    return null;
  }
}

export function ForceGraphCanvas({
  graph,
  onEdgeClick,
  onNodeClick,
}: {
  graph: EntityGraph;
  onEdgeClick: (edge: EntityGraphEdge) => void;
  onNodeClick: (node: EntityGraphNode) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [LibComponent, setLibComponent] =
    useState<ComponentType<ForceGraphProps> | null>(null);
  const [libError, setLibError] = useState(false);

  useEffect(() => {
    let mounted = true;
    void loadForceGraph().then((comp) => {
      if (!mounted) return;
      if (comp) setLibComponent(() => comp);
      else setLibError(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const update = () => {
      const r = el.getBoundingClientRect();
      setSize({ width: Math.floor(r.width), height: Math.floor(r.height) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const data = useMemo(
    () => buildGraphData(graph),
    [graph],
  );

  const handleLinkClick = (lnk: GraphLibLink) => {
    const edge = graph.edges.find((e) => e.edgeId === lnk.edgeId);
    if (edge) onEdgeClick(edge);
  };
  const handleNodeClick = (n: GraphLibNode) => {
    const node = graph.nodes.find((x) => x.id === n.id);
    if (node) onNodeClick(node);
  };

  return (
    <div ref={containerRef} className="absolute inset-0">
      {LibComponent && size.width > 0 ? (
        <LibComponent
          graphData={data}
          nodeId="id"
          nodeLabel="label"
          nodeVal="val"
          nodeColor="color"
          linkColor="color"
          linkLabel="tooltip"
          linkSource="source"
          linkTarget="target"
          linkDirectionalArrowLength={4}
          linkDirectionalArrowRelPos={0.85}
          linkWidth={(link: GraphLibLink) => (link.isExpired ? 1 : 2)}
          linkLineDash={(link: GraphLibLink) =>
            link.isExpired ? [4, 4] : null
          }
          onLinkClick={handleLinkClick}
          onNodeClick={handleNodeClick}
          width={size.width}
          height={size.height}
          cooldownTicks={120}
          backgroundColor="rgba(0,0,0,0)"
        />
      ) : libError ? (
        <FallbackList
          graph={graph}
          onEdgeClick={onEdgeClick}
          onNodeClick={onNodeClick}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Загружаем визуализацию…
        </div>
      )}
    </div>
  );
}

// ──────────────────────── Helpers ─────────────────────────────────────

function buildGraphData(graph: EntityGraph): {
  nodes: GraphLibNode[];
  links: GraphLibLink[];
} {
  const nodes: GraphLibNode[] = graph.nodes.map((n) => ({
    id: n.id,
    label: n.label,
    entityType: n.entityType,
    depth: n.depth,
    isCenter: n.isCenter,
    val: n.isCenter ? 12 : n.depth === 1 ? 6 : 3,
    color: n.isCenter
      ? '#5EEAD4'
      : n.depth === 1
        ? '#93C5FD'
        : '#94A3B8',
  }));
  const links: GraphLibLink[] = graph.edges.map((e) => {
    const evidenceQuote = e.evidence[0]?.quote ?? '';
    return {
      source: e.from,
      target: e.to,
      edgeId: e.edgeId,
      color: e.isExpired
        ? 'rgba(148,163,184,0.4)'
        : edgeColorByConfidence(e.confidence),
      label: e.relationLabel,
      tooltip: `${e.relationLabel} (${e.confidencePercent}%) — ${e.periodLabel}${
        evidenceQuote ? `\n«${evidenceQuote}»` : ''
      }`,
      isExpired: e.isExpired,
    };
  });
  return { nodes, links };
}

/**
 * Fallback на случай, если `react-force-graph-2d` не установлен (например,
 * на CI до `bun install`) — простой список с кликабельными рёбрами.
 */
function FallbackList({
  graph,
  onEdgeClick,
  onNodeClick,
}: {
  graph: EntityGraph;
  onEdgeClick: (edge: EntityGraphEdge) => void;
  onNodeClick: (node: EntityGraphNode) => void;
}) {
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4 text-sm">
      <p className="text-xs text-amber-300">
        Визуализация графа недоступна (нужен `bun install` после merge'а).
        Показываем плоский список для просмотра данных.
      </p>
      <div>
        <h4 className="mb-2 font-semibold text-foreground">
          Узлы ({graph.nodes.length})
        </h4>
        <ul className="flex flex-wrap gap-2">
          {graph.nodes.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => onNodeClick(n)}
                className={`rounded border px-2 py-1 text-xs ${
                  n.isCenter
                    ? 'border-[#5EEAD4]/60 bg-[#5EEAD4]/10 text-[#5EEAD4]'
                    : 'border-white/10 bg-black/30 text-foreground hover:bg-black/50'
                }`}
              >
                {n.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h4 className="mb-2 font-semibold text-foreground">
          Связи ({graph.edges.length})
        </h4>
        <ul className="flex flex-col gap-1">
          {graph.edges.map((e) => (
            <li key={e.edgeId}>
              <button
                type="button"
                onClick={() => onEdgeClick(e)}
                className={`w-full rounded border border-white/10 bg-black/30 px-3 py-2 text-left text-xs hover:bg-black/50 ${
                  e.isExpired ? 'opacity-60' : ''
                }`}
              >
                <span className="font-medium text-foreground">
                  {e.from} → {e.to}
                </span>
                <span className="ml-2 text-[#5EEAD4]">{e.relationLabel}</span>
                <span className="ml-2 text-muted-foreground">
                  ({e.confidencePercent}%)
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
