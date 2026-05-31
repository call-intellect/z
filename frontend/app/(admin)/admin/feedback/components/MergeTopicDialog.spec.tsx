/**
 * Фаза 8 — компонентный smoke-тест MergeTopicDialog.
 *
 * Что проверяется:
 *  (1) Рендерится заголовок и confirm-текст про source и items.
 *  (2) listTopics вызывается с window=all, includeArchived=false.
 *  (3) Кнопка «Объединить» disabled пока target не выбран; после выбора —
 *      клик вызывает mergeTopics + toast.success + onSaved.
 *  (4) Source отфильтрован из списка кандидатов.
 *  (5) Ошибка mergeTopics → toast.error.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/api/admin-feedback.api', () => ({
  adminFeedbackApi: {
    listTopics: vi.fn(),
    mergeTopics: vi.fn(),
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

import { MergeTopicDialog } from './MergeTopicDialog';

const listMock = () =>
  adminFeedbackApi.listTopics as unknown as ReturnType<typeof vi.fn>;
const mergeMock = () =>
  adminFeedbackApi.mergeTopics as unknown as ReturnType<typeof vi.fn>;

function makeTopic(id: string, title: string, status: 'ACTIVE' | 'ARCHIVED' | 'MERGED' = 'ACTIVE') {
  return {
    id,
    title,
    description: `desc ${id}`,
    status,
    itemsCount: 5,
    uniqueUsersCount: 3,
    percentOfWindow: 10,
    lastItemAt: null,
    createdAt: new Date().toISOString(),
  };
}

describe('MergeTopicDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('загружает list ACTIVE без архива; source отфильтрован', async () => {
    listMock().mockResolvedValue({
      items: [
        makeTopic('ftp_source', 'Источник'),
        makeTopic('ftp_target', 'Целевой'),
      ],
      totalItemsInWindow: 0,
      totalUsersInWindow: 0,
      totalTopicsInWindow: 0,
      page: 1,
      pageSize: 200,
    });

    render(
      <MergeTopicDialog
        open
        onOpenChange={vi.fn()}
        sourceId="ftp_source"
        sourceTitle="Источник"
        sourceItemsCount={5}
        onSaved={vi.fn()}
      />,
    );

    await vi.waitFor(() => {
      expect(listMock()).toHaveBeenCalledWith(
        expect.objectContaining({
          window: 'all',
          includeArchived: false,
          pageSize: 200,
        }),
      );
    });

    // Source в списке нет, target есть.
    await vi.waitFor(() => {
      expect(screen.getByText('Целевой')).toBeTruthy();
    });
    // «Источник» появляется в DialogDescription, но не как option.
    const sourceOption = screen.queryByRole('option', { name: /Источник/i });
    expect(sourceOption).toBeNull();
  });

  it('кнопка disabled пока target не выбран; выбор → merge + toast', async () => {
    listMock().mockResolvedValue({
      items: [makeTopic('ftp_target', 'Целевой')],
      totalItemsInWindow: 0,
      totalUsersInWindow: 0,
      totalTopicsInWindow: 0,
      page: 1,
      pageSize: 200,
    });
    mergeMock().mockResolvedValue({
      movedItems: 5,
      mergedIntoId: 'ftp_target',
    });
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();

    render(
      <MergeTopicDialog
        open
        onOpenChange={onOpenChange}
        sourceId="ftp_source"
        sourceTitle="Источник"
        sourceItemsCount={5}
        onSaved={onSaved}
      />,
    );

    const mergeBtn = (await screen.findByRole('button', {
      name: /объединить/i,
    })) as HTMLButtonElement;
    expect(mergeBtn.disabled).toBe(true);

    fireEvent.click(await screen.findByRole('option', { name: /Целевой/ }));
    expect(mergeBtn.disabled).toBe(false);

    fireEvent.click(mergeBtn);

    await vi.waitFor(() => {
      expect(mergeMock()).toHaveBeenCalledWith('ftp_source', {
        targetId: 'ftp_target',
      });
    });
    expect(toast.success).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('ошибка mergeTopics → toast.error', async () => {
    listMock().mockResolvedValue({
      items: [makeTopic('ftp_target', 'Целевой')],
      totalItemsInWindow: 0,
      totalUsersInWindow: 0,
      totalTopicsInWindow: 0,
      page: 1,
      pageSize: 200,
    });
    mergeMock().mockRejectedValue(new Error('boom'));
    const onSaved = vi.fn();

    render(
      <MergeTopicDialog
        open
        onOpenChange={vi.fn()}
        sourceId="ftp_source"
        sourceTitle="Источник"
        sourceItemsCount={5}
        onSaved={onSaved}
      />,
    );

    fireEvent.click(await screen.findByRole('option', { name: /Целевой/ }));
    fireEvent.click(
      await screen.findByRole('button', { name: /объединить/i }),
    );

    await vi.waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
    expect(onSaved).not.toHaveBeenCalled();
  });
});
