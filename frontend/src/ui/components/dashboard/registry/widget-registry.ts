import type { WidgetDescriptor } from "./types";
import { VerdictWidget } from "./widgets/VerdictWidget";
import { GoalVectorWidget } from "./widgets/GoalVectorWidget";
import { PlanFactWidget } from "./widgets/PlanFactWidget";
import { LoadWidget } from "./widgets/LoadWidget";
import { StaleIssuesWidget } from "./widgets/StaleIssuesWidget";
import { IssueChainsWidget } from "./widgets/IssueChainsWidget";
import { BlockersByThemeWidget } from "./widgets/BlockersByThemeWidget";
import { IdeasByThemeWidget } from "./widgets/IdeasByThemeWidget";
import { FeedWidget } from "./widgets/FeedWidget";
import { ValueWidget } from "./widgets/ValueWidget";
import { WeeklyPlanFactWidget } from "./widgets/WeeklyPlanFactWidget";
import { TrendWidget } from "./widgets/TrendWidget";
import { AchievementsWidget } from "./widgets/AchievementsWidget";
import { MaturityCardWidget } from "./widgets/MaturityCardWidget";
import { BusFactorCardWidget } from "./widgets/BusFactorCardWidget";
import { WeeklyDynamicsWidget } from "./widgets/WeeklyDynamicsWidget";
import { MonthRecapWidget } from "./widgets/MonthRecapWidget";

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
    size: "md",
    Component: PlanFactWidget,
  },
  "weekly-plan-fact": {
    id: "weekly-plan-fact",
    title: "План-факт по людям",
    rhythm: ["week", "month"],
    roles: ["owner", "coo"],
    size: "xl",
    Component: WeeklyPlanFactWidget,
  },
  trend: {
    id: "trend",
    title: "Идём лучше или хуже",
    rhythm: ["week", "month"],
    roles: ["owner", "coo"],
    size: "md",
    Component: TrendWidget,
  },
  "month-recap": {
    id: "month-recap",
    title: "Итоги месяца — снятая рутина",
    rhythm: ["month"],
    roles: ["owner", "coo"],
    size: "xl",
    Component: MonthRecapWidget,
  },
  achievements: {
    id: "achievements",
    title: "Достижения месяца",
    rhythm: ["month"],
    roles: ["owner", "coo"],
    size: "md",
    Component: AchievementsWidget,
  },
  "weekly-dynamics": {
    id: "weekly-dynamics",
    title: "Динамика по неделям",
    rhythm: ["month"],
    roles: ["owner", "coo"],
    size: "md",
    Component: WeeklyDynamicsWidget,
  },
  maturity: {
    id: "maturity",
    title: "Зрелость компании",
    rhythm: ["month"],
    roles: ["owner", "coo"],
    size: "md",
    Component: MaturityCardWidget,
  },
  "bus-factor": {
    id: "bus-factor",
    title: "Незаменимость",
    rhythm: ["month"],
    roles: ["owner", "coo"],
    size: "md",
    Component: BusFactorCardWidget,
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
    size: "md",
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
  feed: {
    id: "feed",
    title: "Лента",
    rhythm: ["today", "week", "month"],
    roles: ["owner", "coo"],
    size: "xl",
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
