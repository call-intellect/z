import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChecklistsService } from './checklists.service';
import { materializeIntakeChecklist } from './intake-checklist-materialize.util';

const ISSUE_ID = 'issue-1';
const TENANT = 'tenant-1';

function makeChecklistsMock() {
  const createChecklist = vi.fn().mockResolvedValue({ id: 'cl1' });
  const bulkCreateItems = vi.fn().mockResolvedValue([]);
  const checklists = { createChecklist, bulkCreateItems } as unknown as ChecklistsService;
  return { checklists, createChecklist, bulkCreateItems };
}

describe('materializeIntakeChecklist', () => {
  beforeEach(() => vi.clearAllMocks());

  it('кейс 1: создаёт чек-лист и пункты из валидного checklistJson', async () => {
    const { checklists, createChecklist, bulkCreateItems } = makeChecklistsMock();

    await materializeIntakeChecklist(
      checklists,
      ISSUE_ID,
      [{ title: 'Шаги', items: [{ text: 'a' }, { text: 'b' }, { text: 'c' }] }],
      TENANT,
    );

    expect(createChecklist).toHaveBeenCalledTimes(1);
    expect(createChecklist).toHaveBeenCalledWith(
      ISSUE_ID,
      expect.objectContaining({ title: 'Шаги' }),
      TENANT,
    );
    expect(bulkCreateItems).toHaveBeenCalledTimes(1);
    expect(bulkCreateItems).toHaveBeenCalledWith(
      'cl1',
      expect.objectContaining({ checklistId: 'cl1', lines: ['a', 'b', 'c'] }),
      TENANT,
    );
  });

  it('кейс 2: checklistJson=null — ничего не вызывает', async () => {
    const { checklists, createChecklist, bulkCreateItems } = makeChecklistsMock();

    await materializeIntakeChecklist(checklists, ISSUE_ID, null, TENANT);

    expect(createChecklist).not.toHaveBeenCalled();
    expect(bulkCreateItems).not.toHaveBeenCalled();
  });

  it('кейс 3: пустые items — ничего не вызывает', async () => {
    const { checklists, createChecklist, bulkCreateItems } = makeChecklistsMock();

    await materializeIntakeChecklist(checklists, ISSUE_ID, [{ items: [] }], TENANT);

    expect(createChecklist).not.toHaveBeenCalled();
    expect(bulkCreateItems).not.toHaveBeenCalled();
  });

  it('кейс 4: обрезает пробелы (trim) в тексте пунктов', async () => {
    const { checklists, bulkCreateItems } = makeChecklistsMock();

    await materializeIntakeChecklist(
      checklists,
      ISSUE_ID,
      [{ items: [{ text: '  x  ' }] }],
      TENANT,
    );

    expect(bulkCreateItems).toHaveBeenCalledTimes(1);
    expect(bulkCreateItems).toHaveBeenCalledWith(
      'cl1',
      expect.objectContaining({ lines: ['x'] }),
      TENANT,
    );
  });
});
