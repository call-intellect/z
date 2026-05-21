import { describe, expect, it } from 'vitest';

/**
 * Тесты для GET /api/v1/documents/:id provenance (Фаза 0b §10, §13 ТЗ).
 *
 * Skeleton — реальные ассерты появятся в Фазе 0b.2 интеграционно.
 *
 * TODO (Фаза 0b.2 integration):
 *   - owner/admin видит extractedEntities (provenance группы Б).
 *   - manager НЕ видит extractedEntities (поле undefined в ответе).
 *   - ideaBlocks возвращаются всегда (owner/admin/manager).
 *   - Decision: создаётся через sourceIdeaBlockId, попадает в provenance.
 *   - Process/Regulation/Policy/Metric/Tool: через EntityLink derived_from
 *     → попадают в соответствующие массивы provenance.
 *   - Документ из чужой Org → 403.
 */
describe.skip('GET /api/v1/documents/:id provenance (Фаза 0b §10)', () => {
  it('owner: extractedEntities заполнено всеми типами группы Б', () => {
    expect(true).toBe(true);
  });

  it('admin: то же, что у owner', () => {
    expect(true).toBe(true);
  });

  it('manager: extractedEntities отсутствует (RBAC отказал)', () => {
    expect(true).toBe(true);
  });

  it('ideaBlocks возвращаются manager-у (но без provenance группы Б)', () => {
    expect(true).toBe(true);
  });

  it('Decision idempotent: повторная обработка не дублирует', () => {
    expect(true).toBe(true);
  });
});
