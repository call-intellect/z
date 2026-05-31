/**
 * Unit-тесты `InvoiceRowActions` (ТЗ admin-subscription-ui-v2 Фаза 2).
 *
 * Кейсы:
 *   1. Рендер per status: для `paid`/`bonus`/`void` обе кнопки не показываются;
 *      для `issued` — обе; для `draft` — только `void`.
 *   2. Mark-paid: успешный путь — API вызывается с trim'ом externalRef + reason,
 *      onChanged срабатывает.
 *   3. Void для paid: компонент вообще не рендерит кнопки (UI-страховка перед
 *      бэкенд-403).
 *   4. Mark-paid: невозможно submit'ить без externalRef и с reason <3.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { InvoiceDomain } from '@/domain/billing';

import { InvoiceRowActions } from './InvoiceRowActions';

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const adminMarkInvoicePaid = vi.fn();
const adminVoidInvoice = vi.fn();
vi.mock('@/api/billing.api', () => ({
  billingApi: {
    adminMarkInvoicePaid: (...args: unknown[]) =>
      adminMarkInvoicePaid(...args),
    adminVoidInvoice: (...args: unknown[]) => adminVoidInvoice(...args),
  },
}));

function makeInvoice(status: InvoiceDomain['status']): InvoiceDomain {
  return {
    id: 'inv-1',
    invoiceNumber: 'INV-2026-0001',
    status,
    paymentMethod: null,
    totalKopecks: 6_000_000,
    periodStart: new Date('2026-05-01T00:00:00Z'),
    periodEnd: new Date('2026-05-31T23:59:59Z'),
    paidAt: null,
    voidedAt: null,
    createdAt: new Date('2026-05-29T10:00:00Z'),
    pdfUrl: null,
  };
}

describe('InvoiceRowActions', () => {
  beforeEach(() => {
    adminMarkInvoicePaid.mockReset();
    adminVoidInvoice.mockReset();
  });

  it('для paid инвойса не показывает ни одной кнопки', () => {
    const onChanged = vi.fn();
    const { container } = render(
      <InvoiceRowActions invoice={makeInvoice('paid')} onChanged={onChanged} />,
    );
    // Компонент возвращает null → пустой контейнер.
    expect(container).toBeEmptyDOMElement();
  });

  it('для issued показывает обе кнопки (mark-paid + void)', () => {
    render(
      <InvoiceRowActions
        invoice={makeInvoice('issued')}
        onChanged={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Пометить как оплачен' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Аннулировать счёт' }),
    ).toBeInTheDocument();
  });

  it('для draft показывает только void (mark-paid скрыт)', () => {
    render(
      <InvoiceRowActions invoice={makeInvoice('draft')} onChanged={vi.fn()} />,
    );
    expect(
      screen.queryByRole('button', { name: 'Пометить как оплачен' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Аннулировать счёт' }),
    ).toBeInTheDocument();
  });

  it('mark-paid: успешный submit с externalRef и reason → API + onChanged', async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    adminMarkInvoicePaid.mockResolvedValue({ id: 'inv-1', status: 'paid' });

    render(
      <InvoiceRowActions
        invoice={makeInvoice('issued')}
        onChanged={onChanged}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Пометить как оплачен' }),
    );

    // В диалоге появились поля; submit-кнопка имеет точный текст.
    const externalRef = await screen.findByLabelText(/Номер платёжки/i);
    const reason = screen.getByLabelText(/Причина/i);
    await user.type(externalRef, '  payment_001  ');
    await user.type(reason, '  оплачено  ');

    await user.click(
      screen.getByRole('button', { name: 'Пометить оплаченным' }),
    );

    expect(adminMarkInvoicePaid).toHaveBeenCalledWith('inv-1', {
      externalRef: 'payment_001',
      reason: 'оплачено',
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('mark-paid: submit заблокирован пока externalRef пустой или reason <3', async () => {
    const user = userEvent.setup();
    render(
      <InvoiceRowActions
        invoice={makeInvoice('issued')}
        onChanged={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Пометить как оплачен' }),
    );

    const submit = await screen.findByRole('button', {
      name: 'Пометить оплаченным',
    });
    // Изначально оба поля пустые → submit disabled.
    expect(submit).toBeDisabled();

    // Заполняем только reason — externalRef всё ещё пустой → disabled.
    const reason = screen.getByLabelText(/Причина/i);
    await user.type(reason, 'ok');
    expect(submit).toBeDisabled();

    // Добавляем externalRef, но reason всё ещё <3 (всего "ok" = 2) → disabled.
    const externalRef = screen.getByLabelText(/Номер платёжки/i);
    await user.type(externalRef, 'p_1');
    expect(submit).toBeDisabled();

    // Дополняем reason до ≥3 → enabled.
    await user.type(reason, '!');
    expect(submit).toBeEnabled();
  });
});
