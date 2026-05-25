/**
 * Фаза 5 «clone reliability hardening» — компонентный тест RebuildCloneButton.
 *
 * Что проверяется:
 *  (1) Клик → вызывается clonesApi.triggerManualPersonaSnapshot с правильными
 *      аргументами + toast.success + onRebuildScheduled.
 *  (2) После успешного клика кнопка disabled (cooldown 60с).
 *  (3) Ошибка API → toast.error, кнопка не уходит в cooldown.
 *
 * Моки:
 *  - `@/api/clones.api` — `triggerManualPersonaSnapshot` мокаем.
 *  - `sonner` — `toast.success`/`toast.error` мокаем.
 *
 * E2E через playwright не делаем — фронт не имеет e2e-инфры (см. ТЗ Фаза 5.6).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { RebuildCloneButton } from './RebuildCloneButton';

vi.mock('@/api/clones.api', () => ({
  clonesApi: {
    triggerManualPersonaSnapshot: vi.fn(),
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { clonesApi } from '@/api/clones.api';
import { toast } from 'sonner';

describe('RebuildCloneButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('клик вызывает API + toast.success + onRebuildScheduled', async () => {
    const triggerMock = clonesApi.triggerManualPersonaSnapshot as unknown as ReturnType<
      typeof vi.fn
    >;
    triggerMock.mockResolvedValue({
      built: true,
      personaId: 'p1',
      reason: null,
    });
    const onRebuild = vi.fn();

    render(
      <RebuildCloneButton
        orgId="org_1"
        personId="person_1"
        onRebuildScheduled={onRebuild}
      />,
    );

    const button = screen.getByTestId('rebuild-clone-button');
    fireEvent.click(button);

    // Дожидаемся завершения promise.
    await vi.waitFor(() => {
      expect(triggerMock).toHaveBeenCalledWith('org_1', 'person_1');
    });
    await vi.waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        'Клон обновляется. Это займёт около минуты.',
      );
    });
    expect(onRebuild).toHaveBeenCalledTimes(1);
  });

  it('после успешного клика кнопка disabled (cooldown)', async () => {
    const triggerMock = clonesApi.triggerManualPersonaSnapshot as unknown as ReturnType<
      typeof vi.fn
    >;
    triggerMock.mockResolvedValue({
      built: true,
      personaId: 'p1',
      reason: null,
    });

    render(<RebuildCloneButton orgId="org_1" personId="person_1" />);
    const button = screen.getByTestId('rebuild-clone-button');
    fireEvent.click(button);

    await vi.waitFor(() => {
      const btn = screen.getByTestId('rebuild-clone-button') as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });
    // Кнопка должна остаться disabled через какой-то промежуток (cooldown 60с,
    // мы проверяем что disabled не снимается мгновенно).
    await new Promise((resolve) => setTimeout(resolve, 50));
    const btn = screen.getByTestId('rebuild-clone-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('ошибка API → toast.error, без cooldown', async () => {
    const triggerMock = clonesApi.triggerManualPersonaSnapshot as unknown as ReturnType<
      typeof vi.fn
    >;
    triggerMock.mockRejectedValue(new Error('boom'));

    render(<RebuildCloneButton orgId="org_1" personId="person_1" />);
    const button = screen.getByTestId('rebuild-clone-button');
    fireEvent.click(button);

    await vi.waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
    // После ошибки кнопка должна снова быть enabled (cooldown не запустился).
    await vi.waitFor(() => {
      const btn = screen.getByTestId('rebuild-clone-button') as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
  });

  it('disabled prop → клик не запускает API', () => {
    const triggerMock = clonesApi.triggerManualPersonaSnapshot as unknown as ReturnType<
      typeof vi.fn
    >;
    render(
      <RebuildCloneButton orgId="org_1" personId="person_1" disabled />,
    );
    const button = screen.getByTestId('rebuild-clone-button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(triggerMock).not.toHaveBeenCalled();
  });
});
