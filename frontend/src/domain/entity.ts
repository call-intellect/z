import type {
  BlockSearchItemApi,
  EntityDetailApi,
  EntityItemApi,
  EntityLinkItemApi,
  EntityLinksResultApi,
} from "@/api/entities.api";

export type EntityType =
  | "person"
  | "customer"
  | "vendor"
  | "project"
  | "product"
  | "document"
  | "goal"
  | "event"
  | "topic"
  | "location"
  | "technology"
  | "metric"
  | "market"
  | "org_unit"
  | "client"
  | "custom";

export const ENTITY_TYPE_LABEL: Record<EntityType, string> = {
  person: "Сотрудник",
  customer: "Клиент",
  vendor: "Поставщик",
  project: "Проект",
  product: "Продукт",
  document: "Документ",
  goal: "Цель",
  event: "Событие",
  topic: "Тема",
  location: "Локация",
  technology: "Технология",
  metric: "Метрика",
  market: "Рынок",
  org_unit: "Подразделение",
  client: "Клиент",
  custom: "Прочее",
};

export function entityTypeLabel(t: string): string {
  return (ENTITY_TYPE_LABEL as Record<string, string>)[t] ?? t;
}

export const ENTITY_TYPE_TABS: ReadonlyArray<{
  value: EntityType;
  label: string;
}> = [
  { value: "person", label: "Сотрудники" },
  { value: "customer", label: "Клиенты" },
  { value: "vendor", label: "Поставщики" },
  { value: "project", label: "Проекты" },
  { value: "product", label: "Продукты" },
  { value: "topic", label: "Темы" },
  { value: "technology", label: "Технологии" },
  { value: "location", label: "Локации" },
  { value: "org_unit", label: "Подразделения" },
];

export const ENTITY_RELATION_LABEL: Record<string, string> = {
  works_at: "работает в",
  belongs_to: "относится к",
  part_of: "часть",
  opposes: "противоречит",
  depends_on: "зависит от",
  mentions_with: "упоминается вместе с",
  manages: "управляет",
  owns: "владеет",
  uses: "использует",
  related_to: "связан с",
};

export function entityRelationLabel(t: string): string {
  return ENTITY_RELATION_LABEL[t] ?? t.replaceAll("_", " ");
}

export const SIGNAL_TYPE_LABEL: Record<string, string> = {
  fact: "Факт",
  decision: "Решение",
  regulation: "Регламент",
  process_step: "Шаг процесса",
  pain: "Боль",
  risk: "Риск",
  churn_risk: "Риск оттока",
  objection: "Возражение",
  idea: "Идея",
  feature_request: "Запрос функции",
  reasoning: "Обоснование",
  rationale: "Мотивация",
  decision_basis: "Основание",
  knowledge_gap: "Пробел знаний",
  commitment: "Обязательство",
  mood: "Настроение",
  drift: "Дрейф",
  competitor_move: "Действие конкурента",
  metric_change: "Изменение метрики",
  expertise: "Экспертиза",
  experience: "Опыт",
  competence: "Компетенция",
  methodology_step: "Шаг методологии",
  hypothesis: "Гипотеза",
  result: "Результат",
  lesson: "Урок",
  brand_principle: "Принцип бренда",
  content_artifact: "Контент-артефакт",
  commitment_status: "Статус обязательства",
  plan_item: "План",
  done_item: "Выполнено",
  blocker: "Блокер",
  team_friction: "Командная фрикция",
  process_friction: "Процессная фрикция",
  resource_gap: "Нехватка ресурсов",
  suggestion: "Предложение",
  client_request: "Запрос клиента",
  question: "Вопрос",
  task_created: "Задача создана",
  task_status_changed: "Статус задачи изменён",
  task_blocked: "Задача заблокирована",
  task_completed: "Задача завершена",
  task_overdue: "Задача просрочена",
  task_reassigned: "Задача переназначена",
  task_comment: "Комментарий к задаче",
  task_mention: "Упоминание в задаче",
  help_provided: "Помощь оказана",
  proactive_hint: "Подсказка",
  mentoring: "Менторство",
  emotional_support: "Эмоциональная поддержка",
  constructive_feedback: "Конструктивная обратная связь",
  helped_by: "Помог",
  helped_to: "Получил помощь",
  thanks_explicit: "Благодарность",
};

export function signalTypeLabel(t: string): string {
  return SIGNAL_TYPE_LABEL[t] ?? t.replaceAll("_", " ");
}

export interface EntityListItem {
  id: string;
  type: string;
  canonicalName: string;
  aliases: string[];
  mentionsCount: number;
  metadata: Record<string, unknown> | null;
}

export interface KnowledgeBlock {
  id: string;
  name: string;
  criticalQuestion: string;
  trustedAnswer: string;
  signalType: string;
  tags: string[];
  confidence: number;
  evidenceCount: number;
  status: string;
  createdAt: Date;
}

export interface EntityDetail {
  entity: EntityListItem;
  blocks: KnowledgeBlock[];
  mergedIntoId: string | null;
}

export interface EntityLink {
  id: string;
  relationType: string;
  confidence: number;
  explanation: string;
  other: { entityId: string; type: string; canonicalName: string };
  direction: "outgoing" | "incoming";
  createdAt: Date;
}

export interface EntityLinksGrouped {
  outgoing: EntityLink[];
  incoming: EntityLink[];
}

export function mapEntityListItem(api: EntityItemApi): EntityListItem {
  return {
    id: api.id,
    type: api.type,
    canonicalName: api.canonicalName,
    aliases: api.aliases,
    mentionsCount: api.mentionsCount,
    metadata: api.metadata,
  };
}

export function mapKnowledgeBlock(api: BlockSearchItemApi): KnowledgeBlock {
  return {
    id: api.id,
    name: api.name,
    criticalQuestion: api.criticalQuestion,
    trustedAnswer: api.trustedAnswer,
    signalType: api.signalType,
    tags: api.tags,
    confidence: api.confidence,
    evidenceCount: api.evidenceCount,
    status: api.status,
    createdAt: new Date(api.createdAt),
  };
}

export function mapEntityDetail(api: EntityDetailApi): EntityDetail {
  return {
    entity: mapEntityListItem(api.entity),
    blocks: api.blocks.map(mapKnowledgeBlock),
    mergedIntoId: api.mergedIntoId ?? null,
  };
}

function mapEntityLink(
  api: EntityLinkItemApi,
  direction: "outgoing" | "incoming",
): EntityLink {
  return {
    id: api.id,
    relationType: api.relationType,
    confidence: api.confidence,
    explanation: api.explanation,
    other: api.other,
    direction,
    createdAt: new Date(api.createdAt),
  };
}

export function mapEntityLinks(api: EntityLinksResultApi): EntityLinksGrouped {
  return {
    outgoing: api.outgoing.map((l) => mapEntityLink(l, "outgoing")),
    incoming: api.incoming.map((l) => mapEntityLink(l, "incoming")),
  };
}
