import { describe, it } from 'vitest';

/**
 * TODO (Фаза 0a.4): покрыть тестами `RoleProfilesService`:
 *   - list по status + tenant isolation;
 *   - getByRoleId возвращает minBlocks из ENV (default 5) и currentBlocks
 *     из IdeaBlock.count(roleId, roleRelevant=true);
 *   - rebuild — stub возвращает 'queued';
 *   - buildStatus — stub возвращает 'idle'.
 */
describe.skip('RoleProfilesService (CRUD-side)', () => {
  it('TODO: покрыть read + stub-и rebuild/build-status', () => {
    // см. план 2026-05-21-phase-0a-data-model-and-graph-infra.md §7-§10
  });
});
