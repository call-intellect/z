/**
 * Тесты PaywallBanner — sticky-плашка демо-режима.
 *
 * Проверяется:
 *  (1) Рендерится при status=DEMO.
 *  (2) Скрывается при status=ACTIVE.
 *  (3) Скрывается при status=null.
 *  (4) Скрывается при loading=true.
 *  (5) Кнопка «Оплатить» ведёт на /settings/subscription.
 *
 * ТЗ: plans/tz/2026-05-28-paywall-no-trial.md §4.1.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ children, ...props }: Record<string, unknown>) => (
    <a {...props}>{children as string}</a>
  ),
}));

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: vi.fn(),
}));

import { PaywallBanner } from './PaywallBanner';
import { useSubscription } from '@/hooks/useSubscription';

const mockUseSubscription = vi.mocked(useSubscription);

function setMock(opts: { status: string | null; loading?: boolean }) {
  mockUseSubscription.mockReturnValue({
    status: opts.status as never,
    loading: opts.loading ?? false,
    refetch: vi.fn(),
    showPaywallModal: vi.fn(),
    hidePaywallModal: vi.fn(),
    isPaywallModalOpen: false,
  });
}

describe('PaywallBanner', () => {
  it('показывается при status=DEMO', () => {
    setMock({ status: 'DEMO' });
    render(<PaywallBanner />);
    expect(screen.getByTestId('paywall-banner')).toBeInTheDocument();
  });

  it('скрывается при status=ACTIVE', () => {
    setMock({ status: 'ACTIVE' });
    render(<PaywallBanner />);
    expect(screen.queryByTestId('paywall-banner')).not.toBeInTheDocument();
  });

  it('скрывается при status=null', () => {
    setMock({ status: null });
    render(<PaywallBanner />);
    expect(screen.queryByTestId('paywall-banner')).not.toBeInTheDocument();
  });

  it('скрывается при loading=true', () => {
    setMock({ status: null, loading: true });
    render(<PaywallBanner />);
    expect(screen.queryByTestId('paywall-banner')).not.toBeInTheDocument();
  });

  it('кнопка «Оплатить» ведёт на /settings/subscription', () => {
    setMock({ status: 'DEMO' });
    render(<PaywallBanner />);
    const link = screen.getByText('Оплатить 60 000 ₽/мес');
    expect(link.closest('a')).toHaveAttribute('href', '/settings/subscription');
  });
});
