import { describe, it } from 'vitest';

/**
 * TODO (Фаза 0a.4): покрыть тестами `PersonsService`:
 *   - create Person + PersonRole + EntityLink executes_role/member_of;
 *   - PATCH roleId закрывает старую PersonRole и старую EntityLink, создаёт новые;
 *   - softDelete закрывает все исходящие/входящие EntityLink + PersonRole;
 *   - фильтр invitationStatus по последнему OrgInvitation;
 *   - tenant isolation.
 */
describe.skip('PersonsService', () => {
  it('TODO: покрыть CRUD + PersonRole-temporal + EntityLink', () => {
    // см. план 2026-05-21-phase-0a-data-model-and-graph-infra.md §7-§10
  });
});
