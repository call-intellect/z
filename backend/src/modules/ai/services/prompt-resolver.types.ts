/**
 * Типы для `PromptResolverService` (Фаза A.1 — Prompt Registry).
 *
 * Источник: plans/tz/2026-05-21-phase-A-prompt-registry-admin.md §5.
 *
 * Контракт устроен так, что вызывающая сторона (analyze.worker) НЕ должна
 * знать, откуда пришёл промпт — из БД или из встроенного кода (code-fallback).
 * Все три источника возвращают один и тот же `ResolvedPrompt`, который
 * `prompt-renderer` превращает в `{ system, user, tools? }` для `LlmFallbackService`.
 */

/**
 * Конкретные taskType'ы, по которым PromptResolver резолвит шаблоны
 * на Фазе A.1. Это legacy LLM taskType'ы, существующие в коде уже сейчас.
 *
 * Расширяется в Фазе A.4 — новые agent'ы регистрируются через seed, но
 * А.1 закрывает только `summary` (по типу встречи), плюс универсальные
 * `tasks` / `chapters` / `follow-up` / `card-rollup`.
 *
 * Фаза C — добавлен `meeting-quality-score` (AI-оценка качества встречи,
 * sub-TZ C §5). До A.2/A.3 для него работает code-fallback из
 * `ai/services/prompts/meeting-quality-score.ts`; БД-источник станет
 * доступен через PromptTemplate-record с `taskType='meeting-quality-score'`.
 */
export type PromptResolverTaskType =
  | 'summary'
  | 'tasks'
  | 'chapters'
  | 'follow-up'
  | 'card-rollup'
  | 'meeting-quality-score'
  /** Фаза B — LLM-уточнение метрик поведения участников встречи. */
  | 'behavior-refine'
  /** Фаза D — LLM-уточнение очистки транскрипта от слов-паразитов. */
  | 'transcript-clean-refine'
  /** Фаза E — генерация дополнительных AI-отчётов по пользовательским шаблонам. */
  | 'custom-report';

/**
 * Источник, откуда фактически взят промпт. Эта метка пишется в метрику
 * `z_prompt_resolver_total{source}` и логируется в analyze.worker.
 *
 *   - 'db_org' — Org-override (scope=org, status=active, orgId совпадает).
 *   - 'db_system' — системный шаблон Z (scope=system, status=active).
 *   - 'code_fallback' — встроенный код `ai/services/prompts/type-*.ts`.
 *     Используется когда:
 *       а) в БД ничего нет (свежий деплой до seed'а);
 *       б) шаблон есть, но `status != 'active'`;
 *       в) ошибка при запросе в БД (БД упала / таймаут).
 */
export type ResolvedPromptSource = 'db_org' | 'db_system' | 'code_fallback';

export interface ResolvedPromptSection {
  /** Slug секции — должен совпадать с key в `outputSchema.properties`. */
  key: string;
  title: string;
  /** Инструкция LLM «что писать в этой секции». */
  instruction: string;
  /** 'text' | 'bullet_list' | 'table' | 'json_object'. */
  outputType: string;
  required: boolean;
  maxTokens?: number | null;
}

/**
 * Унифицированный результат резолва. То, что отдают и `db_*`, и `code_fallback`.
 *
 * `outputSchema` — это input_schema будущего LlmTool. Чтобы analyze.worker
 * мог его использовать как сейчас (через `descriptor.tool`), prompt-renderer
 * заворачивает его в `LlmTool { name: toolName, ... }`.
 */
export interface ResolvedPrompt {
  source: ResolvedPromptSource;
  /** UUID `PromptTemplateVersion`. NULL только для `code_fallback`. */
  versionId: string | null;
  /** Группа A/B-эксперимента, если активен. */
  experimentGroup?: 'A' | 'B';
  /** System-промпт (полный, без обёртки в room-chat note — её делает analyze.worker). */
  systemPrompt: string;
  /** Имя tool'а для tool_use. NULL = плоский text-промпт без structured-вывода. */
  toolName: string | null;
  /** Описание tool'а (для LLM, не для админки). */
  toolDescription?: string;
  /** Разделы (для UI A.2 и для будущей валидации ответа per-section). */
  sections: ResolvedPromptSection[];
  /**
   * JSON Schema ответа. Для code_fallback — `LlmTool.input_schema` существующего
   * `descriptor.tool`. Для DB-источника — `PromptTemplateVersion.outputSchema`.
   *
   * Использовать как `{ type: 'object', properties, required, additionalProperties }`.
   */
  outputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

/**
 * Параметры запроса резолва для контекста встречи.
 *
 * `tenantId` обязателен — даже когда речь о системном промпте, мы должны знать,
 * есть ли у этой Org Org-override и не попал ли meeting в активный
 * `PromptExperiment` Org'а.
 */
export interface ResolveForMeetingParams {
  tenantId: string;
  meetingId: string;
  meetingType: string;
  taskType: PromptResolverTaskType;
}
