'use client';

/**
 * TourTooltip — позиционированный поповер поверх target-элемента.
 *
 * Позиционирование:
 *   - Desktop: вычисляем координаты через `getBoundingClientRect()` target'а,
 *     рендерим абсолютно с правильным placement (top/bottom/left/right) и
 *     отступом 12px.
 *   - Mobile (<= md / 768px): full-width bottom-sheet, target не подсвечивается.
 *     Это ТЗ §"Mobile" — позиционированный tooltip может вылезти за экран.
 *   - Если target не найден или placement='center' — центр экрана (fallback).
 *
 * Доступность:
 *   - `role="dialog"` + `aria-modal="true"`.
 *   - `aria-live="polite"` на body (читалка озвучит смену шага).
 *   - `aria-label="Тур: шаг N из M"` на корне.
 *   - Кнопки получают браузерный Tab-фокус.
 *   - ESC обрабатывается в TourOverlay (window-level listener).
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Button } from '@/ui/shadcn/button';

import type { TourStep, TourStepAction } from './types';

const MOBILE_BREAKPOINT = 768; // tailwind md

interface Position {
  top: number;
  left: number;
  width?: number;
  /** Стрелочки нет — placement определяет лишь геометрию popover'а. */
  origin: 'top' | 'bottom' | 'left' | 'right' | 'center';
}

interface Props {
  step: TourStep;
  stepIndex: number;
  totalSteps: number;
  onActionClick: (action: TourStepAction) => void;
}

function computePosition(
  step: TourStep,
  tooltipSize: { width: number; height: number },
): Position {
  if (step.placement === 'center') {
    return placeCenter();
  }
  const el =
    typeof document === 'undefined'
      ? null
      : document.querySelector<HTMLElement>(step.target);
  if (!el) {
    return placeCenter();
  }
  const rect = el.getBoundingClientRect();
  const gap = 12;
  const { width, height } = tooltipSize;
  let top = 0;
  let left = 0;
  switch (step.placement) {
    case 'top':
      top = rect.top - height - gap;
      left = rect.left + rect.width / 2 - width / 2;
      break;
    case 'bottom':
      top = rect.bottom + gap;
      left = rect.left + rect.width / 2 - width / 2;
      break;
    case 'left':
      top = rect.top + rect.height / 2 - height / 2;
      left = rect.left - width - gap;
      break;
    case 'right':
      top = rect.top + rect.height / 2 - height / 2;
      left = rect.right + gap;
      break;
  }
  // Кламп — не даём вылезть за viewport (с 8px зазором).
  const margin = 8;
  if (typeof window !== 'undefined') {
    top = Math.max(margin, Math.min(top, window.innerHeight - height - margin));
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
  }
  return { top, left, origin: step.placement };
}

function placeCenter(): Position {
  if (typeof window === 'undefined') {
    return { top: 0, left: 0, origin: 'center' };
  }
  return {
    top: window.innerHeight / 2 - 100,
    left: window.innerWidth / 2 - 180,
    origin: 'center',
  };
}

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return isMobile;
}

export function TourTooltip({
  step,
  stepIndex,
  totalSteps,
  onActionClick,
}: Props) {
  const isMobile = useIsMobile();
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<Position>({ top: 0, left: 0, origin: 'center' });

  // Считаем позицию после рендера, когда знаем реальный размер tooltip'а.
  useLayoutEffect(() => {
    if (isMobile) return;
    const el = tooltipRef.current;
    if (!el) return;
    const size = { width: el.offsetWidth, height: el.offsetHeight };
    const next = computePosition(step, size);
    setPos(next);
    // Пересчёт на скролл/resize — внутри отдельного useEffect ниже.
  }, [step, isMobile]);

  useEffect(() => {
    if (isMobile) return;
    const handler = () => {
      const el = tooltipRef.current;
      if (!el) return;
      const size = { width: el.offsetWidth, height: el.offsetHeight };
      setPos(computePosition(step, size));
    };
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
    };
  }, [step, isMobile]);

  // Подсветка target — добавляем outline ring через outline-style. На mobile
  // не подсвечиваем (target скрыт за bottom-sheet'ом и не нужен).
  useEffect(() => {
    if (isMobile) return;
    const el = document.querySelector<HTMLElement>(step.target);
    if (!el) return;
    const prev = el.style.outline;
    const prevOffset = el.style.outlineOffset;
    const prevZ = el.style.zIndex;
    const prevPos = el.style.position;
    el.style.outline = '2px solid rgb(var(--accent-rgb, 16 185 129))';
    el.style.outlineOffset = '4px';
    if (!el.style.zIndex || Number(el.style.zIndex) < 70) {
      el.style.zIndex = '70';
    }
    if (!el.style.position) {
      el.style.position = 'relative';
    }
    return () => {
      el.style.outline = prev;
      el.style.outlineOffset = prevOffset;
      el.style.zIndex = prevZ;
      el.style.position = prevPos;
    };
  }, [step, isMobile]);

  const ariaLabel = `Тур: шаг ${stepIndex + 1} из ${totalSteps}`;

  if (isMobile) {
    return (
      <div
        ref={tooltipRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className="fixed inset-x-0 bottom-0 z-[70] mx-auto flex max-h-[80vh] flex-col gap-3 rounded-t-2xl border-t border-border-subtle bg-bg-elevated p-4 shadow-2xl"
      >
        <TooltipBody
          step={step}
          stepIndex={stepIndex}
          totalSteps={totalSteps}
          onActionClick={onActionClick}
        />
      </div>
    );
  }

  return (
    <div
      ref={tooltipRef}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      style={{
        position: 'fixed',
        top: `${pos.top}px`,
        left: `${pos.left}px`,
        zIndex: 70,
      }}
      className="w-[360px] max-w-[calc(100vw-16px)] rounded-lg border border-border-subtle bg-bg-elevated p-4 shadow-2xl"
    >
      <TooltipBody
        step={step}
        stepIndex={stepIndex}
        totalSteps={totalSteps}
        onActionClick={onActionClick}
      />
    </div>
  );
}

function TooltipBody({
  step,
  stepIndex,
  totalSteps,
  onActionClick,
}: Props) {
  return (
    <>
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-fg-primary">{step.title}</h3>
        <span className="text-xs text-fg-tertiary" aria-hidden>
          {stepIndex + 1} / {totalSteps}
        </span>
      </div>
      <p
        aria-live="polite"
        className="mt-2 text-sm text-fg-secondary"
      >
        {step.body}
      </p>
      <div className="mt-4 flex items-center justify-end gap-2">
        {step.secondaryAction && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onActionClick(step.secondaryAction!)}
          >
            {step.secondaryAction.label}
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          autoFocus
          onClick={() => onActionClick(step.primaryAction)}
        >
          {step.primaryAction.label}
        </Button>
      </div>
    </>
  );
}
