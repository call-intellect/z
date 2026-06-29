import { describe, expect, it } from 'vitest';

import {
  buildTasksDailyOpenPayload,
  type OpenIssueRow,
  type TasksDigestPriority,
} from './morning-tasks-digest.service';

function row(over: Partial<OpenIssueRow> & { issueId: string; identifier: string }): OpenIssueRow {
  return {
    title: `Задача ${over.identifier}`,
    dueDate: null,
    priority: 'none',
    stateCategory: 'backlog',
    ...over,
  };
}

describe('buildTasksDailyOpenPayload', () => {
  const now = new Date('2026-06-29T08:00:00Z');
  const startOfTodayMskUtc = new Date('2026-06-28T21:00:00Z');

  it('раскладывает задачи в 4 непустые группы в порядке overdue→due_today→in_progress→backlog', () => {
    const rows: OpenIssueRow[] = [
      row({ issueId: 'i-bk', identifier: 'PROJ-4', stateCategory: 'backlog' }),
      row({
        issueId: 'i-due',
        identifier: 'PROJ-2',
        dueDate: new Date('2026-06-29T07:00:00Z'),
        stateCategory: 'unstarted',
      }),
      row({ issueId: 'i-prog', identifier: 'PROJ-3', stateCategory: 'started' }),
      row({
        issueId: 'i-over',
        identifier: 'PROJ-1',
        dueDate: new Date('2026-06-28T20:00:00Z'),
        stateCategory: 'unstarted',
      }),
    ];

    const payload = buildTasksDailyOpenPayload({ openIssues: rows, now, maxItemsTotal: 50 });

    expect(payload.isEmpty).toBe(false);
    expect(payload.total).toBe(4);
    expect(payload.dateMsk).toBe('2026-06-29');
    expect(payload.title).toBe('Ваши задачи на сегодня');
    expect(payload.actionUrl).toBe('/tasks');
    expect(payload.groups.map((g) => g.key)).toEqual(['overdue', 'due_today', 'in_progress', 'backlog']);
    expect(payload.groups.map((g) => g.label)).toEqual(['Просрочено', 'Срок сегодня', 'В работе', 'Запланировано']);
    expect(payload.groups.find((g) => g.key === 'overdue')?.items[0]?.issueId).toBe('i-over');
    expect(payload.groups.find((g) => g.key === 'due_today')?.items[0]?.issueId).toBe('i-due');
    expect(payload.groups.find((g) => g.key === 'in_progress')?.items[0]?.issueId).toBe('i-prog');
    expect(payload.groups.find((g) => g.key === 'backlog')?.items[0]?.issueId).toBe('i-bk');
    expect(payload.groups.find((g) => g.key === 'backlog')?.items[0]?.actionUrl).toBe('/issues/i-bk');
  });

  it('возвращает пустой payload при отсутствии задач', () => {
    const payload = buildTasksDailyOpenPayload({ openIssues: [], now, maxItemsTotal: 50 });

    expect(payload).toEqual(
      expect.objectContaining({
        isEmpty: true,
        total: 0,
        groups: [],
        shownCount: 0,
        overflowCount: 0,
        dateMsk: '2026-06-29',
        title: 'Ваши задачи на сегодня',
        actionUrl: '/tasks',
      }),
    );
  });

  it('применяет лимит: 60 задач при maxItemsTotal=50 → shownCount=50, overflowCount=10', () => {
    const rows: OpenIssueRow[] = Array.from({ length: 60 }, (_, idx) =>
      row({ issueId: `i-${idx}`, identifier: `PROJ-${String(idx).padStart(3, '0')}`, stateCategory: 'backlog' }),
    );

    const payload = buildTasksDailyOpenPayload({ openIssues: rows, now, maxItemsTotal: 50 });

    expect(payload.total).toBe(60);
    expect(payload.shownCount).toBe(50);
    expect(payload.overflowCount).toBe(10);
    const sumItems = payload.groups.reduce((acc, g) => acc + g.items.length, 0);
    expect(sumItems).toBe(50);
  });

  it('сортирует внутри группы по приоритету: urgent раньше low', () => {
    const priorities: TasksDigestPriority[] = ['low', 'urgent'];
    const rows: OpenIssueRow[] = priorities.map((priority, idx) =>
      row({ issueId: `i-${priority}`, identifier: `PROJ-${idx}`, priority, stateCategory: 'backlog' }),
    );

    const payload = buildTasksDailyOpenPayload({ openIssues: rows, now, maxItemsTotal: 50 });
    const backlog = payload.groups.find((g) => g.key === 'backlog');

    expect(backlog?.items.map((i) => i.priority)).toEqual(['urgent', 'low']);
    expect(backlog?.items[0]?.issueId).toBe('i-urgent');
  });

  it('корректно режет границу МСК-суток', () => {
    expect(startOfTodayMskUtc.getTime()).toBe(new Date('2026-06-28T21:00:00Z').getTime());

    const rows: OpenIssueRow[] = [
      row({
        issueId: 'i-yesterday',
        identifier: 'PROJ-1',
        dueDate: new Date('2026-06-28T20:00:00Z'),
        stateCategory: 'unstarted',
      }),
      row({
        issueId: 'i-today',
        identifier: 'PROJ-2',
        dueDate: new Date('2026-06-29T07:00:00Z'),
        stateCategory: 'unstarted',
      }),
    ];

    const payload = buildTasksDailyOpenPayload({ openIssues: rows, now, maxItemsTotal: 50 });

    expect(payload.groups.find((g) => g.key === 'overdue')?.items.map((i) => i.issueId)).toEqual(['i-yesterday']);
    expect(payload.groups.find((g) => g.key === 'due_today')?.items.map((i) => i.issueId)).toEqual(['i-today']);
  });
});
