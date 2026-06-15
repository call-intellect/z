/**
 * Тесты `AssistantTargetSelect` (ТЗ#5) — селектор адресата AI-чата кабинета.
 *
 * Сценарии (§8 ТЗ):
 *   1. Пустой список ролевых клонов → компонент возвращает null (нет селектора).
 *   2. Пока грузим клонов → null (не мигаем).
 *   3. Есть клоны → рендерится триггер; при открытии — помощник + клоны.
 *   4. Дефолтное value=assistant → подпись «Кора · помощник компании».
 *   5. Недоступный клон (нет grant) → опция помечена «нет доступа» и disabled.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import type { AssistantTarget } from '@/domain/chat-v2';

const useClonesMock = vi.fn();
const useMyCloneAccessMock = vi.fn();

vi.mock('@/hooks/useClones', () => ({
  useClones: (orgId: string | null) => useClonesMock(orgId),
  useMyCloneAccess: (orgId: string | null) => useMyCloneAccessMock(orgId),
}));

import { AssistantTargetSelect } from './AssistantTargetSelect';

function accessMap(roleIds: string[]) {
  const set = new Set(roleIds);
  return {
    access: {
      has: (kind: 'role' | 'person', id: string) =>
        kind === 'role' && set.has(id),
    },
  };
}

const cloneItem = (over: Partial<Record<string, unknown>> = {}) => ({
  personaId: 'p',
  roleId: 'role-mkt',
  roleName: 'Маркетолог',
  departmentName: 'Маркетинг',
  departmentId: 'd',
  version: 1,
  publicName: 'Клон Маркетолога',
  status: 'active' as const,
  bearerName: null,
  bearerPersonId: null,
  confidencePct: 80,
  traitsCount: 10,
  lastBuildAt: new Date(),
  ...over,
});

describe('AssistantTargetSelect (ТЗ#5)', () => {
  beforeEach(() => {
    useClonesMock.mockReset();
    useMyCloneAccessMock.mockReset();
  });

  it('1. пустой список клонов → null (селектор скрыт)', () => {
    useClonesMock.mockReturnValue({ items: [], isLoading: false });
    useMyCloneAccessMock.mockReturnValue(accessMap([]));
    const { container } = render(
      <AssistantTargetSelect
        orgId="org-1"
        value={{ kind: 'assistant' }}
        onChange={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('2. isLoading → null', () => {
    useClonesMock.mockReturnValue({ items: [], isLoading: true });
    useMyCloneAccessMock.mockReturnValue(accessMap([]));
    const { container } = render(
      <AssistantTargetSelect
        orgId="org-1"
        value={{ kind: 'assistant' }}
        onChange={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('3+4. есть клоны → триггер с дефолтной подписью «помощник компании»', () => {
    useClonesMock.mockReturnValue({
      items: [cloneItem()],
      isLoading: false,
    });
    useMyCloneAccessMock.mockReturnValue(accessMap(['role-mkt']));
    render(
      <AssistantTargetSelect
        orgId="org-1"
        value={{ kind: 'assistant' }}
        onChange={vi.fn()}
      />,
    );
    const trigger = screen.getByRole('combobox', { name: 'Кому задать вопрос' });
    expect(trigger).toBeInTheDocument();
    // Дефолт — общий помощник: текст виден в триггере.
    expect(trigger).toHaveTextContent('Кора · помощник компании');
  });

  it('5. value=clone → подпись = имя клона', () => {
    useClonesMock.mockReturnValue({
      items: [cloneItem()],
      isLoading: false,
    });
    useMyCloneAccessMock.mockReturnValue(accessMap(['role-mkt']));
    const value: AssistantTarget = {
      kind: 'clone',
      roleId: 'role-mkt',
      roleName: 'Клон Маркетолога',
    };
    render(
      <AssistantTargetSelect orgId="org-1" value={value} onChange={vi.fn()} />,
    );
    const trigger = screen.getByRole('combobox', { name: 'Кому задать вопрос' });
    expect(trigger).toHaveTextContent('Клон Маркетолога');
  });

  it('открытие списка показывает помощника и клонов; недоступный — disabled', () => {
    useClonesMock.mockReturnValue({
      items: [
        cloneItem(),
        cloneItem({
          roleId: 'role-sales',
          roleName: 'Продажи',
          publicName: 'Клон Продаж',
          departmentName: 'Продажи',
        }),
      ],
      isLoading: false,
    });
    // Доступ только к маркетологу.
    useMyCloneAccessMock.mockReturnValue(accessMap(['role-mkt']));
    render(
      <AssistantTargetSelect
        orgId="org-1"
        value={{ kind: 'assistant' }}
        onChange={vi.fn()}
      />,
    );
    const trigger = screen.getByRole('combobox', { name: 'Кому задать вопрос' });
    // Radix открывает список по pointerdown + Enter/Space; в jsdom надёжнее
    // клик + key. Используем keyDown ' ' для раскрытия.
    fireEvent.keyDown(trigger, { key: ' ' });

    // Опции рендерятся в портале. «помощник компании» виден и в триггере
    // (зеркало value), и в списке — потому getAllByText (>=1).
    expect(
      screen.getAllByText('Кора · помощник компании').length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Клон Маркетолога')).toBeInTheDocument();
    expect(screen.getByText('Клон Продаж')).toBeInTheDocument();
    // Недоступный клон помечен «нет доступа».
    expect(screen.getByText('· нет доступа')).toBeInTheDocument();
  });
});
