"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import { toast } from "sonner";

import {
  buildGoalGraph,
  computeGoalAlignment,
  type GoalAlignment,
  type GoalMapLink,
  type GoalMapNode,
} from "@/domain/goal-map";
import {
  GOAL_PROGRESS_STATUS_LABELS,
  type GoalDomain,
  type GoalProgressStatus,
} from "@/domain/goal";
import {
  IDEA_STATUS_LABEL,
  type IdeaListItem,
  type IdeaStatus,
} from "@/domain/idea";
import { ideasApi } from "@/api/ideas.api";
import { goalsApi, type SuggestParentApi } from "@/api/goals.api";
import { humanizeApiError } from "@/api/api-error";

type NodeTone =
  | "success"
  | "warning"
  | "danger"
  | "muted"
  | "accent"
  | "info"
  | "edge"
  | "fg";

interface MapLibNode {
  id: string;
  kind: "goal" | "idea";
  label: string;
  alignment: GoalAlignment | null;
  isPrimary: boolean;
  tone: NodeTone;
  ideaStatus: IdeaStatus | null;
  ideaGoalId: string | null;
  val: number;
  fx?: number;
  fy?: number;
  x?: number;
  y?: number;
}

interface MapLibLink {
  source: string;
  target: string;
  kind: "parent" | "idea_goal";
}

interface ForceGraphProps {
  graphData: { nodes: MapLibNode[]; links: MapLibLink[] };
  nodeId: string;
  nodeLabel: string;
  nodeVal: string;
  nodeColor: (node: MapLibNode) => string;
  nodeCanvasObjectMode: string;
  nodeCanvasObject: (
    node: MapLibNode,
    ctx: CanvasRenderingContext2D,
    globalScale: number,
  ) => void;
  linkColor: (link: MapLibLink) => string;
  linkLineDash?: (link: MapLibLink) => number[] | null;
  linkSource: string;
  linkTarget: string;
  linkWidth: number;
  dagMode: "radialout";
  dagLevelDistance: number;
  dagNodeFilter: (node: MapLibNode) => boolean;
  onDagError?: (loopNodeIds: (string | number)[]) => void;
  onNodeClick?: (node: MapLibNode) => void;
  width?: number;
  height?: number;
  cooldownTicks?: number;
  backgroundColor?: string;
}

let CachedForceGraph2D: ComponentType<ForceGraphProps> | null = null;

async function loadForceGraph(): Promise<ComponentType<ForceGraphProps> | null> {
  if (CachedForceGraph2D) return CachedForceGraph2D;
  try {
    const mod = (await import(
      /* webpackIgnore: true */ "react-force-graph-2d" as string
    )) as { default: ComponentType<ForceGraphProps> };
    CachedForceGraph2D = mod.default;
    return mod.default;
  } catch {
    return null;
  }
}

type TonePalette = Record<NodeTone, string>;

function resolveTonePalette(): TonePalette {
  const root =
    typeof document !== "undefined" ? document.documentElement : null;
  const read = (name: string, fallback: string): string => {
    if (!root) return fallback;
    const value = getComputedStyle(root).getPropertyValue(name).trim();
    return value || fallback;
  };
  return {
    success: read("--chip-success-fg", "currentColor"),
    warning: read("--chip-warning-fg", "currentColor"),
    danger: read("--chip-danger-fg", "currentColor"),
    muted: read("--text-tertiary", "currentColor"),
    accent: read("--accent", "currentColor"),
    info: read("--chip-info-fg", "currentColor"),
    edge: read("--border-strong", "currentColor"),
    fg: read("--text-primary", "currentColor"),
  };
}

function progressTone(status: GoalProgressStatus | null): NodeTone {
  switch (status) {
    case "on_track":
    case "achieved":
      return "success";
    case "at_risk":
      return "warning";
    case "stalled":
      return "danger";
    case "dropped":
      return "muted";
    default:
      return "muted";
  }
}

function nodeTone(node: GoalMapNode): NodeTone {
  if (node.isPrimary) return "accent";
  if (node.alignment === "orphan") return "danger";
  return progressTone(node.progressStatus);
}

const ALIGNMENT_LABEL: Record<GoalAlignment, string> = {
  aligned: "Ведёт к главной цели",
  top_level: "Главная цель",
  orphan: "Висит вне стратегии",
};

