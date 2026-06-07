import { z } from 'zod';

/**
 * Zod-DTO для admin-эндпоинтов управления доступом к знаниям
 * (ТЗ 2026-06-06 knowledge-access-groups, Фаза 7 часть A).
 *
 * Все строки, видимые пользователю (тексты ошибок валидации), — на русском.
 */

/** Допустимые значения закрытой группы (kind закрытых групп + null = «открыто»). */
export const ClosedGroupKindSchema = z
  .enum(['leadership', 'council', 'personal'])
  .nullable();
export type ClosedGroupKind = z.infer<typeof ClosedGroupKindSchema>;

/**
 * `PUT /matrix/:subjectGroupId` — направленно задать список видимых отделов.
 * Идемпотентно заменяет все политики subject-группы.
 */
export const SetMatrixSchema = z.object({
  visibleGroupIds: z
    .array(z.string().min(1).max(50))
    .max(200, 'Слишком много отделов в списке видимости'),
});
export type SetMatrixDto = z.infer<typeof SetMatrixSchema>;

/** `POST /groups/:groupId/members` — добавить человека в группу. */
export const AddMemberSchema = z.object({
  personId: z.string().min(1).max(50),
});
export type AddMemberDto = z.infer<typeof AddMemberSchema>;

/** `PATCH /meeting-types/:typeId/closed-default` — дефолт закрытости по типу. */
export const SetClosedDefaultSchema = z.object({
  defaultClosedGroupKind: ClosedGroupKindSchema,
});
export type SetClosedDefaultDto = z.infer<typeof SetClosedDefaultSchema>;
