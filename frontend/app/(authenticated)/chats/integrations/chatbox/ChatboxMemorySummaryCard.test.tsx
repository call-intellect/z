/**
 * Тесты виджета «Чаты в памяти» (ТЗ 2026-06-11 remaining-handoff, блок A, Ф2)
 * и доменного маппера `mapMemorySummary`.
 *
 * Покрытие:
 *   Маппер:
 *     (1) ApiDto → DomainModel: pass-through полей + производные
 *         (pending = inProgress, hasData по dialogs/sessions).
 *   Компонент:
 *     (2) Числа всех счётчиков отображаются; «Карточки памяти»/«Задачи» —
 *         ссылки на /cards и /tasks.
 *     (3) analysisEnabled=false + есть диалоги → плашка «анализ выключен».
 *     (4) analysisEnabled=true → плашки нет.
 *     (5) configured=false → карточка не рендерится (null).
 *     (6) Загрузка → заголовок виден, чисел нет (skeleton-state).
 *
 * Моки:
 *   - `swr` — useSWR мокаем, чтобы детерминированно отдавать data/loading/error.
 *   - `@/api/chatbox.api` — заглушка (реальный fetch не нужен, useSWR замокан).
 */

import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatboxMemorySummaryApi } from '@/api/chatbox.api';
import { mapMemorySummary } from '@/domain/chatbox';
import { ChatboxMemorySummaryCard } from './ChatboxMemorySummaryCard';

vi.mock('@/api/chatbox.api', () => ({
  chatboxApi: { memorySummary: vi.fn() },
}));

// useSWR мокаем — управляем data/error/isLoading из теста напрямую.
// Имя без префикса `use`, чтобы линтер не принял мок за React-хук.
const swrImpl = vi.fn();
vi.mock('swr', () => ({
  __esModule: true,
  default: (...args: unknown[]) => swrImpl(...args),
}));

afterEach(() => {
  vi.clearAllMocks();
});

const API: ChatboxMemorySummaryApi = {
  configured: true,
  analysisEnabled: true,
  dialogs: 128,
  sessions: 140,
  analyzed: 96,
  inProgress: 12,
  failed: 3,
  blocks: 57,
  tasks: 21,
};

describe('mapMemorySummary', () => {
  it('ApiDto → DomainModel: pass-through + производные', () => {
    const view = mapMemorySummary(API);
    expect(view.configured).toBe(true);
    expect(view.analysisEnabled).toBe(true);
    expect(view.dialogs).toBe(128);
    expect(view.sessions).toBe(140);
    expect(view.analyzed).toBe(96);
    expect(view.inProgress).toBe(12);
    // pending — псевдоним inProgress.
    expect(view.pending).toBe(12);
    expect(view.failed).toBe(3);
    expect(view.blocks).toBe(57);
    expect(view.tasks).toBe(21);
    // hasData = есть хоть один диалог или сессия.
    expect(view.hasData).toBe(true);
  });

  it('hasData=false когда нет ни диалогов, ни сессий', () => {
    const view = mapMemorySummary({
      ...API,
      dialogs: 0,
      sessions: 0,
    });
    expect(view.hasData).toBe(false);
  });
});

describe('ChatboxMemorySummaryCard', () => {
  it('рендерит числа счётчиков; «Карточки памяти»/«Задачи» — ссылки', () => {
    swrImpl.mockReturnValue({
      data: mapMemorySummary(API),
      error: undefined,
      isLoading: false,
    });
    render(<ChatboxMemorySummaryCard />);

    expect(screen.getByText('Чаты в памяти')).toBeInTheDocument();
    // Подписи счётчиков.
    expect(screen.getByText('Забрано диалогов')).toBeInTheDocument();
    expect(screen.getByText('Проанализировано')).toBeInTheDocument();
    expect(screen.getByText('В работе')).toBeInTheDocument();
    expect(screen.getByText('Ошибки')).toBeInTheDocument();
    expect(screen.getByText('Карточки памяти')).toBeInTheDocument();
    expect(screen.getByText('Задачи')).toBeInTheDocument();
    // Числа (ru-RU форматирование без разделителей для 3-значных).
    expect(screen.getByText('128')).toBeInTheDocument();
    expect(screen.getByText('96')).toBeInTheDocument();
    expect(screen.getByText('57')).toBeInTheDocument();
    expect(screen.getByText('21')).toBeInTheDocument();

    // «Карточки памяти» и «Задачи» ведут на разделы.
    const cardsLink = screen.getByText('Карточки памяти').closest('a');
    expect(cardsLink).toHaveAttribute('href', '/cards');
    const tasksLink = screen.getByText('Задачи').closest('a');
    expect(tasksLink).toHaveAttribute('href', '/tasks');
  });

  it('analysisEnabled=false + есть диалоги → плашка «анализ выключен»', () => {
    swrImpl.mockReturnValue({
      data: mapMemorySummary({ ...API, analysisEnabled: false }),
      error: undefined,
      isLoading: false,
    });
    render(<ChatboxMemorySummaryCard />);
    expect(
      screen.getByText(/Анализ переписки выключен/),
    ).toBeInTheDocument();
  });

  it('analysisEnabled=true → плашки предупреждения нет', () => {
    swrImpl.mockReturnValue({
      data: mapMemorySummary(API),
      error: undefined,
      isLoading: false,
    });
    render(<ChatboxMemorySummaryCard />);
    expect(
      screen.queryByText(/Анализ переписки выключен/),
    ).not.toBeInTheDocument();
  });

  it('configured=false → карточка не рендерится', () => {
    swrImpl.mockReturnValue({
      data: mapMemorySummary({ ...API, configured: false }),
      error: undefined,
      isLoading: false,
    });
    const { container } = render(<ChatboxMemorySummaryCard />);
    expect(container.firstChild).toBeNull();
  });

  it('загрузка → заголовок виден, чисел нет', () => {
    swrImpl.mockReturnValue({
      data: undefined,
      error: undefined,
      isLoading: true,
    });
    render(<ChatboxMemorySummaryCard />);
    expect(screen.getByText('Чаты в памяти')).toBeInTheDocument();
    expect(screen.queryByText('Забрано диалогов')).not.toBeInTheDocument();
  });
});
