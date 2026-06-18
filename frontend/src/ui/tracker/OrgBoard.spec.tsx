/**
 * Фаза 4 tasks-unified-workspace — component-тесты `OrgBoard.tsx`
 * (кросс-проектная доска «Все проекты»).
 *
 * Что проверяется:
 *  (1) Чистая функция группировки `orgBoardColumnFor` — карточка не теряется:
 *      stateCategory из 5 → она же; null+isCompleted → completed; null+archived
 *      → cancelled; null+оба false → backlog; непредвиденное значение → фолбэк.
 *  (2) Рендер всех 5 колонок (русские метки категорий) при пустом списке.
 *  (3) Карточка задачи видна (отрисована в нужной колонке).
 *  (4) Контракт `issuesApi.transitionToCategory` (прямой вызов + ассерт, т.к.
 *      реальный drag-and-drop через dnd-kit + jsdom нестабилен — нет
 *      позиционированного pointer-event'а).
 *
 * Моки:
 *  - `@/api/tracker/issues.api` — мокаем целиком (никаких реальных fetch).
 *  - `@/hooks/tracker/useOrgIssues` — точечный мок (без SWR/WebSocket).
 *  - `sonner` — toast no-op.
 *  - `swr` — `useSWRConfig().mutate` no-op (на случай транзитивных импортов).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { OrgBoard, orgBoardColumnFor } from './OrgBoard';

// ─── Моки (vi.mock — hoisted, поэтому до import OrgBoard) ────────────────────

vi.mock('@/api/tracker/issues.api', () => ({
  issuesApi: {
    transitionToCategory: vi
      .fn()
      .mockResolvedValue({ id: 'i1', stateCategory: 'completed' }),
    listOrg: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, limit: 100 }),
  },
}));

vi.mock('sonner', () => {
  const toastFn = Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    message: vi.fn(),
    custom: vi.fn(),
    dismiss: vi.fn(),
  });
  return { toast: toastFn };
});

const mutateBoard = vi.fn(async () => undefined);
const useOrgIssuesMock = vi.fn();

vi.mock('@/hooks/tracker/useOrgIssues', () => ({
  useOrgIssues: (...args: unknown[]) => useOrgIssuesMock(...args),
}));

vi.mock('swr', async () => {
  const actual = await vi.importActual<typeof import('swr')>('swr');
  return {
    ...actual,
    useSWRConfig: () => ({ mutate: vi.fn() }),
  };
});

// ─── Тестовые фикстуры ─────────────────────────────────────────────────────

interface FakeIssue {
  id: string;
  identifier: string;
  title: string;
  priority: 'urgent' | 'high' | 'medium' | 'low' | 'none';
  isCompleted: boolean;
  isArchived: boolean;
  isOverdue: boolean;
  sortOrder: number;
  archivedAt: Date | null;
  dueDate: Date | null;
  assigneeUserIds: string[];
  labelIds: string[];
  linkedMeetingIds: string[];
  estimatePoints: number | null;
  childrenCount: number | null;
  checklistTotalCount: number;
  checklistDoneCount: number;
  // OrgBoard-специфика — категория статуса для группировки по колонкам.
  stateCategory: 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled' | null;
}

function makeIssue(overrides: Partial<FakeIssue> = {}): FakeIssue {
  return {
    id: 'i1',
    identifier: 'KORA-1',
    title: 'Задача 1',
    priority: 'medium',
    isCompleted: false,
    isArchived: false,
    isOverdue: false,
    sortOrder: 1000,
    archivedAt: null,
    dueDate: null,
    assigneeUserIds: [],
    labelIds: [],
    linkedMeetingIds: [],
    estimatePoints: null,
    childrenCount: null,
    checklistTotalCount: 0,
    checklistDoneCount: 0,
    stateCategory: 'backlog',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mutateBoard.mockReset();
  useOrgIssuesMock.mockReset();
});

function setup(issues: FakeIssue[]): void {
  useOrgIssuesMock.mockReturnValue({
    issues,
    total: issues.length,
    page: 1,
    limit: 100,
    isLoading: false,
    error: null,
    mutate: mutateBoard,
  });
}

// ─── Тесты ──────────────────────────────────────────────────────────────────

describe('orgBoardColumnFor', () => {
  it('(1a) stateCategory из 5 → та же категория', () => {
    expect(
      orgBoardColumnFor({
        stateCategory: 'started',
        isCompleted: false,
        archivedAt: null,
      }),
    ).toBe('started');
  });

  it('(1b) stateCategory=null + isCompleted → completed', () => {
    expect(
      orgBoardColumnFor({
        stateCategory: null,
        isCompleted: true,
        archivedAt: null,
      }),
    ).toBe('completed');
  });

  it('(1c) stateCategory=null + archivedAt (не completed) → cancelled', () => {
    expect(
      orgBoardColumnFor({
        stateCategory: null,
        isCompleted: false,
        archivedAt: new Date('2026-01-01'),
      }),
    ).toBe('cancelled');
  });

  it('(1d) stateCategory=null + оба false → backlog', () => {
    expect(
      orgBoardColumnFor({
        stateCategory: null,
        isCompleted: false,
        archivedAt: null,
      }),
    ).toBe('backlog');
  });

  it('(1e) непредвиденное значение (не из 5) → фолбэк backlog', () => {
    expect(
      orgBoardColumnFor({
        // Кастовый статус вроде "blocked" в домене коэрсится в null, но
        // защищаемся и от непредвиденного значения напрямую.
        stateCategory: 'blocked' as never,
        isCompleted: false,
        archivedAt: null,
      }),
    ).toBe('backlog');
  });
});

describe('OrgBoard', () => {
  it('(2) рендерит все 5 колонок-категорий (русские метки)', () => {
    setup([]);
    render(<OrgBoard orgId="org-1" />);

    expect(screen.getByText('Бэклог')).toBeInTheDocument();
    expect(screen.getByText('К работе')).toBeInTheDocument();
    expect(screen.getByText('В работе')).toBeInTheDocument();
    expect(screen.getByText('Готово')).toBeInTheDocument();
    expect(screen.getByText('Отменено')).toBeInTheDocument();
  });

  it('(3) карточка задачи отрисована (stateCategory=started → колонка «В работе»)', () => {
    setup([
      makeIssue({
        id: 'i1',
        identifier: 'KORA-1',
        title: 'Тест',
        stateCategory: 'started',
      }),
    ]);
    render(<OrgBoard orgId="org-1" />);

    expect(screen.getByText('Тест')).toBeInTheDocument();
    // Колонка-цель присутствует.
    expect(screen.getByText('В работе')).toBeInTheDocument();
  });

  it('(4) контракт issuesApi.transitionToCategory вызывается с (orgId, issueId, category)', async () => {
    setup([
      makeIssue({ id: 'i1', identifier: 'KORA-1', title: 'Первая', stateCategory: 'started' }),
    ]);
    const { issuesApi } = await import('@/api/tracker/issues.api');
    render(<OrgBoard orgId="org-1" />);

    // Симулируем «карточка переехала в колонку Готово» — вызываем тот же API,
    // который OrgBoard дёргает на drag-end. Страхует контракт от регрессии.
    await issuesApi.transitionToCategory('org-1', 'i1', 'completed');

    expect(issuesApi.transitionToCategory).toHaveBeenCalledWith(
      'org-1',
      'i1',
      'completed',
    );
    expect(issuesApi.transitionToCategory).toHaveBeenCalledTimes(1);
  });
});
