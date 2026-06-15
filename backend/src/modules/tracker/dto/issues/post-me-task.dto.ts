import { z } from 'zod';

/**
 * ТЗ#3 (2026-06-15) — постановка задачи СЕБЕ из помощника
 * (`POST /api/v1/me/tasks`). Предусловие инструмента `create_task`.
 *
 * Контракт сознательно узкий — рядовой сотрудник (member/manager) ставит
 * задачу только себе, без права `intake_issue/write` (которое у owner/admin/coo)
 * и без выбора чужого исполнителя. Поэтому в body НЕТ ни `projectId`
 * (всегда дефолт-проект «Входящие»), ни `assigneeUserIds` (всегда сам
 * запрашивающий) — расширять доступ через этот эндпоинт нельзя.
 */
export const PostMeTaskBodySchema = z
  .object({
    /** Заголовок задачи. Обязателен, непустой. */
    title: z.string().min(1, 'Заголовок задачи обязателен').max(500),
    /** Необязательное описание задачи. */
    description: z.string().max(50_000).nullable().optional(),
    /**
     * Необязательный срок (ISO-8601 строка). `z.coerce.date()` принимает
     * строку и приводит к Date — так же, как `dueDate` в CreateIssueSchema.
     */
    dueDate: z.coerce.date().nullable().optional(),
  })
  .strict();

export type PostMeTaskBodyDto = z.infer<typeof PostMeTaskBodySchema>;

/**
 * Ответ `POST /api/v1/me/tasks` — минимальный контракт, который ждёт
 * инструмент `create_task` (ТЗ#3b): идентификатор созданной задачи, её
 * заголовок, проект и человекочитаемый статус (категория состояния).
 */
export interface PostMeTaskResponseDto {
  id: string;
  title: string;
  projectId: string;
  /** Категория состояния задачи: backlog / started / completed / cancelled. */
  status: string;
}
