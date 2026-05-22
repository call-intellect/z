import { describe, it } from 'vitest';

/**
 * TODO (Фаза 0a.4): покрыть тестами `DepartmentsService`:
 *   - create / batch / update / softDelete с tenant isolation;
 *   - запрет soft-delete при наличии активных Role / children;
 *   - корректная обработка P2002 (уникальность tenantId+name+deletedAt);
 *   - проверка прав через RbacService (mock).
 */
describe.skip('DepartmentsService', () => {
  it('TODO: покрыть тестами CRUD + soft-delete', () => {
    // см. план 2026-05-21-phase-0a-data-model-and-graph-infra.md §7-§10
  });
});
