import type {
  ProactiveNotificationApi,
  ProactiveSeverityApi,
} from '@/api/proactive.api';

/**
 * SBA δ-2 — DomainModel для ProactiveNotification.
 *
 * Преобразует ApiDto → удобный UI-объект: даты как `Date`, человекочитаемые
 * лейблы правил и уровней, расплющенный payload (title/body/actionUrl).
 */

export type ProactiveSeverity = ProactiveSeverityApi;

const RULE_LABELS: Record<string, string> = {
  decision_no_owner: 'Решение без ответственного',
  insight_no_mitigation: 'Сигнал без плана действий',
  experiment_running_too_long: 'Эксперимент затянулся',
  process_stale_review: 'Процесс давно не обновлялся',
  role_low_completeness: 'Роль с пробелами',
  department_no_domain: 'Отдел без функциональной области',
  insights_siloed_in_domain: 'Сигналы изолированы',
  plan_item_overdue: 'План без подтверждённого результата',
};

const SEVERITY_LABELS: Record<ProactiveSeverity, string> = {
  low: 'Подсказка',
  medium: 'Стоит посмотреть',
  high: 'Важно',
};

export function ruleLabel(ruleType: string): string {
  return RULE_LABELS[ruleType] ?? ruleType;
}

export function severityLabel(severity: ProactiveSeverity): string {
  return SEVERITY_LABELS[severity] ?? severity;
}

export type ProactiveNotification = {
  id: string;
  ruleType: string;
  ruleLabel: string;
  severity: ProactiveSeverity;
  severityLabel: string;
  title: string;
  body: string;
  actionUrl: string | null;
  craftedByLlm: boolean;
  emittedAt: Date;
  dismissedAt: Date | null;
  /** Сырой payload — на случай, если UI нужны детальные facts. */
  rawPayload: unknown;
};

interface RawPayload {
  title?: unknown;
  body?: unknown;
  actionUrl?: unknown;
  craftedByLlm?: unknown;
}

export function mapProactiveNotification(
  api: ProactiveNotificationApi,
): ProactiveNotification {
  const payload = (api.payload ?? {}) as RawPayload;
  return {
    id: api.id,
    ruleType: api.ruleType,
    ruleLabel: ruleLabel(api.ruleType),
    severity: api.severity,
    severityLabel: severityLabel(api.severity),
    title:
      typeof payload.title === 'string' && payload.title.length > 0
        ? payload.title
        : ruleLabel(api.ruleType),
    body:
      typeof payload.body === 'string' && payload.body.length > 0
        ? payload.body
        : 'Кора заметила кое-что — загляни в раздел.',
    actionUrl:
      typeof payload.actionUrl === 'string' && payload.actionUrl.length > 0
        ? payload.actionUrl
        : null,
    craftedByLlm: payload.craftedByLlm === true,
    emittedAt: new Date(api.emittedAt),
    dismissedAt: api.dismissedAt ? new Date(api.dismissedAt) : null,
    rawPayload: api.payload,
  };
}
