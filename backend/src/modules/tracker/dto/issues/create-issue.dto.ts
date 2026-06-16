import { z } from 'zod';

export const IssuePrioritySchema = z.enum(['urgent', 'high', 'medium', 'low', 'none']);
export type IssuePriorityDto = z.infer<typeof IssuePrioritySchema>;

/**
 * DTO создания задачи. `sequenceId` и `identifier` (`KORA-123`) генерирует
 * сервис атомарно. `projectId` — из URL `/projects/:projectId/issues`.
 */
export const CreateIssueSchema = z
  .object({
    title: z.string().min(1).max(500),
    description: z.string().max(50_000).nullable().optional(),
    descriptionHtml: z.string().max(80_000).nullable().optional(),
    descriptionStripped: z.string().max(50_000).nullable().optional(),
    priority: IssuePrioritySchema.default('none'),
    stateId: z.string().max(64).nullable().optional(),
    parentId: z.string().max(64).nullable().optional(),
    estimatePoints: z.number().int().min(0).max(1000).nullable().optional(),
    sortOrder: z.number().int().default(0),
    startDate: z.coerce.date().nullable().optional(),
    dueDate: z.coerce.date().nullable().optional(),
    cycleId: z.string().max(64).nullable().optional(),
    goalId: z.string().max(64).nullable().optional(),
    /**
     * Tracker Boards (2026-05-27) — доска, к которой относится задача.
     * Если не передано — сервис подставит default-доску проекта
     * (`BoardsService.resolveDefaultBoardId`).
     * ТЗ: plans/tz/2026-05-27-tracker-boards.md §"REST API".
     */
    boardId: z.string().max(64).nullable().optional(),
    assigneeUserIds: z.array(z.string().min(1).max(64)).max(32).default([]),
    labelIds: z.array(z.string().min(1).max(64)).max(32).default([]),
    externalSource: z.string().max(40).nullable().optional(),
    externalId: z.string().max(200).nullable().optional(),
    /**
     * A10 (2026-06-14) — IdeaBlock-источники задачи (провенанс). Заполняется
     * внутренними caller'ами (промоут intake→Issue): пересечение с
     * `Decision.sourceBlockIds` той же Org рождает
     * `DecisionTaskLink(linkType='derived')`. Внешний REST его не присылает —
     * optional без default, чтобы caller'ы могли не передавать поле.
     */
    sourceBlockIds: z.array(z.string().min(1).max(64)).max(64).optional(),
    /**
     * Tracker Phase 3 part C — флаг включения AI-suggest при создании задачи.
     * Если true и `IssueInferFieldsService` доступен — в ответе POST /issues
     * будет дополнительное поле `aiSuggestions` с подсказками полей и цели.
     * По умолчанию (undefined / false) никаких LLM-вызовов не делается.
     *
     * Оставлено optional БЕЗ default'а, чтобы внутренние caller'ы трекера
     * (IntakeService.accept, IntakeAutoTriageWorker) могли продолжать
     * передавать DTO без этого поля без TypeScript-ошибок.
     */
    inferSuggestions: z.boolean().optional(),
    /**
     * Wave 3 finishing (Sprint 10, 2026-05-24) — учитывать ли праздники
     * (производственный календарь) при создании задачи.
     *
     * Семантика: если `true` или поле не передано (default) И `dueDate` попадает
     * на праздник/выходной — `IssuesService` сдвигает `dueDate` на следующий
     * рабочий день через `HolidayService.adjustDueDate`. Если `false` —
     * сохраняем `dueDate` ровно как передал клиент.
     *
     * NB: `HolidayService` инжектится через `@Optional()` — если он недоступен
     * (модуль не загрузил его, например в unit-тестах), флаг игнорируется и
     * `dueDate` сохраняется как есть.
     */
    respectHolidays: z.boolean().optional(),
    /**
     * TZ task-dedup (2026-06-16, Ф1) — пропустить дедуп-гейт прямого create.
     * Ставится ТОЛЬКО внутренними caller'ами, которые уже прошли дедуп на
     * уровне intake (IntakeService.triage accept / IntakeAutoTriageWorker),
     * чтобы не делать двойной suggest на одну и ту же карточку (pre-mortem).
     * Внешний REST его не присылает — optional без default.
     */
    skipDedup: z.boolean().optional(),
  })
  .strict();

export type CreateIssueDto = z.infer<typeof CreateIssueSchema>;