function buildLibData(
  goals: readonly GoalDomain[],
  centerId: string | null,
  ideas: readonly IdeaListItem[] | undefined,
  showIdeas: boolean,
): { nodes: MapLibNode[]; links: MapLibLink[] } {
  const alignment = computeGoalAlignment(goals);
  const graph = buildGoalGraph({ goals, alignment, ideas, showIdeas });
  const ideaGoalMap = new Map<string, string | null>();
  if (showIdeas && ideas) {
    for (const idea of ideas) ideaGoalMap.set(idea.id, idea.goalId);
  }
  const nodes: MapLibNode[] = graph.nodes.map((n) => {
    const isCenter = n.id === centerId;
    const isIdea = n.kind === "idea";
    const ideaGoalId = isIdea ? (ideaGoalMap.get(n.id) ?? null) : null;
    const node: MapLibNode = {
      id: n.id,
      kind: n.kind,
      label: n.label,
      alignment: n.alignment,
      isPrimary: n.isPrimary,
      tone: isIdea ? (ideaGoalId !== null ? "info" : "muted") : nodeTone(n),
      ideaStatus: n.ideaStatus,
      ideaGoalId,
      val: isCenter ? 14 : isIdea ? 3 : n.alignment === "orphan" ? 4 : 6,
    };
    if (isCenter) {
      node.fx = 0;
      node.fy = 0;
    }
    return node;
  });
  const links: MapLibLink[] = graph.links.map((l: GoalMapLink) => ({
    source: l.source,
    target: l.target,
    kind: l.kind,
  }));
  return { nodes, links };
}

function pickFallbackCenter(goals: readonly GoalDomain[]): GoalDomain | null {
  if (goals.length === 0) return null;
  let best = goals[0];
  for (const g of goals) {
    if (g.weight > best.weight) {
      best = g;
      continue;
    }
    if (
      g.weight === best.weight &&
      g.createdAt.getTime() < best.createdAt.getTime()
    ) {
      best = g;
    }
  }
  return best;
}

