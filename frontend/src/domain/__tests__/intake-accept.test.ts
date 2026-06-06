/**
 * Unit-тесты резолвера проекта для accept входящей (Phase A1).
 *
 * `resolveAcceptTargetProjectId` определяет, в какой проект создать задачу:
 *   - явный `projectId` имеет приоритет над suggested,
 *   - при отсутствии явного — берётся `suggestedProjectId`,
 *   - если оба null — возвращается null (нужен ручной выбор проекта).
 */
import { describe, expect, it } from 'vitest';

import { resolveAcceptTargetProjectId } from '../tracker/intake';

describe('resolveAcceptTargetProjectId', () => {
  it('возвращает явный projectId, даже если suggested задан', () => {
    expect(
      resolveAcceptTargetProjectId({
        projectId: 'p1',
        suggestedProjectId: 's1',
      }),
    ).toBe('p1');
  });

  it('падает на suggestedProjectId, когда явного projectId нет', () => {
    expect(
      resolveAcceptTargetProjectId({
        projectId: null,
        suggestedProjectId: 's1',
      }),
    ).toBe('s1');
  });

  it('возвращает null, когда оба не заданы', () => {
    expect(
      resolveAcceptTargetProjectId({
        projectId: null,
        suggestedProjectId: null,
      }),
    ).toBeNull();
  });
});
