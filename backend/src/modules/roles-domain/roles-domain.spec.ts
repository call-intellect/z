import { describe, it } from 'vitest';

/**
 * TODO (Фаза 0a.4): покрыть тестами `RolesDomainService`:
 *   - create Role одновременно создаёт RoleProfile (status=forming);
 *   - create с departmentId создаёт EntityLink belongs_to;
 *   - PATCH departmentId закрывает старую EntityLink и создаёт новую;
 *   - DELETE — soft + archived EntityLink + запрет при активных PersonRole.
 */
describe.skip('RolesDomainService', () => {
  it('TODO: покрыть CRUD + RoleProfile auto-create + EntityLink belongs_to', () => {
    // см. план 2026-05-21-phase-0a-data-model-and-graph-infra.md §7-§10
  });
});