export function GoalsMapView({
  goals,
  ideas,
  orgId,
  onChanged,
  loading = false,
}: {
  goals: GoalDomain[];
  ideas?: IdeaListItem[];
  orgId?: string;
  onChanged?: () => void;
  loading?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [LibComponent, setLibComponent] =
    useState<ComponentType<ForceGraphProps> | null>(null);
  const [libError, setLibError] = useState(false);
  const [palette, setPalette] = useState<TonePalette | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showIdeas, setShowIdeas] = useState(false);

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
    setPalette(resolveTonePalette());
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

  const primary = useMemo(
    () => goals.find((g) => g.isPrimary) ?? null,
    [goals],
  );
  const fallbackCenter = useMemo(
    () => (primary ? null : pickFallbackCenter(goals)),
    [primary, goals],
  );
  const centerId = primary?.id ?? fallbackCenter?.id ?? null;

  const data = useMemo(
    () => buildLibData(goals, centerId, ideas, showIdeas),
    [goals, centerId, ideas, showIdeas],
  );

  const selected = useMemo(
    () => goals.find((g) => g.id === selectedId) ?? null,
    [goals, selectedId],
  );
  const selectedIdea = useMemo(
    () => ideas?.find((i) => i.id === selectedId) ?? null,
    [ideas, selectedId],
  );
  const selectedAlignment = useMemo<GoalAlignment | null>(() => {
    if (!selected) return null;
    return computeGoalAlignment(goals).get(selected.id) ?? "orphan";
  }, [selected, goals]);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-sm text-fg-tertiary">
        Загрузка карты…
      </div>
    );
  }

  if (goals.length === 0) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-2 text-center">
        <p className="text-base font-medium text-fg-primary">
          Цели ещё не заданы
        </p>
        <p className="max-w-sm text-sm text-fg-tertiary">
          Когда появятся цели компании, карта покажет, как они ведут к главной.
        </p>
      </div>
    );
  }

  const nodeColor = (node: MapLibNode): string => {
    if (!palette) return "currentColor";
    return palette[node.tone];
  };

  const nodeCanvasObject = (
    node: MapLibNode,
    ctx: CanvasRenderingContext2D,
    globalScale: number,
  ): void => {
    const radius = Math.sqrt(node.val) * 2;
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const fill = palette ? palette[node.tone] : "currentColor";
    if (node.kind === "idea") {
      const half = radius;
      ctx.beginPath();
      ctx.moveTo(x, y - half);
      ctx.lineTo(x + half, y);
      ctx.lineTo(x, y + half);
      ctx.lineTo(x - half, y);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      const fontSize = Math.max(9 / globalScale, 2);
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = palette ? palette.fg : "currentColor";
      const ideaLabel =
        node.label.length > 24 ? `${node.label.slice(0, 23)}…` : node.label;
      ctx.fillText(ideaLabel, x, y + half + 2 / globalScale);
      return;
    }
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = fill;
    ctx.fill();
    if (node.alignment === "orphan") {
      ctx.lineWidth = 1.5 / globalScale;
      ctx.strokeStyle = palette ? palette.danger : "currentColor";
      ctx.setLineDash([4 / globalScale, 3 / globalScale]);
      ctx.beginPath();
      ctx.arc(x, y, radius + 3 / globalScale, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (node.isPrimary) {
      ctx.lineWidth = 2 / globalScale;
      ctx.strokeStyle = palette ? palette.accent : "currentColor";
      ctx.stroke();
    }
    const fontSize = Math.max(10 / globalScale, 2);
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = palette ? palette.fg : "currentColor";
    const label =
      node.label.length > 28 ? `${node.label.slice(0, 27)}…` : node.label;
    ctx.fillText(label, x, y + radius + 2 / globalScale);
  };

  const linkColor = (link: MapLibLink): string => {
    if (!palette) return "currentColor";
    return link.kind === "idea_goal" ? palette.info : palette.edge;
  };

  const linkLineDash = (link: MapLibLink): number[] | null =>
    link.kind === "idea_goal" ? [3, 3] : null;

  return (
    <div className="relative">
      <div className="relative h-[68vh] overflow-hidden rounded-xl border border-border-subtle bg-bg-card">
        {!primary && (
          <div className="absolute left-3 top-3 z-10 rounded-md border border-chip-warning-fg/40 bg-chip-warning-bg px-3 py-1.5 text-xs font-medium text-chip-warning-fg">
            Не выбрана главная цель — центром временно показана самая важная
          </div>
        )}
        {ideas && (
          <button
            type="button"
            onClick={() => setShowIdeas((v) => !v)}
            aria-pressed={showIdeas}
            className={
              showIdeas
                ? "absolute right-3 top-3 z-20 rounded-md border border-chip-info-fg/40 bg-chip-info-bg px-3 py-1.5 text-xs font-medium text-chip-info-fg transition-colors"
                : "absolute right-3 top-3 z-20 rounded-md border border-border-subtle bg-bg-card px-3 py-1.5 text-xs font-medium text-fg-secondary transition-colors hover:text-fg-primary"
            }
          >
            {showIdeas ? "Скрыть идеи" : "Показать идеи"}
          </button>
        )}
        <div ref={containerRef} className="absolute inset-0">
          {LibComponent && size.width > 0 ? (
            <LibComponent
              graphData={data}
              nodeId="id"
              nodeLabel="label"
              nodeVal="val"
              nodeColor={nodeColor}
              nodeCanvasObjectMode="replace"
              nodeCanvasObject={nodeCanvasObject}
              linkColor={linkColor}
              linkLineDash={linkLineDash}
              linkSource="source"
              linkTarget="target"
              linkWidth={1.5}
              dagMode="radialout"
              dagLevelDistance={80}
              dagNodeFilter={(n: MapLibNode) => n.alignment !== "orphan"}
              onDagError={(loopNodeIds) => {
                console.warn("Карта целей: циклическая связь", loopNodeIds);
              }}
              onNodeClick={(n: MapLibNode) => setSelectedId(n.id)}
              width={size.width}
              height={size.height}
              cooldownTicks={120}
              backgroundColor="rgba(0,0,0,0)"
            />
          ) : libError ? (
            <FallbackList goals={goals} onSelect={setSelectedId} />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-fg-tertiary">
              Загружаем карту…
            </div>
          )}
        </div>
        {selected && (
          <GoalPanel
            goal={selected}
            goals={goals}
            alignment={selectedAlignment}
            orgId={orgId}
            onClose={() => setSelectedId(null)}
            onChanged={() => {
              setSelectedId(null);
              onChanged?.();
            }}
          />
        )}
        {!selected && selectedIdea && (
          <IdeaPanel
            idea={selectedIdea}
            goals={goals}
            orgId={orgId}
            onClose={() => setSelectedId(null)}
            onChanged={() => {
              setSelectedId(null);
              onChanged?.();
            }}
          />
        )}
      </div>
    </div>
  );
}

function GoalPanel({
  goal,
  goals,
  alignment,
  orgId,
  onClose,
  onChanged,
}: {
  goal: GoalDomain;
  goals: readonly GoalDomain[];
  alignment: GoalAlignment | null;
  orgId?: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<"suggest" | "link" | null>(null);
  const [suggestion, setSuggestion] = useState<SuggestParentApi | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const isOrphan = alignment === "orphan";
  const canAct = Boolean(orgId);

  const suggestedGoal =
    suggestion?.suggestedParentGoalId != null
      ? (goals.find((g) => g.id === suggestion.suggestedParentGoalId) ?? null)
      : null;

  async function handleSuggest() {
    if (!orgId || busy) return;
    setBusy("suggest");
    setSuggestError(null);
    try {
      const result = await goalsApi.suggestParent(orgId, goal.id);
      setSuggestion(result);
    } catch (err) {
      setSuggestError(
        humanizeApiError(err, "Не удалось подобрать родителя"),
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleMakeChild() {
    if (!orgId || busy) return;
    const parentId = suggestion?.suggestedParentGoalId;
    if (!parentId) return;
    setBusy("link");
    try {
      await goalsApi.update(orgId, goal.id, { parentGoalId: parentId });
      toast.success("Цель стала подцелью");
      onChanged();
    } catch (err) {
      toast.error(humanizeApiError(err, "Не удалось сделать подцелью"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <aside className="absolute right-0 top-0 z-10 flex h-full w-72 flex-col gap-3 overflow-y-auto border-l border-border-subtle bg-bg-card/95 p-4 backdrop-blur">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg-primary">{goal.name}</h3>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded px-1.5 text-fg-tertiary hover:text-fg-primary"
          aria-label="Закрыть"
        >
          ×
        </button>
      </div>
      <div className="flex flex-col gap-1 text-xs">
        <span className="text-fg-tertiary">Статус</span>
        <span className="font-medium text-fg-secondary">
          {GOAL_PROGRESS_STATUS_LABELS[goal.progressStatus]}
        </span>
      </div>
      {alignment && (
        <div className="flex flex-col gap-1 text-xs">
          <span className="text-fg-tertiary">Связь со стратегией</span>
          <span className="font-medium text-fg-secondary">
            {ALIGNMENT_LABEL[alignment]}
          </span>
        </div>
      )}
      {isOrphan && orgId && (
        <div className="mt-1 flex flex-col gap-2 border-t border-border-subtle pt-3">
          <span className="text-xs font-medium text-fg-secondary">
            Эта цель висит вне стратегии
          </span>
          <button
            type="button"
            onClick={() => void handleSuggest()}
            disabled={!canAct || busy !== null}
            className="w-full rounded-md border border-border-subtle bg-bg-card px-3 py-1.5 text-xs font-medium text-fg-primary transition-colors hover:bg-bg-subtle disabled:opacity-60"
          >
            {busy === "suggest" ? "Кора думает…" : "Куда относится?"}
          </button>
          {suggestError && (
            <p className="text-xs text-chip-danger-fg">{suggestError}</p>
          )}
          {suggestion && !suggestError && (
            <div className="flex flex-col gap-2">
              {suggestion.verdict === "child_of" &&
              suggestion.suggestedParentGoalId ? (
                <>
                  <div className="flex flex-col gap-1 text-xs">
                    <span className="text-fg-tertiary">
                      Кора предлагает родителя
                    </span>
                    <span className="font-medium text-fg-secondary">
                      {suggestedGoal?.name ?? "Цель не найдена в карте"}
                    </span>
                  </div>
                  {suggestion.reasoning && (
                    <p className="text-xs text-fg-tertiary">
                      {suggestion.reasoning}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleMakeChild()}
                    disabled={!canAct || busy !== null || !suggestedGoal}
                    className="w-full rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition-colors hover:bg-accent/90 disabled:opacity-60"
                  >
                    {busy === "link" ? "Привязываем…" : "Сделать подцелью"}
                  </button>
                </>
              ) : suggestion.verdict === "duplicate" ? (
                <div className="flex flex-col gap-1 rounded-md border border-chip-warning-fg/40 bg-chip-warning-bg px-3 py-2 text-xs text-chip-warning-fg">
                  <span className="font-medium">Похоже на дубль</span>
                  {suggestion.reasoning && <span>{suggestion.reasoning}</span>}
                </div>
              ) : (
                <p className="text-xs text-fg-tertiary">
                  Кора не нашла подходящего родителя — цель выглядит
                  самостоятельной.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

function IdeaPanel({
  idea,
  goals,
  orgId,
  onClose,
  onChanged,
}: {
  idea: IdeaListItem;
  goals: readonly GoalDomain[];
  orgId?: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [targetGoalId, setTargetGoalId] = useState<string>("");
  const [busy, setBusy] = useState<"link" | "promote" | null>(null);
  const canAct = Boolean(orgId);

  async function handleLink() {
    if (!orgId || busy) return;
    if (!targetGoalId) {
      toast.error("Выберите цель для привязки");
      return;
    }
    setBusy("link");
    try {
      await ideasApi.linkGoal(orgId, idea.id, targetGoalId);
      toast.success("Идея привязана к цели");
      onChanged();
    } catch (err) {
      toast.error(humanizeApiError(err, "Не удалось привязать идею"));
    } finally {
      setBusy(null);
    }
  }

  async function handlePromote() {
    if (!orgId || busy) return;
    setBusy("promote");
    try {
      await ideasApi.promoteToGoal(orgId, idea.id, {});
      toast.success("Идея стала целью");
      onChanged();
    } catch (err) {
      toast.error(humanizeApiError(err, "Не удалось сделать идею целью"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <aside className="absolute right-0 top-0 z-10 flex h-full w-72 flex-col gap-3 overflow-y-auto border-l border-border-subtle bg-bg-card/95 p-4 backdrop-blur">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-fg-primary">Идея</h3>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded px-1.5 text-fg-tertiary hover:text-fg-primary"
          aria-label="Закрыть"
        >
          ×
        </button>
      </div>
      <p className="text-sm text-fg-secondary">{idea.statement}</p>
      <div className="flex flex-col gap-1 text-xs">
        <span className="text-fg-tertiary">Статус</span>
        <span className="inline-flex w-fit items-center rounded-full bg-chip-info-bg px-2 py-0.5 font-medium text-chip-info-fg">
          {IDEA_STATUS_LABEL[idea.status]}
        </span>
      </div>
      {idea.goalId !== null && (
        <p className="text-xs text-fg-tertiary">
          Уже привязана к цели. Сначала отвяжите, чтобы сделать отдельной целью.
        </p>
      )}
      <div className="mt-1 flex flex-col gap-2 border-t border-border-subtle pt-3">
        <span className="text-xs font-medium text-fg-secondary">
          Привязать к цели
        </span>
        <select
          value={targetGoalId}
          onChange={(e) => setTargetGoalId(e.target.value)}
          disabled={!canAct || busy !== null}
          className="w-full rounded-md border border-border-subtle bg-bg-card px-2 py-1.5 text-xs text-fg-primary disabled:opacity-60"
        >
          <option value="">Выберите цель…</option>
          {goals.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void handleLink()}
          disabled={!canAct || busy !== null}
          className="w-full rounded-md border border-border-subtle bg-bg-card px-3 py-1.5 text-xs font-medium text-fg-primary transition-colors hover:bg-bg-subtle disabled:opacity-60"
        >
          {busy === "link" ? "Привязываем…" : "Привязать к цели"}
        </button>
      </div>
      <div className="flex flex-col gap-2 border-t border-border-subtle pt-3">
        <span className="text-xs font-medium text-fg-secondary">
          Сделать отдельной целью
        </span>
        <button
          type="button"
          onClick={() => void handlePromote()}
          disabled={!canAct || busy !== null || idea.goalId !== null}
          className="w-full rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition-colors hover:bg-accent/90 disabled:opacity-60"
        >
          {busy === "promote" ? "Создаём цель…" : "Сделать целью"}
        </button>
      </div>
      {!canAct && (
        <p className="text-xs text-fg-tertiary">
          Действия недоступны — не определена организация.
        </p>
      )}
    </aside>
  );
}

function FallbackList({
  goals,
  onSelect,
}: {
  goals: readonly GoalDomain[];
  onSelect: (id: string) => void;
}) {
  const alignment = computeGoalAlignment(goals);
  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4 text-sm">
      <p className="text-xs text-chip-warning-fg">
        Карта недоступна (нужен `bun install` после обновления). Показываем
        плоский список целей.
      </p>
      <ul className="flex flex-wrap gap-2">
        {goals.map((g) => {
          const a = alignment.get(g.id) ?? "orphan";
          return (
            <li key={g.id}>
              <button
                type="button"
                onClick={() => onSelect(g.id)}
                className={
                  a === "orphan"
                    ? "rounded border border-chip-danger-fg/50 bg-chip-danger-bg px-2 py-1 text-xs text-chip-danger-fg"
                    : g.isPrimary
                      ? "rounded border border-accent/60 bg-accent-muted px-2 py-1 text-xs text-accent"
                      : "rounded border border-border-subtle bg-bg-overlay px-2 py-1 text-xs text-fg-primary hover:bg-bg-subtle"
                }
              >
                {g.name}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
