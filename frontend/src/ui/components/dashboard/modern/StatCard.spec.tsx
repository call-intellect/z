/**
 * Render-тесты `StatCard` (Ф0 редизайна дашбордов).
 *
 * Проверяем поведение опциональных пропсов:
 *   1. без spark/delta/up/href — карточка рендерится, нет спарклайна (recharts
 *      ResponsiveContainer/AreaChart не монтируется), нет дельта-плашки;
 *   2. со spark+delta+up — присутствуют и спарклайн, и дельта;
 *   3. с href — карточка обёрнута в <a href="/x"> (role="link").
 *
 * jsdom не реализует ResizeObserver — recharts ResponsiveContainer его требует,
 * поэтому подкладываем минимальную заглушку до рендера.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';

import { StatCard } from './StatCard';
import { CHART, GRAD } from './tokens';

beforeAll(() => {
  const g = globalThis as unknown as { ResizeObserver?: unknown };
  if (typeof g.ResizeObserver === 'undefined') {
    g.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

describe('StatCard', () => {
  it('без spark/delta/up/href — рендерится, без спарклайна и без дельта-плашки', () => {
    const { container } = render(
      <StatCard
        icon={<span data-testid="ic" />}
        grad={GRAD.violet}
        label="X"
        value="1"
        tone={CHART.violet}
      />,
    );
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('X')).toBeInTheDocument();
    // Спарклайн-блок (recharts) отсутствует.
    expect(container.querySelector('.recharts-responsive-container')).toBeNull();
    expect(container.querySelector('.h-8.w-20')).toBeNull();
    // Дельта-плашки нет → нет иконок-стрелок (lucide рендерит <svg>).
    expect(container.querySelector('svg.lucide')).toBeNull();
  });

  it('со spark и delta+up — спарклайн и дельта присутствуют', () => {
    const { container } = render(
      <StatCard
        icon={<span />}
        grad={GRAD.teal}
        label="Y"
        value="42"
        tone={CHART.teal}
        spark={[
          { i: 0, v: 1 },
          { i: 1, v: 2 },
        ]}
        delta="+5"
        up
      />,
    );
    expect(screen.getByText('+5')).toBeInTheDocument();
    expect(container.querySelector('.h-8.w-20')).not.toBeNull();
    expect(container.querySelector('.recharts-responsive-container')).not.toBeNull();
  });

  it('с href — карточка обёрнута в ссылку <a href="/x">', () => {
    render(
      <StatCard
        icon={<span />}
        grad={GRAD.blue}
        label="Z"
        value="7"
        tone={CHART.blue}
        href="/x"
      />,
    );
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/x');
    expect(link).toHaveTextContent('7');
  });
});
