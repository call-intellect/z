/**
 * Регресс-гард: детальная таблица /tables/[id] не должна уходить в бесконечный
 * ре-рендер (React #185 «Maximum update depth exceeded»).
 *
 * Причина бага: селекторы `selectVisibleProperties` / `selectVisibleRows`
 * возвращают НОВЫЙ массив на каждый вызов. В Zustand v5 это означает, что
 * `useTableStore(selector)` на каждом рендере видит «новую» ссылку и заставляет
 * компонент перерендериться снова → петля. Канонический фикс — обернуть селектор
 * в `useShallow` (поверхностное сравнение содержимого массива вместо ссылки).
 *
 * Этот тест воспроизводит probe-компонент ровно как в TableClient.tsx (оба
 * селектора через `useShallow`) и доказывает, что число рендеров остаётся
 * ограниченным. Если кто-то уберёт `useShallow` — рендеров станет много (или
 * React выбросит «Maximum update depth exceeded»), и тест упадёт.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useShallow } from 'zustand/react/shallow';

import {
  selectVisibleProperties,
  selectVisibleRows,
  useTableStore,
} from '@app/(authenticated)/tables/[id]/store/tableStore';
import type {
  TablePropertyDomain,
  TableRowDomain,
} from '@/domain/table';

// ─────────────────────────── минимальные фикстуры ────────────────────────────

const NOW = new Date('2026-06-07T00:00:00.000Z');

const PROPERTIES: TablePropertyDomain[] = [
  {
    id: 'prop-1',
    tableId: 'table-1',
    name: 'Название',
    type: 'text',
    config: {},
    isPrimary: true,
    order: 0,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: 'prop-2',
    tableId: 'table-1',
    name: 'Статус',
    type: 'status',
    config: {},
    isPrimary: false,
    order: 1,
    createdAt: NOW,
    updatedAt: NOW,
  },
];

const ROWS: TableRowDomain[] = [
  {
    id: 'row-1',
    tableId: 'table-1',
    tenantId: 'org-1',
    cells: { 'prop-1': 'Альфа', 'prop-2': 'Активен' },
    entityId: null,
    order: 0,
    archivedAt: null,
    createdBy: 'user-1',
    createdAt: NOW,
    updatedAt: NOW,
    pageContent: null,
  },
  {
    id: 'row-2',
    tableId: 'table-1',
    tenantId: 'org-1',
    cells: { 'prop-1': 'Бета', 'prop-2': 'Завершён' },
    entityId: null,
    order: 1,
    archivedAt: null,
    createdBy: 'user-1',
    createdAt: NOW,
    updatedAt: NOW,
    pageContent: null,
  },
];

// ─────────────────────────── probe-компонент ─────────────────────────────────

let renderCount = 0;

function Probe() {
  renderCount++;
  const properties = useTableStore(useShallow(selectVisibleProperties));
  const rows = useTableStore(useShallow(selectVisibleRows));
  return (
    <div data-testid="probe">
      {properties.length}/{rows.length}
    </div>
  );
}

// ─────────────────────────── изоляция тестов ─────────────────────────────────

beforeEach(() => {
  renderCount = 0;
  useTableStore.setState({
    properties: PROPERTIES,
    rows: ROWS,
    draftConfig: { filters: [], sorts: [], hiddenProps: [] },
  });
});

afterEach(() => {
  // Сбрасываем только релевантные поля к initial state — без реальных
  // mutations/таймеров (store.reset() трогает Map'ы дебаунса, нам это не нужно).
  useTableStore.setState({
    properties: [],
    rows: [],
    draftConfig: {},
  });
});

// ─────────────────────────── тест ────────────────────────────────────────────

describe('TableClient render loop guard (selectVisibleRows/Properties + useShallow)', () => {
  it('does not infinitely re-render and reflects store data once', () => {
    render(<Probe />);

    // Содержимое отрисовано из стора: 2 колонки / 2 строки.
    expect(screen.getByTestId('probe').textContent).toBe('2/2');

    // С useShallow рендеров должно быть мало (init + возможный StrictMode-дубль).
    // Без useShallow тут была бы петля → «Maximum update depth exceeded».
    expect(renderCount).toBeLessThanOrEqual(3);
  });
});
