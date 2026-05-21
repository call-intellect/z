import { describe, it } from 'vitest';

/**
 * TODO (Фаза 0a.4): покрыть тестами `JobDescriptionsService`:
 *   - create создаёт EntityLink described_by (role→job-description);
 *   - create с sourceDocumentId создаёт EntityLink derived_from;
 *   - PATCH увеличивает version и пересоздаёт derived_from при смене source;
 *   - softDelete закрывает все EntityLink.
 */
describe.skip('JobDescriptionsService', () => {
  it('TODO: покрыть CRUD + EntityLink described_by/derived_from', () => {
    // см. план 2026-05-21-phase-0a-data-model-and-graph-infra.md §7-§10
  });
});
