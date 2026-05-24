/**
 * T8 (2026-05-24) — component-тесты MentionAutocompletePopup.
 *
 * Покрытие:
 *  1. Рендер с пустым query показывает первых N членов проекта.
 *  2. Фильтрация по displayName + handle (email-local-part).
 *  3. onSelect срабатывает с правильным member'ом по клику.
 *  4. Пустой результат → «Никого не найдено».
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import type { ProjectMember } from '@/domain/tracker';

import { MentionAutocompletePopup } from './MentionAutocompletePopup';

const member = (overrides: Partial<ProjectMember>): ProjectMember => ({
  id: 'mem-' + Math.random().toString(36).slice(2, 8),
  projectId: 'p1',
  userId: 'u-' + Math.random().toString(36).slice(2, 8),
  role: 15,
  joinedAt: new Date(),
  displayName: null,
  email: null,
  ...overrides,
});

const MEMBERS: ProjectMember[] = [
  member({ userId: 'u-anna', displayName: 'Анна Петрова', email: 'anna@org.io' }),
  member({ userId: 'u-borya', displayName: 'Борис Кузнецов', email: 'borya@org.io' }),
  member({ userId: 'u-vera', displayName: 'Вера Иванова', email: 'vera@org.io' }),
];

describe('MentionAutocompletePopup', () => {
  it('пустой query — показывает первых членов проекта', () => {
    render(
      <MentionAutocompletePopup
        members={MEMBERS}
        query=""
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Анна Петрова')).toBeInTheDocument();
    expect(screen.getByText('Борис Кузнецов')).toBeInTheDocument();
    expect(screen.getByText('Вера Иванова')).toBeInTheDocument();
  });

  it('фильтр по handle (email-local-part)', () => {
    render(
      <MentionAutocompletePopup
        members={MEMBERS}
        query="bor"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Борис Кузнецов')).toBeInTheDocument();
    expect(screen.queryByText('Анна Петрова')).not.toBeInTheDocument();
    expect(screen.queryByText('Вера Иванова')).not.toBeInTheDocument();
  });

  it('onSelect вызывается с выбранным членом', () => {
    const onSelect = vi.fn();
    render(
      <MentionAutocompletePopup
        members={MEMBERS}
        query=""
        onSelect={onSelect}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Анна Петрова'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]![0].userId).toBe('u-anna');
  });

  it('пустой результат — «Никого не найдено»', () => {
    render(
      <MentionAutocompletePopup
        members={MEMBERS}
        query="xyz-nobody"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Никого не найдено')).toBeInTheDocument();
  });
});
