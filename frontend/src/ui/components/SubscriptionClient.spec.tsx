/**
 * Тесты SubscriptionClient — страница подписки (Фаза 3 paywall).
 *
 * Проверяется:
 *  (1) DEMO hero: крупный заголовок + конфигуратор + CTA.
 *  (2) Toggle период: месяц/год переключаются.
 *  (3) Slider мест: значение отображается.
 *  (4) Расчёт цены: при seatsExtra > 0 отображается доп. места.
 *  (5) Обе кнопки оплаты вызывают API с правильными параметрами.
 *
 * ТЗ: plans/tz/2026-05-28-paywall-no-trial.md §5 (Фаза 3).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

// ── Моки ──

vi.mock('@/api/billing.api', () => ({
  billingApi: {
    getSubscription: vi.fn(),
    getMeetingsBalance: vi.fn(),
    getInvoices: vi.fn(),
    getQuote: vi.fn(),
    payCard: vi.fn(),
    payBankInvoice: vi.fn(),
  },
}));

vi.mock('@/ui/shadcn/slider', () => ({
  Slider: ({ value, onValueChange, ...props }: { value?: number[]; onValueChange?: (v: number[]) => void; [k: string]: unknown }) => (
    <input
      type="range"
      data-testid={props['data-testid']}
      value={value?.[0] ?? 31}
      min={31}
      max={100}
      onChange={(e) => onValueChange?.([Number(e.target.value)])}
    />
  ),
}));

import { billingApi } from '@/api/billing.api';
import { SubscriptionClient } from '@app/(authenticated)/settings/subscription/SubscriptionClient';

const mockedBillingApi = vi.mocked(billingApi);

function setupDemo() {
  mockedBillingApi.getSubscription.mockResolvedValue({
    status: 'DEMO',
    paymentMode: null,
    billingPeriod: null,
    startedAt: null,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    seatsBase: 31,
    seatsExtra: 0,
    monthlyPriceKopecks: 0,
    totalPaidKopecks: 0,
    autoRenew: false,
  });
  mockedBillingApi.getMeetingsBalance.mockResolvedValue({
    balance: 0,
    totalGranted: 0,
    totalConsumed: 0,
    lastGrantedAt: null,
  });
  mockedBillingApi.getInvoices.mockResolvedValue({ items: [], total: 0 });
  mockedBillingApi.getQuote.mockResolvedValue({
    billingPeriod: 'monthly',
    seatsExtra: 0,
    monthlyKopecks: 6_000_000,
    periodKopecks: 6_000_000,
    discountKopecks: 0,
    monthsInPeriod: 1,
    meetingsGrant: 150,
  });
}

function setupActive() {
  mockedBillingApi.getSubscription.mockResolvedValue({
    status: 'ACTIVE',
    paymentMode: 'paid',
    billingPeriod: 'monthly',
    startedAt: '2026-01-01T00:00:00Z',
    currentPeriodStart: '2026-05-01T00:00:00Z',
    currentPeriodEnd: '2026-06-01T00:00:00Z',
    seatsBase: 31,
    seatsExtra: 5,
    monthlyPriceKopecks: 6_500_000,
    totalPaidKopecks: 39_000_000,
    autoRenew: true,
  });
  mockedBillingApi.getMeetingsBalance.mockResolvedValue({
    balance: 120,
    totalGranted: 150,
    totalConsumed: 30,
    lastGrantedAt: '2026-05-01T00:00:00Z',
  });
  mockedBillingApi.getInvoices.mockResolvedValue({ items: [], total: 0 });
  mockedBillingApi.getQuote.mockResolvedValue({
    billingPeriod: 'monthly',
    seatsExtra: 0,
    monthlyKopecks: 6_000_000,
    periodKopecks: 6_000_000,
    discountKopecks: 0,
    monthsInPeriod: 1,
    meetingsGrant: 150,
  });
}

describe('SubscriptionClient — Фаза 3', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('DEMO hero: крупный заголовок + конфигуратор', async () => {
    setupDemo();
    render(<SubscriptionClient />);

    await vi.waitFor(() => {
      expect(screen.getByTestId('demo-hero')).toBeInTheDocument();
    });

    expect(screen.getByText('Оплатите подписку, чтобы начать работу')).toBeInTheDocument();
    expect(screen.getByTestId('pricing-configurator')).toBeInTheDocument();
    expect(screen.getByTestId('pay-card-btn')).toBeInTheDocument();
    expect(screen.getByTestId('pay-bank-btn')).toBeInTheDocument();
  });

  it('Toggle период: месяц → год переключаются', async () => {
    setupDemo();
    render(<SubscriptionClient />);

    await vi.waitFor(() => {
      expect(screen.getByTestId('demo-hero')).toBeInTheDocument();
    });

    const toggle = screen.getByTestId('period-toggle');
    const yearBtn = screen.getByText('Год');

    // По умолчанию — месяц активен.
    const monthBtn = toggle.querySelector('button:first-child');
    expect(monthBtn).toHaveClass('bg-accent');

    // Клик на «Год».
    fireEvent.click(yearBtn.closest('button')!);

    await vi.waitFor(() => {
      const yearlyBtn = toggle.querySelector('button:last-child');
      expect(yearlyBtn).toHaveClass('bg-accent');
    });
  });

  it('Slider мест: отображает текущее значение', async () => {
    setupDemo();
    render(<SubscriptionClient />);

    await vi.waitFor(() => {
      expect(screen.getByTestId('demo-hero')).toBeInTheDocument();
    });

    const seatsCount = screen.getByTestId('seats-count');
    expect(seatsCount).toHaveTextContent('31');
  });

  it('Расчёт цены: вызов getQuote с seatsExtra > 0', async () => {
    setupDemo();
    render(<SubscriptionClient />);

    await vi.waitFor(() => {
      expect(screen.getByTestId('demo-hero')).toBeInTheDocument();
    });

    // Двигаем slider на 40 (seatsExtra = 9).
    const slider = screen.getByTestId('seats-slider') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '40' } });

    await vi.waitFor(() => {
      expect(mockedBillingApi.getQuote).toHaveBeenCalledWith('monthly', 9);
    }, { timeout: 2000 });
  });

  it('ACTIVE: показывает карточку подписки + продление', async () => {
    setupActive();
    render(<SubscriptionClient />);

    await vi.waitFor(() => {
      expect(screen.getByText('Текущая подписка')).toBeInTheDocument();
    });

    expect(screen.getByText('Активна')).toBeInTheDocument();
    expect(screen.getByText('31 основ. + 5 доп.')).toBeInTheDocument();
  });

  it('Кнопка «Оплатить картой» вызывает payCard с периодом и местами', async () => {
    setupDemo();
    mockedBillingApi.payCard.mockResolvedValue({
      invoiceId: 'inv_1',
      invoiceNumber: 'INV-001',
      totalKopecks: 6_000_000,
      paymentUrl: 'https://pay.example.com/123',
      providerInvoiceId: 'ext_123',
    });

    // Мокаем window.location.href.
    const locationSpy = vi.spyOn(window, 'location', 'get');
    locationSpy.mockReturnValue({ ...window.location, href: '' } as Location);

    render(<SubscriptionClient />);

    await vi.waitFor(() => {
      expect(screen.getByTestId('pay-card-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('pay-card-btn'));

    await vi.waitFor(() => {
      expect(mockedBillingApi.payCard).toHaveBeenCalledWith({
        billingPeriod: 'monthly',
        seatsExtra: 0,
        autoRenew: true,
      });
    });

    locationSpy.mockRestore();
  });

  it('Кнопка «Безналичный расчёт» вызывает payBankInvoice', async () => {
    setupDemo();
    mockedBillingApi.payBankInvoice.mockResolvedValue({
      invoiceId: 'inv_2',
      invoiceNumber: 'INV-002',
      totalKopecks: 6_000_000,
      paymentUrl: null,
      providerInvoiceId: null,
    });

    render(<SubscriptionClient />);

    await vi.waitFor(() => {
      expect(screen.getByTestId('pay-bank-btn')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('pay-bank-btn'));

    await vi.waitFor(() => {
      expect(mockedBillingApi.payBankInvoice).toHaveBeenCalledWith({
        billingPeriod: 'monthly',
        seatsExtra: 0,
        sendToEmail: true,
      });
    });
  });
});
