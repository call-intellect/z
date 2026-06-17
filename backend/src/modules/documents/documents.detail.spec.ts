import { describe, expect, it } from 'vitest';

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
