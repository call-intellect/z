import { DemoAlwaysWidget, DemoConditionalWidget } from "./_stubs";
import type { WidgetDescriptor } from "./types";

export const WIDGET_REGISTRY: Record<string, WidgetDescriptor> = {
  "demo.always": {
    id: "demo.always",
    title: "Демо-блок",
    rhythm: ["today", "week", "month"],
    roles: ["owner", "coo", "member"],
    size: "md",
    Component: DemoAlwaysWidget,
  },
  "demo.conditional": {
    id: "demo.conditional",
    title: "Демо-блок (условный)",
    rhythm: ["today", "week", "month"],
    roles: ["owner", "coo", "member"],
    size: "sm",
    visibleWhen: (data) => Boolean(data),
    Component: DemoConditionalWidget,
  },
};
