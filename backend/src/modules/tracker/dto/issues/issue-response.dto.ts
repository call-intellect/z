export interface IssueResponseDto {
  id: string;
  tenantId: string;
  projectId: string;
  identifier: string;
  sequenceId: number;
  title: string;
  description: string | null;
  descriptionHtml: string | null;
  descriptionStripped: string | null;
  priority: string;
  stateId: string | null;
  parentId: string | null;
  estimatePoints: number | null;
  sortOrder: number;
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  cycleId: string | null;
  goalId: string | null;
  meetingId: string | null;
  linkedMeetingIds: string[];
  sourceBlockIds: string[];
  confidence: string | null;
  createdManually: boolean;
  externalSource: string | null;
  externalId: string | null;
  entityId: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
  assigneeUserIds: string[];
  labelIds: string[];
  /**
   * Tracker Phase 3 part C — AI-подсказки, заполняется только при создании
   * с `inferSuggestions=true`. На остальных эндпоинтах поле отсутствует
   * (для совместимости с типизированными клиентами поле опциональное).
   */
  aiSuggestions?: IssueAiSuggestionsDto | null;
}

/**
 * Tracker Phase 3 part C — структура AI-подсказок, возвращаемых POST /issues.
 *
 *   - `fields` — результат `IssueInferFieldsService` (assignee/priority/...);
 *     `null` если LLM не уверен (confidence < 0.7) или сервис недоступен.
 *   - `goal` — результат `IssueGoalSuggestService` (источник 'knn'|'llm');
 *     `null` если ни KNN, ни LLM не нашли уверенного кандидата.
 *
 * Фронт может показать `aiSuggestions.fields` как inline-карточку «Принять / Отклонить»
 * и `aiSuggestions.goal` как чип «Связать с целью X (∼60%)».
 */
export interface IssueAiSuggestionsDto {
  fields: {
    suggestedAssigneeId: string | null;
    suggestedDueDate: string | null;
    suggestedPriority: string | null;
    suggestedGoalId: string | null;
    suggestedLabels: string[];
    confidence: number;
    meetsThreshold: boolean;
    reasoning: string | null;
  } | null;
  goal: {
    goalId: string;
    confidence: number;
    source: 'knn' | 'llm';
  } | null;
}

export interface ListIssuesResponse {
  items: IssueResponseDto[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Ответ `GET /api/v1/me/inbox` — мои задачи во всех проектах
 * с cursor-based пагинацией.
 *
 * `nextCursor` — id последней задачи на странице, передавать в
 * следующий запрос как `?cursor=...`. null = это последняя страница.
 */
export interface MyInboxResponseDto {
  items: IssueResponseDto[];
  nextCursor: string | null;
  limit: number;
}

export interface IssueActivityDto {
  id: string;
  issueId: string;
  actorUserId: string | null;
  actorType: string;
  agentName: string | null;
  verb: string;
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
  metadata: unknown;
  /** Epoch — строкой (BigInt → string), чтобы JSON не терял точность. */
  epoch: string;
  createdAt: string;
}

export interface IssueVersionDto {
  id: string;
  issueId: string;
  versionNumber: number;
  snapshot: unknown;
  createdByUserId: string;
  createdAt: string;
}
