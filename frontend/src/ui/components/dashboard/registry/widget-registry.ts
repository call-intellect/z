import type { WidgetDescriptor } from "./types";
import { VerdictWidget } from "./widgets/VerdictWidget";
import { GoalVectorWidget } from "./widgets/GoalVectorWidget";
import { PlanFactWidget } from "./widgets/PlanFactWidget";
import { LoadWidget } from "./widgets/LoadWidget";
import { StaleIssuesWidget } from "./widgets/StaleIssuesWidget";
import { IssueChainsWidget } from "./widgets/IssueChainsWidget";
import { BlockersByThemeWidget } from "./widgets/BlockersByThemeWidget";
import { IdeasByThemeWidget } from "./widgets/IdeasByThemeWidget";
import { DecisionsWidget } from "./widgets/DecisionsWidget";
import { FeedWidget } from "./widgets/FeedWidget";
import { ValueWidget } from "./widgets/ValueWidget";

export const WIDGET_REGISTRY: Record<string, WidgetDescriptor> = {
  verdict: {
    id: "verdict",
    title: "Вердикт утра",
    rhythm: ["today", "week", "month"],
    roles: ["owner", "coo"],
    size: "xl",
    Component: VerdictWidget,
  },
  "goal-vector": {
    id: "goal-vector",
    title: "Идём к цели",
    rhythm: ["today", "week", "month"],
    roles: ["owner", "coo"],
    size: "xl",
    Component: GoalVectorWidget,
  },
  "plan-fact": {
    id: "plan-fact",
    title: "План и факт",
    rhythm: ["today", "week", "month"],
    roles: ["owner", "coo"],
    size: "lg",
    Component: PlanFactWidget,
  },
  load: {
    id: "load",
    title: "Кто чем загружен",
    rhythm: ["today", "week", "month"],
    roles: ["owner", "coo"],
    size: "md",
    Component: LoadWidget,
  },
  stale: {
    id: "stale",
    title: "Что зависло",
    rhythm: ["today", "week", "month"],
    roles: ["owner", "coo"],
    size: "md",
    Component: StaleIssuesWidget,
  },
  chains: {
    id: "chains",
    title: "Задача держит задачу",
    rhythm: ["week", "month"],
    roles: ["owner", "coo"],
    size: "md",
    Component: IssueChainsWidget,
  },
  blockers: {
    id: "blockers",
    title: "Что мешает — по темам",
    rhythm: ["today", "week", "month"],
    roles: ["owner", "coo"],
    size: "lg",
    Component: BlockersByThemeWidget,
  },
  ideas: {
    id: "ideas",
    title: "Идеи по темам",
    rhythm: ["today", "week", "month"],
    roles: ["owner", "coo", "member"],
    size: "md",
    Component: IdeasByThemeWidget,
  },
  decisions: {
    id: "decisions",
    title: "Решения",
    rhythm: ["today", "week", "month"],
    roles: ["owner", "coo"],
    size: "md",
    Component: DecisionsWidget,
  },
  feed: {
    id: "feed",
    title: "Лента",
    rhythm: ["today", "week", "month"],
    roles: ["owner", "coo"],
    size: "lg",
    Component: FeedWidget,
  },
  value: {
    id: "value",
    title: "Польза Коры",
    rhythm: ["today", "week", "month"],
    roles: ["owner", "coo", "member"],
    size: "xl",
    Component: ValueWidget,
  },
};
