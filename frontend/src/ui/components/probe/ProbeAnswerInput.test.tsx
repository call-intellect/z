/**
 * Тесты `ProbeAnswerInput` — поле свободного ответа на уточняющий вопрос.
 *
 * Сценарии (Phase 0.3 ТЗ Agents v2 umbrella, §«Probe без кнопок»):
 *  1. Рендер вопроса + textarea + кнопок «Текст»/«Голос». Пустая отправка disabled.
 *  2. Ввод текста → onSubmit вызван с правильным answer (trim).
 *  3. voiceEnabled=false → переключатель «Голос» отсутствует.
 *  4. isSubmitting=true → кнопка «Отправить» disabled, спиннер виден.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// Моки выносим вверх — vitest hoist'ит vi.mock.
vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ currentOrgId: 'org-test', isLoading: false }),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('@/api/probe-voice.api', () => ({
  transcribeProbeAnswer: vi.fn(),
}));

import { ProbeAnswerInput } from './ProbeAnswerInput';

describe('ProbeAnswerInput', () => {
  it('1. рендерит вопрос, textarea и переключатели; пустая отправка disabled', () => {
    render(
      <ProbeAnswerInput question="Кто отвечает за релиз?" onSubmit={vi.fn()} />,
    );

    expect(screen.getByText('Кто отвечает за релиз?')).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('Ответьте своими словами…'),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Текст/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Голос/ })).toBeInTheDocument();

    const submit = screen.getByRole('button', { name: /Отправить/ });
    expect(submit).toBeDisabled();
  });

  it('2. ввод текста и клик «Отправить» вызывает onSubmit с trim-значением', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <ProbeAnswerInput question="Какой статус OKR?" onSubmit={onSubmit} />,
    );

    const textarea = screen.getByPlaceholderText('Ответьте своими словами…');
    fireEvent.change(textarea, { target: { value: '  Зелёный, идём по плану  ' } });

    const submit = screen.getByRole('button', { name: /Отправить/ });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);

    // onSubmit зовётся синхронно из обработчика — Promise разрешается на следующем tick.
    await Promise.resolve();
    expect(onSubmit).toHaveBeenCalledWith('Зелёный, идём по плану');
  });

  it('3. voiceEnabled=false → переключатели режима не рендерятся', () => {
    render(
      <ProbeAnswerInput
        question="Тестовый вопрос?"
        onSubmit={vi.fn()}
        voiceEnabled={false}
      />,
    );

    expect(screen.queryByRole('tab', { name: /Текст/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /Голос/ })).not.toBeInTheDocument();
    // Textarea всё равно есть (текстовый ввод — основной).
    expect(
      screen.getByPlaceholderText('Ответьте своими словами…'),
    ).toBeInTheDocument();
  });

  it('4. isSubmitting=true → кнопка «Отправить» disabled со спиннером', () => {
    render(
      <ProbeAnswerInput
        question="Тестовый вопрос?"
        onSubmit={vi.fn()}
        isSubmitting
      />,
    );

    // Заполним textarea, чтобы trim был не пустой — изоляция причины disabled.
    const textarea = screen.getByPlaceholderText('Ответьте своими словами…');
    fireEvent.change(textarea, { target: { value: 'есть ответ' } });

    const submit = screen.getByRole('button', { name: /Отправить/ });
    expect(submit).toBeDisabled();
    // Спиннер — это <Loader2> с классом animate-spin.
    expect(submit.querySelector('.animate-spin')).not.toBeNull();
  });
});
