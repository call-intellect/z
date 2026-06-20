import type { ProactiveNotificationApi } from "@/api/proactive.api";
import type { FeedItemApi, FeedType } from "@/domain/activity-feed";

export interface BellRow {
  key: string;
  group: "pending" | "proactive" | "signal";
  title: string;
  actionUrl: string;
  severity: "urgent" | "normal";
  ageDays?: number;
  canQuickConfirm?: boolean;
  dismissable?: boolean;
}

export const PROACTIVE_RULE_LABEL: Record<string, string> = {
  decision_no_owner: "Решение без ответственного",
  insight_no_mitigation: "Сигнал без плана действий",
  experiment_running_too_long: "Эксперимент идёт слишком долго",
  process_stale_review: "Процесс давно не проверяли",
  role_low_completeness: "Роль описана не полностью",
  department_no_domain: "Отдел без области ответственности",
  insights_siloed_in_domain: "Сигналы накапливаются в одной области",
  plan_item_overdue: "Пункт плана просрочен",
};

export const PROACTIVE_RULE_ROUTE: Record<string, string> = {
  decision_no_owner: "/decisions",
  insight_no_mitigation: "/insights",
  experiment_running_too_long: "/experiments",
  process_stale_review: "/processes",
  role_low_completeness: "/structure",
  department_no_domain: "/structure",
  insights_siloed_in_domain: "/insights?filter=no_linked_decision",
  plan_item_overdue: "/me/check-ins",
};

export const FEED_TYPE_ROUTE: Record<FeedType, string> = {
  probe_question: "/me",
  insight: "/insights",
  decision: "/decisions",
  task: "/tasks",
  idea: "/ideas",
  conflict: "/insights",
  knowledge_change: "/memory",
  recognition: "/me",
};

export function mapProactiveToBellRow(
  item: ProactiveNotificationApi,
): BellRow | null {
  const payload = item.payload as
    | { title?: string; actionUrl?: string }
    | null
    | undefined;

  const title =
    payload?.title?.trim() || PROACTIVE_RULE_LABEL[item.ruleType] || "";
  if (!title) return null;

  const actionUrl =
    payload?.actionUrl?.trim() || PROACTIVE_RULE_ROUTE[item.ruleType] || "";
  if (!actionUrl) return null;

  const severity: BellRow["severity"] =
    item.severity === "high" ? "urgent" : "normal";

  return {
    key: `proactive:${item.id}`,
    group: "proactive",
    title,
    actionUrl,
    severity,
    dismissable: true,
  };
}

export function mapSignalToBellRow(item: FeedItemApi): BellRow | null {
  const actionUrl = FEED_TYPE_ROUTE[item.feedType];
  if (!actionUrl) return null;

  const title = item.title?.trim();
  if (!title) return null;

  const severity: BellRow["severity"] =
    item.severity === "critical" || item.severity === "high"
      ? "urgent"
      : "normal";

  return {
    key: `signal:${item.id}`,
    group: "signal",
    title,
    actionUrl,
    severity,
  };
}
