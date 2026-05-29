/**
 * Unit-тесты `AdjustSeatsDialog` (ТЗ admin-subscription-ui-v2 Фаза 3).
 *
 * Кейсы:
 *   1. Submit disabled пока нет валидного reason ≥3.
 *   2. Submit disabled когда newSeatsExtra === currentSeatsExtra (нет изменений).
 *   3. Успешный путь: при monthly + daysLeft → API получает
 *      daysLeftInMonthlyPeriod, reason trim'ится.
 *   4. Ошибка API → toast.error, onSuccess не вызывается.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ApiError } from '@/api/api-error';

import { AdjustSeatsDialog } from './AdjustSeatsDialog';

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const adminAdjustSeats = vi.fn();
vi.mock('@/api/billing.api', () => ({
  billingApi: {
    adminAdjustSeats: (...args: unknown[]) => adminAdjustSeats(...args),
  },
}));

function setup(overrides?: Partial<Parameters<typeof AdjustSeatsDialog>[0]>) {
  const onOpenChange = vi.fn();
  const onSuccess = vi.fn();
  const utils = render(
    <AdjustSeatsDialog
      open={true}
      onOpenChange={onOpenChange}
      tenantId="org-1"
      currentSeatsExtra={5}
      billingPeriod="monthly"
      daysLeftInMonthlyPeriod={10}
      onSuccess={onSuccess}
      {...overrides}
    />,
  );
  return { onOpenChange, onSuccess, ...utils };
}

describe('AdjustSeatsDialog', () => {
  beforeEach(() => {
    adminAdjustSeats.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it('submit disabled пока reason <3', async () => {
    const user = userEvent.setup();
    setup();
    const submit = screen.getByRole('button', { name: 'Изменить места' });

    // Поле seats другое (5 → 10), reason пустой.
    const seats = screen.getByLabelText(/Новое количество доп\. мест/i);
    await user.clear(seats);
    await user.type(seats, '10');
    expect(submit).toBeDisabled();

    const reason = screen.getByLabelText(/Причина/i);
    await user.type(reason, 'ok');
    expect(submit).toBeDisabled();

    await user.type(reason, '!');
    expect(submit).toBeEnabled();
  });

  it('submit disabled при noChange (seatsExtra === current)', async () => {
    const user = userEvent.setup();
    setup({ currentSeatsExtra: 5 });
    const reason = screen.getByLabelText(/Причина/i);
    await user.type(reason, 'обоснование');
    // seats осталось =5, изменений нет.
    expect(
      screen.getByRole('button', { name: 'Изменить места' }),
    ).toBeDisabled();
  });

  it('успешный submit: monthly + daysLeft → API получает корректное body', async () => {
    const user = userEvent.setup();
    adminAdjustSeats.mockResolvedValue({
      subscriptionId: 'sub-1',
      invoiceId: 'inv-1',
      grantedMeetings: 0,
    });
    const { onSuccess } = setup({ currentSeatsExtra: 5 });

    const seats = screen.getByLabelText(/Новое количество доп\. мест/i);
    await user.clear(seats);
    await user.type(seats, '12');
    const reason = screen.getByLabelText(/Причина/i);
    await user.type(reason, '  вырастили команду  ');
    await user.click(screen.getByRole('button', { name: 'Изменить места' }));

    expect(adminAdjustSeats).toHaveBeenCalledWith('org-1', {
      newSeatsExtra: 12,
      reason: 'вырастили команду',
      daysLeftInMonthlyPeriod: 10,
    });
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('yearly: API получает monthsLeftInYearlyPeriod вместо days', async () => {
    const user = userEvent.setup();
    adminAdjustSeats.mockResolvedValue({
      subscriptionId: 'sub-1',
      invoiceId: 'inv-1',
      grantedMeetings: 0,
    });
    setup({
      billingPeriod: 'yearly',
      daysLeftInMonthlyPeriod: undefined,
      monthsLeftInYearlyPeriod: 4,
    });

    const seats = screen.getByLabelText(/Новое количество доп\. мест/i);
    await user.clear(seats);
    await user.type(seats, '8');
    await user.type(screen.getByLabelText(/Причина/i), 'рост');
    await user.click(screen.getByRole('button', { name: 'Изменить места' }));

    expect(adminAdjustSeats).toHaveBeenCalledWith('org-1', {
      newSeatsExtra: 8,
      reason: 'рост',
      monthsLeftInYearlyPeriod: 4,
    });
  });

  it('ошибка API → toast.error, onSuccess не вызывается', async () => {
    const user = userEvent.setup();
    adminAdjustSeats.mockRejectedValue(
      new ApiError({ code: 'conflict', message: 'Conflict' }),
    );
    const { onSuccess } = setup();

    const seats = screen.getByLabelText(/Новое количество доп\. мест/i);
    await user.clear(seats);
    await user.type(seats, '7');
    await user.type(screen.getByLabelText(/Причина/i), 'тест');
    await user.click(screen.getByRole('button', { name: 'Изменить места' }));

    expect(toastError).toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
