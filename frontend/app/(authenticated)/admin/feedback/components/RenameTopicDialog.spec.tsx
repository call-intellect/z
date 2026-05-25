/**
 * Фаза 8 — компонентный smoke-тест RenameTopicDialog.
 *
 * Что проверяется:
 *  (1) Рендерится с pre-fill текущими значениями (title/description).
 *  (2) Клик «Сохранить» вызывает adminFeedbackApi.renameTopic + toast.success +
 *      onSaved + закрытие диалога.
 *  (3) Ошибка API → toast.error, диалог остаётся открыт.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/api/admin-feedback.api', () => ({
  adminFeedbackApi: {
    renameTopic: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { adminFeedbackApi } from '@/api/admin-feedback.api';
import { toast } from 'sonner';

import { RenameTopicDialog } from './RenameTopicDialog';

const renameMock = () =>
  adminFeedbackApi.renameTopic as unknown as ReturnType<typeof vi.fn>;

function renderDialog(overrides?: Partial<Parameters<typeof RenameTopicDialog>[0]>) {
  const onOpenChange = vi.fn();
  const onSaved = vi.fn();
  render(
    <RenameTopicDialog
      open
      onOpenChange={onOpenChange}
      topicId="ftp_1"
      initialTitle="Старое название"
      initialDescription="Старое описание"
      onSaved={onSaved}
      {...overrides}
    />,
  );
  return { onOpenChange, onSaved };
}

describe('RenameTopicDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('рендерится с pre-fill текущими значениями', () => {
    renderDialog();
    const titleInput = screen.getByLabelText('Название') as HTMLInputElement;
    const descTextarea = screen.getByLabelText('Описание') as HTMLTextAreaElement;
    expect(titleInput.value).toBe('Старое название');
    expect(descTextarea.value).toBe('Старое описание');
  });

  it('успешный сабмит вызывает API + toast + onSaved + закрытие', async () => {
    renameMock().mockResolvedValue({});
    const { onOpenChange, onSaved } = renderDialog();

    const titleInput = screen.getByLabelText('Название') as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'Новое название' } });

    fireEvent.click(screen.getByRole('button', { name: /сохранить/i }));

    await vi.waitFor(() => {
      expect(renameMock()).toHaveBeenCalledWith('ftp_1', {
        title: 'Новое название',
        description: 'Старое описание',
      });
    });
    await vi.waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Готово');
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('ошибка API → toast.error, диалог не закрывается', async () => {
    renameMock().mockRejectedValue(new Error('boom'));
    const { onOpenChange, onSaved } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: /сохранить/i }));

    await vi.waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
    expect(onSaved).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
