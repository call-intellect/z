import type { Project } from '@prisma/client';

/**
 * Sprints (2026-05-28) — определяем «scope» проекта по 4 опц. полям
 * (`customerCardId / vendorId / subjectPersonId / departmentId`).
 *
 * Извлечено из `cycles.service.ts` в отдельный util, чтобы переиспользовать
 * в `SprintsService.list` (массовый маппинг) и в любом другом месте, где
 * нужно классифицировать проект по scope. См. ТЗ §1.2.
 *
 * Семантика:
 *   - Если заполнено одно из 4 scope-полей → возвращаем соответствующий тип.
 *   - Если все 4 пусты → 'org' (спринт компании).
 *   - Тип 'project' зарезервирован для будущего «спринт проекта без бизнес-scope»
 *     (см. ТЗ Wizard вариант 'project'); по схеме БД сейчас неотличимо от 'org',
 *     поэтому функция этого типа не возвращает. Маппинг 'project' живёт в
 *     UI/wizard'е (выбор существующего Project = scope 'project').
 *
 * Бизнес-инвариант: ≤1 поля заполнено. Гарантируется `ProjectsService.create/update`
 * и `CreateProjectSchema.superRefine`. Если по какой-то причине заполнено >1 —
 * берём приоритет в порядке customer → vendor → person → department.
 */
export function detectProjectScopeKind(
  p: Pick<Project, 'customerCardId' | 'vendorId' | 'subjectPersonId' | 'departmentId'>,
): 'org' | 'customer' | 'vendor' | 'person' | 'department' {
  if (p.customerCardId) return 'customer';
  if (p.vendorId) return 'vendor';
  if (p.subjectPersonId) return 'person';
  if (p.departmentId) return 'department';
  return 'org';
}
