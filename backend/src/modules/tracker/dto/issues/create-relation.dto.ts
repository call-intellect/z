import { z } from 'zod';

/**
 * Поддерживаемые типы связей между задачами трекера.
 *
 * Симметричные пары обратных связей (см. `RelationsService.createRelation`):
 *   - `blocks`         ↔ `blocked_by`
 *   - `duplicates`     ↔ `duplicated_by`
 *   - `relates_to`     ↔ `relates_to` (само-обратная)
 */
export const IssueRelationTypeSchema = z.enum([
  'blocks',
  'blocked_by',
  'duplicates',
  'duplicated_by',
  'relates_to',
]);
export type IssueRelationType = z.infer<typeof IssueRelationTypeSchema>;

/**
 * DTO создания связи. `sourceIssueId` — из URL (`/issues/:id/relations`),
 * не дублируем в body. `targetIssueId` обязателен.
 */
export const CreateIssueRelationSchema = z
  .object({
    targetIssueId: z.string().min(1).max(64),
    relationType: IssueRelationTypeSchema,
  })
  .strict();
export type CreateIssueRelationDto = z.infer<typeof CreateIssueRelationSchema>;

/**
 * Сводный DTO выдачи `IssueRelation` (как is из БД + удобный direction-marker).
 *
 * `direction='out'` — текущая задача является `sourceIssueId`.
 * `direction='in'` — текущая задача является `targetIssueId`.
 * Это позволяет фронту корректно ренедерить «X блокирует Y» vs «Y блокирует X».
 */
export interface IssueRelationDto {
  id: string;
  sourceIssueId: string;
  targetIssueId: string;
  relationType: IssueRelationType | string;
  createdById: string;
  createdAt: string;
  /** Направление относительно `issueId` из URL запроса. */
  direction: 'out' | 'in';
}

/**
 * Для данного `relationType` вернуть обратный тип, который должен быть создан
 * парной записью (target → source). Возвращает `null`, если связь не имеет
 * парного обратного типа в нашем словаре.
 */
export function oppositeRelationType(
  relationType: IssueRelationType,
): IssueRelationType | null {
  switch (relationType) {
    case 'blocks':
      return 'blocked_by';
    case 'blocked_by':
      return 'blocks';
    case 'duplicates':
      return 'duplicated_by';
    case 'duplicated_by':
      return 'duplicates';
    case 'relates_to':
      return 'relates_to';
    default:
      return null;
  }
}
